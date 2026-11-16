import { createHmac, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { serializableTransaction } from '../db/transaction.js';
import { AppError } from '../lib/errors.js';
import { hashSessionToken, normalizeEmail } from '../lib/security.js';
import { createSession } from './session.service.js';
import { sendVerificationEmail } from './email.service.js';
import { resetLoginAttempts } from './auth-throttle.service.js';
import { writeAudit } from './audit.service.js';

export const registrationNotice = 'Se o endereço puder ser usado, você receberá um link para verificar seu e-mail. Confira também o spam.';
const invalidLink = () => new AppError(422, 'INVALID_VERIFICATION', 'Link inválido, vencido ou já utilizado. Solicite uma nova verificação.');
function verificationToken(email, nonce) {
  if (!env.EMAIL_VERIFICATION_SECRET)
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'A verificação por e-mail está indisponível.');
  return createHmac('sha256', env.EMAIL_VERIFICATION_SECRET).update(`${nonce}:${email}`).digest('base64url');
}

export async function registerCustomer({ email }, { mailer = sendVerificationEmail } = {}) {
  email = normalizeEmail(email);
  // This path never reads users: existing/new/disabled/privileged accounts have
  // identical status, body, cookies and delivery behavior.
  let pending;
  try {
    pending = await serializableTransaction(prisma, async tx => {
      await tx.$executeRaw`DELETE FROM app.pending_registrations WHERE email IN (
        SELECT email FROM app.pending_registrations
        WHERE expires_at < now() - interval '1 day' AND email <> ${email}
        ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED
      )`;
      const previous = await tx.pendingRegistration.findUnique({ where: { email } });
      if (previous && previous.expiresAt > new Date()
        && previous.tokenHash === hashSessionToken(verificationToken(email, previous.nonce))) return previous;
      const nonce = randomUUID(), token = verificationToken(email, nonce);
      return tx.pendingRegistration.upsert({ where: { email },
        create: { email, nonce, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
        update: { nonce, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 30 * 60_000), consumedAt: null },
      });
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    pending = await prisma.pendingRegistration.findUnique({ where: { email } });
    if (!pending) throw error;
  }
  // Reconstruct without persisting a raw bearer token. Retries use identical
  // Resend idempotency keys/bodies and do not invalidate the owner's first link.
  const token = verificationToken(email, pending.nonce);
  await mailer({ email, token, nonce: pending.nonce });
}

export async function verifyRegistration({ token, name, password }) {
  const tokenHash = hashSessionToken(token);
  const pending = await prisma.pendingRegistration.findUnique({ where: { tokenHash } });
  if (!pending || pending.consumedAt || pending.expiresAt <= new Date()) throw invalidLink();
  if (hashSessionToken(verificationToken(pending.email, pending.nonce)) !== tokenHash) throw invalidLink();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await serializableTransaction(prisma, async tx => {
    const claimed = await tx.pendingRegistration.updateMany({ where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw invalidLink();
    const existing = await tx.user.findFirst({ where: { email: { equals: pending.email, mode: 'insensitive' } } });
    if (existing && (!existing.active || existing.role !== 'CUSTOMER' || existing.emailVerifiedAt))
      throw new AppError(409, 'VERIFICATION_UNAVAILABLE', 'Não é possível concluir este cadastro. Se já possui acesso, entre na sua conta.');
    const data = { name, passwordHash, email: pending.email, emailVerifiedAt: new Date() };
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data })
      : await tx.user.create({ data: { ...data, role: 'CUSTOMER' } });
    await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await resetLoginAttempts(pending.email, tx);
    await writeAudit(tx, { actorId: user.id, entityType: 'USER', entityId: user.id,
      action: 'EMAIL_VERIFIED', afterJson: { verified: true } });
    const sessionToken = await createSession(user.id, tx);
    return { user, token: sessionToken };
  });
  return result;
}
