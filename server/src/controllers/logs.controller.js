import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { LOG_LEVELS } from '../lib/logger.js';

const SELECT_COLUMNS = Prisma.sql`
  SELECT id, ts, level, service, event, message,
         trace_id AS "traceId", request_id AS "requestId", actor_id AS "actorId",
         route, status, duration_ms AS "durationMs", data, stack
  FROM app.log_entry`;

const serialize = ({ id, ...row }) => ({ id: String(id), ...row });

const encodeCursor = (ts, id) =>
  Buffer.from(`${new Date(ts).toISOString()}|${id}`, 'utf8').toString('base64url');

function decodeCursor(cursor) {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(ts);
    if (Number.isNaN(date.getTime()) || !/^\d+$/.test(id ?? '')) throw new Error('bad cursor');
    return { ts: date, id };
  } catch {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor de paginação inválido.');
  }
}

const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const listLogs = asyncHandler(async (req, res) => {
  const { level, service, event, traceId, q, from, to, cursor, limit } = req.validatedQuery;
  const conditions = [];
  if (level?.length) {
    const levels = level.map((part) => LOG_LEVELS[part] ?? Number(part));
    conditions.push(Prisma.sql`level IN (${Prisma.join(levels)})`);
  }
  if (service) conditions.push(Prisma.sql`service = ${service}`);
  if (event) conditions.push(Prisma.sql`event = ${event}`);
  if (traceId) conditions.push(Prisma.sql`trace_id = ${traceId}::uuid`);
  if (from) conditions.push(Prisma.sql`ts >= ${from}`);
  if (to) conditions.push(Prisma.sql`ts <= ${to}`);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      Prisma.sql`(message ILIKE ${pattern} ESCAPE '\\' OR event ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (cursor) {
    const { ts, id } = decodeCursor(cursor);
    conditions.push(Prisma.sql`(ts, id) < (${ts}::timestamptz, ${id}::bigint)`);
  }
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw(
    Prisma.sql`${SELECT_COLUMNS} ${where} ORDER BY ts DESC, id DESC LIMIT ${limit + 1}`,
  );
  const entries = rows.slice(0, limit).map(serialize);
  const last = rows.length > limit ? rows[limit - 1] : null;
  res.json({ entries, nextCursor: last ? encodeCursor(last.ts, last.id) : null });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getLogsByTrace = asyncHandler(async (req, res) => {
  const { traceId } = req.params;
  if (!UUID_RE.test(traceId)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Trace inválido.');
  }
  const rows = await prisma.$queryRaw(
    Prisma.sql`${SELECT_COLUMNS} WHERE trace_id = ${traceId}::uuid ORDER BY ts ASC, id ASC LIMIT 500`,
  );
  res.json({ entries: rows.map(serialize) });
});

export const listDeadLogs = asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT id, failed_at AS "failedAt", fail_reason AS "failReason", payload
    FROM app.log_dead
    ORDER BY failed_at DESC
    LIMIT 50`;
  res.json({ batches: rows.map(serialize) });
});
