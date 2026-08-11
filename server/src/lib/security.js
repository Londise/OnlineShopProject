import crypto from 'node:crypto';

export const hashSessionToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => crypto.randomBytes(48).toString('base64url');
export const normalizeEmail = (email) => email.trim().toLowerCase();
export const digitsOnly = (value) => value.replace(/\D/g, '');
export const publicOrderNumber = () => `FM-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
