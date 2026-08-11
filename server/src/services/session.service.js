import argon2 from 'argon2';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { hashSessionToken, newSessionToken, normalizeEmail } from '../lib/security.js';
import { AppError, unauthorized } from '../lib/errors.js';

const sessionExpiry = () => new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

export async function registerCustomer({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está em uso.');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.create({ data: { name, email: normalizedEmail, passwordHash, role: 'CUSTOMER' } });
}

export async function authenticate({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user?.active || !(await argon2.verify(user.passwordHash, password))) throw unauthorized('E-mail ou senha inválidos.');
  return user;
}

export async function createSession(userId) {
  const token = newSessionToken();
  await prisma.authSession.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt: sessionExpiry() } });
  return token;
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  await prisma.authSession.updateMany({ where: { tokenHash: hashSessionToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });
