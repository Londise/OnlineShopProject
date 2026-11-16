import argon2 from "argon2";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import {
  hashSessionToken,
  newSessionToken,
  normalizeEmail,
} from "../lib/security.js";
import { unauthorized } from "../lib/errors.js";
import { logWarn } from "../lib/logger.js";
import { reserveLoginAttempt, resetLoginAttempts } from "./auth-throttle.service.js";

const dummyPasswordHash = argon2.hash(newSessionToken(), { type: argon2.argon2id });
const sessionExpiry = () =>
  new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

export async function authenticate({ email, password }) {
  await reserveLoginAttempt(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  const passwordMatches = await argon2.verify(user?.passwordHash ?? await dummyPasswordHash, password);
  if (!user?.active || !passwordMatches || (user.role === "CUSTOMER" && !user.emailVerifiedAt)) {
    // Sem distinguir usuário inexistente de senha errada; o e-mail é redigido pelo logger.
    logWarn("auth.login_failed", "Tentativa de login falhou", {
      data: { email, reason: "invalid_credentials" },
    });
    throw unauthorized("E-mail ou senha inválidos.");
  }
  await resetLoginAttempts(email);
  return user;
}

export async function createSession(userId, database = prisma) {
  const token = newSessionToken();
  await database.authSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiry(),
    },
  });
  return token;
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  await prisma.authSession.updateMany({
    where: { tokenHash: hashSessionToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});
