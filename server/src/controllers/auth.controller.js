import { env } from '../config/env.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticate, createSession, publicUser, registerCustomer, revokeSession } from '../services/session.service.js';

const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 };
const setSessionCookie = (res, token) => res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions);

export const register = asyncHandler(async (req, res) => {
  const user = await registerCustomer(req.body);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  const user = await authenticate(req.body);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

export const logout = asyncHandler(async (req, res) => {
  await revokeSession(req.cookies?.[env.SESSION_COOKIE_NAME]);
  res.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.status(204).end();
});

export const me = asyncHandler(async (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
