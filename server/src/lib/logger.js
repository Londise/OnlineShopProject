import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { getTrace } from './trace-context.js';

// Níveis estilo pino: a comparação `level >= 40` vira consulta de índice barata.
export const LOG_LEVELS = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

export const levelName = (level) =>
  Object.keys(LOG_LEVELS).find((name) => LOG_LEVELS[name] === level) ?? String(level);

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|senha|api[-_]?key/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,16}\b/g;
const MAX_DEPTH = 6;

// Redação acontece ANTES do buffer: dado sensível nunca é persistido.
export function redactValue(value, key, depth = 0) {
  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY.test(key)) return REDACTED;
    return value.replace(EMAIL_RE, REDACTED).replace(CPF_RE, REDACTED).replace(CARD_RE, REDACTED);
  }
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = redactValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return value;
}

export const redactData = (data) => redactValue(data ?? {}, undefined) ?? {};

export function passesFilters(level, { minLevel, sample } = config, rand = Math.random) {
  if (level < minLevel) return false;
  if (level === LOG_LEVELS.debug && sample < 1 && rand() > sample) return false;
  return true;
}

const config = {
  minLevel: LOG_LEVELS[env.LOG_LEVEL] ?? LOG_LEVELS.info,
  sample: env.LOG_DEBUG_SAMPLE,
  bufferMax: env.LOG_BUFFER_MAX,
  flushMs: env.LOG_FLUSH_MS,
  mirror: env.NODE_ENV === 'development',
};

const buffer = [];
let flushing = false;

async function insertBatch(entries) {
  const rows = entries.map(
    (entry) => Prisma.sql`(${entry.ts}, ${entry.level}, ${entry.service}, ${entry.event},
      ${entry.message}, ${entry.traceId}::uuid, ${entry.requestId}::uuid, ${entry.actorId},
      ${entry.route}, ${entry.status}, ${entry.durationMs},
      ${JSON.stringify(entry.data)}::jsonb, ${entry.stack})`,
  );
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO app.log_entry
      (ts, level, service, event, message, trace_id, request_id, actor_id,
       route, status, duration_ms, data, stack)
    VALUES ${Prisma.join(rows)}`);
}

async function deadLetter(entries, reason) {
  try {
    const payload = JSON.stringify(entries, (key, value) =>
      value instanceof Date ? value.toISOString() : value,
    );
    await prisma.$executeRaw`
      INSERT INTO app.log_dead (fail_reason, payload)
      VALUES (${reason}, ${payload}::jsonb)`;
  } catch (error) {
    // O logger nunca derruba o processo: última linha de defesa é o stdout.
    console.error(`[logger] dead-letter falhou; ${entries.length} registro(s) descartado(s):`, error?.message);
  }
}

let sink = insertBatch;
let deadSink = deadLetter;

// Falha no flush vai para app.log_dead; nunca chama log() (sem recursão).
export async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await sink(batch);
  } catch (error) {
    await deadSink(batch, error?.message ?? 'flush failed');
  } finally {
    flushing = false;
  }
}

const timer = setInterval(() => {
  void flush();
}, config.flushMs);
timer.unref();

export function log(level, event, message, ctx = {}) {
  const levelNum = typeof level === 'string' ? LOG_LEVELS[level] : level;
  if (!Number.isInteger(levelNum) || !event || !message) return;
  if (!passesFilters(levelNum)) return;
  const trace = getTrace();
  const entry = {
    ts: new Date(),
    level: levelNum,
    service: String(ctx.service ?? trace.service ?? 'api').slice(0, 40),
    event: String(event).slice(0, 80),
    message: String(message).slice(0, 4000),
    traceId: ctx.traceId ?? trace.traceId ?? null,
    requestId: ctx.requestId ?? trace.requestId ?? null,
    actorId: ctx.actorId ?? trace.actorId ?? null,
    route: ctx.route ?? trace.route ?? null,
    status: ctx.status ?? null,
    durationMs: ctx.durationMs ?? null,
    data: redactData(ctx.data),
    stack: ctx.stack ?? null,
  };
  buffer.push(entry);
  if (config.mirror) console.debug(`[${levelName(levelNum)}] ${entry.event}: ${entry.message}`);
  if (buffer.length >= config.bufferMax) void flush();
}

export const logTrace = (event, message, ctx) => log(LOG_LEVELS.trace, event, message, ctx);
export const logDebug = (event, message, ctx) => log(LOG_LEVELS.debug, event, message, ctx);
export const logInfo = (event, message, ctx) => log(LOG_LEVELS.info, event, message, ctx);
export const logWarn = (event, message, ctx) => log(LOG_LEVELS.warn, event, message, ctx);
export const logError = (event, message, ctx) => log(LOG_LEVELS.error, event, message, ctx);
export const logFatal = (event, message, ctx) => log(LOG_LEVELS.fatal, event, message, ctx);

export async function flushAndClose() {
  clearInterval(timer);
  await flush();
}

// Somente para testes: permitem inspecionar o buffer e injetar destinos falsos.
export const __testing = {
  config,
  buffer,
  setSink: (fn) => {
    sink = fn;
  },
  resetSink: () => {
    sink = insertBatch;
  },
  setDeadSink: (fn) => {
    deadSink = fn;
  },
  resetDeadSink: () => {
    deadSink = deadLetter;
  },
};
