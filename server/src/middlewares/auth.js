import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { hashSessionToken } from "../lib/security.js";
import { patchTrace } from "../lib/trace-context.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";

export async function attachUser(req, _res, next) {
  const rawToken = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!rawToken) return next();
  const session = await prisma.authSession.findFirst({
    where: {
      tokenHash: hashSessionToken(rawToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  if (session?.user.active) {
    req.user = session.user;
    req.authSessionId = session.id;
    patchTrace({ actorId: session.user.id });
  }
  next();
}

export const requireAuth = (req, _res, next) =>
  req.user ? next() : next(unauthorized());

export const requireVerifiedCustomer = (req, _res, next) => {
  if (req.user?.role === "CUSTOMER" && !req.user.emailVerifiedAt)
    return next(new AppError(403, "EMAIL_NOT_VERIFIED", "Verifique seu e-mail para enviar pedidos e acessar seu histórico."));
  next();
};

export const requireRoles =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
