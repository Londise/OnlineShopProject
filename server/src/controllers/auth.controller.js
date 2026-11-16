import { env } from "../config/env.js";
import {
  authenticate,
  createSession,
  publicUser,
  revokeSession,
} from "../services/session.service.js";
import { registerCustomer, registrationNotice, verifyRegistration } from "../services/registration.service.js";

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
};
const setSessionCookie = (res, token) =>
  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions);

export const register = async (req, res) => {
  await registerCustomer(req.body, { mailer: req.app.locals.verificationMailer ?? undefined });
  res.status(202).json({ message: registrationNotice });
};

export const verifyEmail = async (req, res) => {
  const { user, token } = await verifyRegistration(req.body);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
};

export const login = async (req, res) => {
  const user = await authenticate(req.body);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
};

export const logout = async (req, res) => {
  await revokeSession(req.cookies?.[env.SESSION_COOKIE_NAME]);
  res.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.status(204).end();
};

export const me = async (req, res) =>
  res.json({ user: req.user ? publicUser(req.user) : null });
