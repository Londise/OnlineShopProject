import { env } from "../config/env.js";
import {
  authenticate,
  createSession,
  publicUser,
  revokeSession,
} from "../services/session.service.js";
import { registerCustomer, registrationNotice, verifyRegistration, resendVerification, verificationNotice } from "../services/registration.service.js";

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
};
const setSessionCookie = (res, token) =>
  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions);
const proofCookie = `${env.SESSION_COOKIE_NAME}_verification`;
const setProofCookie = (res, proof) =>
  res.cookie(proofCookie, proof, { ...cookieOptions, maxAge: 30 * 60_000 });

export const register = async (req, res) => {
  const result = await registerCustomer(req.body, { mailer: req.app.locals.verificationMailer ?? undefined,
    proof: req.cookies?.[proofCookie] });
  setProofCookie(res, result.proof);
  res.status(202).json({ message: registrationNotice });
};

export const verifyEmail = async (req, res) => {
  const result = await verifyRegistration(req.body, { user: req.user, sessionId: req.authSessionId,
    proof: req.cookies?.[proofCookie] });
  res.clearCookie(proofCookie, { ...cookieOptions, maxAge: undefined });
  res.json(result);
};

export const resendEmail = async (req, res) => {
  const result = await resendVerification(req.user, { mailer: req.app.locals.verificationMailer ?? undefined });
  if (result.proof) setProofCookie(res, result.proof);
  res.status(202).json({ message: result.alreadyVerified ? 'Seu e-mail já está verificado.' : verificationNotice });
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
