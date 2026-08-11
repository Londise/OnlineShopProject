import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { hashSessionToken } from '../lib/security.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export async function attachUser(req, _res, next) {
  const rawToken = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!rawToken) return next();
  const session = await prisma.authSession.findFirst({
    where: { tokenHash: hashSessionToken(rawToken), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (session?.user.active) req.user = session.user;
  next();
}

export const requireAuth = (req, _res, next) => req.user ? next() : next(unauthorized());

export const requireRoles = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
