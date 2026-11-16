import { prisma } from '../db/prisma.js';
import { hashSessionToken, normalizeEmail } from '../lib/security.js';
import { AppError } from '../lib/errors.js';

// One atomic, persistent budget per account across IPs/processes. The hash keeps
// attempted email addresses out of the throttle table. No permanent lockout.
export const accountHash = email => hashSessionToken(normalizeEmail(email));
export async function reserveLoginAttempt(email, now = new Date()) {
  const rows = await prisma.$queryRaw`
    WITH expired AS (
      DELETE FROM app.auth_throttles
      WHERE account_hash IN (
        SELECT account_hash FROM app.auth_throttles
        WHERE window_start < ${now} - interval '1 day' AND account_hash <> ${accountHash(email)}
        ORDER BY window_start LIMIT 50 FOR UPDATE SKIP LOCKED
      )
    )
    INSERT INTO app.auth_throttles (account_hash, attempts, window_start, next_allowed_at)
    VALUES (${accountHash(email)}, 1, ${now}, ${now})
    ON CONFLICT (account_hash) DO UPDATE SET
      attempts = CASE WHEN auth_throttles.window_start <= ${now} - interval '15 minutes'
        THEN 1 ELSE auth_throttles.attempts + 1 END,
      window_start = CASE WHEN auth_throttles.window_start <= ${now} - interval '15 minutes'
        THEN ${now} ELSE auth_throttles.window_start END,
      next_allowed_at = CASE
        WHEN auth_throttles.window_start <= ${now} - interval '15 minutes' OR auth_throttles.attempts < 5
          THEN ${now}
        ELSE ${now} + power(2, least(auth_throttles.attempts - 4, 6)) * interval '1 second' END
    WHERE auth_throttles.window_start <= ${now} - interval '15 minutes'
      OR (auth_throttles.attempts < 10 AND auth_throttles.next_allowed_at <= ${now})
    RETURNING attempts`;
  if (!rows.length) {
    throw new AppError(429, 'TOO_MANY_REQUESTS', 'Tente novamente mais tarde.');
  }
}

export const resetLoginAttempts = (email, database = prisma) =>
  database.authThrottle.deleteMany({ where: { accountHash: accountHash(email) } });
