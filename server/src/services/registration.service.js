import { createHmac, randomUUID, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { serializableTransaction } from '../db/transaction.js';
import { AppError } from '../lib/errors.js';
import { hashSessionToken, normalizeEmail } from '../lib/security.js';
import { sendVerificationEmail } from './email.service.js';
import { resetLoginAttempts } from './auth-throttle.service.js';
import { writeAudit } from './audit.service.js';

export const registrationNotice = 'Se o endereço puder ser usado, sua conta foi criada. Entre com a senha escolhida e confira o link de verificação no seu e-mail, inclusive no spam.';
export const verificationNotice = 'Enviamos um link para verificar seu e-mail. Confira também o spam.';
const invalidLink = () => new AppError(422, 'INVALID_VERIFICATION', 'Link inválido, vencido ou já utilizado. Solicite uma nova verificação.');
function challengeSecret(purpose, user, nonce) {
  if (!env.EMAIL_VERIFICATION_SECRET)
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'A verificação por e-mail está indisponível.');
  // Separate the mailed token from the browser proof. Bind both to the
  // account/credentials that actually requested verification, not just email.
  return createHmac('sha256', env.EMAIL_VERIFICATION_SECRET)
    .update(JSON.stringify([purpose, user.id, user.email, user.passwordHash, nonce])).digest('base64url');
}
const ownsChallenge = (user, pending, proof) => Boolean(pending && proof
  && hashSessionToken(proof) === hashSessionToken(challengeSecret('browser', user, pending.nonce)));
const validChallenge = (user, pending) => Boolean(pending && !pending.consumedAt && pending.expiresAt > new Date()
  && pending.tokenHash === hashSessionToken(challengeSecret('email', user, pending.nonce)));
async function issueChallenge(tx, user) {
  const nonce = randomUUID();
  const data = { nonce, tokenHash: hashSessionToken(challengeSecret('email', user, nonce)),
    expiresAt: new Date(Date.now() + 30 * 60_000), consumedAt: null, createdAt: new Date() };
  return tx.pendingRegistration.upsert({ where: { email: user.email },
    create: { email: user.email, ...data }, update: data });
}
async function deliver(user, pending, mailer) {
  await mailer({ email: user.email, token: challengeSecret('email', user, pending.nonce), nonce: pending.nonce });
}

export async function registerCustomer({ email, name, password }, { mailer = sendVerificationEmail, proof } = {}) {
  email = normalizeEmail(email);
  // Hash on every path. Duplicate registration never updates an account's
  // credentials or turns a supplied role into a managed account.
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  let result;
  try {
    result = await serializableTransaction(prisma, async tx => {
      await tx.$executeRaw`DELETE FROM app.pending_registrations WHERE email IN (
        SELECT email FROM app.pending_registrations
        WHERE expires_at < now() - interval '1 day' AND email <> ${email}
        ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED
      )`;
      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      const user = existing ?? await tx.user.create({ data: { email, name, passwordHash, role: 'CUSTOMER' } });
      const previous = await tx.pendingRegistration.findUnique({ where: { email: user.email } });
      const ownsBrowser = !existing || ownsChallenge(user, previous, proof);
      const pending = validChallenge(user, previous) ? previous : await issueChallenge(tx, user);
      return { user, pending, ownsBrowser };
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const pending = user && await prisma.pendingRegistration.findUnique({ where: { email: user.email } });
    if (!user || !validChallenge(user, pending)) throw error;
    result = { user, pending, ownsBrowser: ownsChallenge(user, pending, proof) };
  }
  await deliver(result.user, result.pending, mailer);
  // Every accepted registration sets an indistinguishable HttpOnly proof
  // cookie, never an auth session. Only the original signup gets a valid proof.
  return { proof: result.ownsBrowser ? challengeSecret('browser', result.user, result.pending.nonce)
    : randomBytes(32).toString('base64url') };
}

export async function resendVerification(user, { mailer = sendVerificationEmail } = {}) {
  const result = await serializableTransaction(prisma, async tx => {
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.active || current.role !== 'CUSTOMER')
      throw new AppError(403, 'VERIFICATION_UNAVAILABLE', 'Esta conta não precisa de verificação pública.');
    if (current.emailVerifiedAt) return null;
    const previous = await tx.pendingRegistration.findUnique({ where: { email: current.email } });
    if (previous && previous.createdAt > new Date(Date.now() - 60_000))
      throw new AppError(429, 'VERIFICATION_COOLDOWN', 'Aguarde um minuto antes de solicitar outro e-mail.');
    return { user: current, pending: await issueChallenge(tx, current) };
  });
  if (!result) return { alreadyVerified: true };
  await deliver(result.user, result.pending, mailer);
  return { proof: challengeSecret('browser', result.user, result.pending.nonce) };
}

export async function verifyRegistration({ token }, { user: viewer, sessionId, proof } = {}) {
  const tokenHash = hashSessionToken(token);
  const pending = await prisma.pendingRegistration.findUnique({ where: { tokenHash } });
  if (!pending || pending.consumedAt || pending.expiresAt <= new Date()) throw invalidLink();
  const user = await prisma.user.findUnique({ where: { email: pending.email } });
  if (!user || !validChallenge(user, pending)) throw invalidLink();
  if (viewer?.id !== user.id && !ownsChallenge(user, pending, proof))
    throw new AppError(403, 'VERIFICATION_SIGN_IN_REQUIRED', 'Abra o link no navegador do cadastro ou entre na conta que você criou para confirmar seu e-mail.');
  await serializableTransaction(prisma, async tx => {
    const claimed = await tx.pendingRegistration.updateMany({ where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw invalidLink();
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.active || current.role !== 'CUSTOMER' || current.emailVerifiedAt
      || !validChallenge(current, pending))
      throw new AppError(409, 'VERIFICATION_UNAVAILABLE', 'Não é possível verificar este cadastro.');
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    // Preserve only the current authenticated session, never old unverified
    // sessions. The emailed link cannot create a login session or set a password.
    await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null,
      ...(viewer?.id === user.id && sessionId ? { id: { not: sessionId } } : {}) }, data: { revokedAt: new Date() } });
    await resetLoginAttempts(pending.email, tx);
    await writeAudit(tx, { actorId: user.id, entityType: 'USER', entityId: user.id,
      action: 'EMAIL_VERIFIED', afterJson: { verified: true } });
  });
  return { verified: true };
}
