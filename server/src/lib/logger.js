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
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') {
    return redactText(value).slice(0, 8192);
  }
  if (typeof value === 'bigint') return String(value);
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, undefined, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    if (Buffer.isBuffer(value)) return '[Buffer]';
    const output = {};
    for (const childKey of Object.keys(value).slice(0, 50)) {
      if (['__proto__', 'constructor', 'prototype'].includes(childKey)) continue;
      output[childKey] = redactValue(value[childKey], childKey, depth + 1);
    }
    return output;
  }
  return value;
}

export const redactData = (data) => redactValue(data ?? {}, undefined) ?? {};

export function redactText(value) {
  return String(value)
    .replace(/\b((?:postgres(?:ql)?|mysql|https?):\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:rnd_|sb_secret_|sbp_)[A-Za-z0-9_.-]+/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b([\w-]*(?:password|token|secret|authorization|cookie|senha|api[_-]?key)[\w-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(EMAIL_RE, REDACTED).replace(CPF_RE, REDACTED).replace(CARD_RE, REDACTED);
}

export function passesFilters(level, { minLevel, sample } = config, rand = Math.random) {
  if (level < minLevel) return false;
  if (level === LOG_LEVELS.debug && sample < 1 && rand() >= sample) return false;
  return true;
}

const config = {
  minLevel: LOG_LEVELS[env.LOG_LEVEL] ?? LOG_LEVELS.info,
  sample: env.LOG_DEBUG_SAMPLE,
  bufferMax: env.LOG_BUFFER_MAX,
  flushMs: env.LOG_FLUSH_MS,
  queueMaxEntries: env.LOG_QUEUE_MAX_ENTRIES,
  queueMaxBytes: env.LOG_QUEUE_MAX_BYTES,
  mirror: env.NODE_ENV !== 'test',
};

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
  const payload = JSON.stringify(entries);
  await prisma.$executeRaw`
    INSERT INTO app.log_dead (fail_reason, payload)
    VALUES (${reason}, ${payload}::jsonb)`;
}

// A factory makes blocked sinks and shutdown races testable without a real DB.
// Limits include both queued entries and the batch currently being written.
export function createBufferedLogger({ sink: initialSink, deadSink: initialDeadSink,
  settings = config, context = getTrace, output = entry => console.log(JSON.stringify(entry)), autoFlush = true } = {}) {
  const buffer = [];
  const sizes = new WeakMap();
  let sink = initialSink;
  let deadSink = initialDeadSink;
  let queuedBytes = 0;
  let activeCount = 0;
  let activeBytes = 0;
  let dropped = 0;
  let inFlight;
  let closing;
  let accepting = true;
  const emit = entry => { try { output(entry); } catch { /* Logging cannot fail a request. */ } };
  const diagnostic = (event, count = 1) => emit({ ts: new Date(), level: 50, service: 'api', event, data: { count } });

  function flush() {
    if (inFlight) return inFlight;
    if (!buffer.length) return Promise.resolve();
    inFlight = Promise.resolve().then(async () => {
      while (buffer.length) {
        const batch = buffer.splice(0, settings.bufferMax);
        activeCount = batch.length;
        activeBytes = batch.reduce((total, entry) => total + sizes.get(entry), 0);
        queuedBytes -= activeBytes;
        try {
          await sink(batch);
        } catch (error) {
          try {
            await deadSink(batch, redactText(error?.message ?? 'flush failed').slice(0, 4000));
          } catch {
            dropped += batch.length;
            // Original events were already mirrored to redacted stdout in prod.
            diagnostic('logger.persistence_failed', batch.length);
          }
        } finally {
          activeCount = 0;
          activeBytes = 0;
        }
      }
    }).catch(() => diagnostic('logger.flush_failed')).finally(() => { inFlight = undefined; });
    return inFlight;
  }

  const timer = autoFlush ? setInterval(() => { void flush(); }, settings.flushMs) : undefined;
  timer?.unref();

  function log(level, event, message, ctx = {}) {
    if (!accepting) return false;
    try {
      const number = typeof level === 'string' ? LOG_LEVELS[level] : level;
      if (!Object.values(LOG_LEVELS).includes(number) || !event || !message || !passesFilters(number, settings)) return false;
      const trace = context();
      const entry = {
        ts: new Date(), level: number,
        service: redactText(ctx.service ?? trace.service ?? 'api').slice(0, 40),
        event: String(event).slice(0, 80),
        message: redactText(message).slice(0, 4000),
        traceId: ctx.traceId ?? trace.traceId ?? null,
        requestId: ctx.requestId ?? trace.requestId ?? null,
        actorId: ctx.actorId ?? trace.actorId ?? null,
        route: ctx.route ? redactText(ctx.route).slice(0, 160) : trace.route ? redactText(trace.route).slice(0, 160) : null,
        status: Number.isInteger(ctx.status) ? ctx.status : null,
        durationMs: Number.isInteger(ctx.durationMs) && ctx.durationMs >= 0 ? ctx.durationMs : null,
        data: redactData(ctx.data),
        stack: ctx.stack ? redactText(ctx.stack).slice(0, 8192) : null,
      };
      if (Buffer.byteLength(JSON.stringify(entry.data)) > 16_384) entry.data = { truncated: true };
      const bytes = Buffer.byteLength(JSON.stringify(entry));
      if (settings.mirror) emit(entry);
      if (buffer.length + activeCount >= settings.queueMaxEntries || queuedBytes + activeBytes + bytes > settings.queueMaxBytes) {
        dropped++;
        if (dropped === 1 || dropped % 100 === 0) diagnostic('logger.queue_full', dropped);
        return false;
      }
      sizes.set(entry, bytes);
      buffer.push(entry);
      queuedBytes += bytes;
      if (buffer.length >= settings.bufferMax) void flush();
      return true;
    } catch {
      diagnostic('logger.invalid_entry');
      return false;
    }
  }

  function close() {
    if (!closing) {
      accepting = false;
      clearInterval(timer);
      closing = flush();
    }
    return closing;
  }

  return { log, flush, close, buffer,
    stats: () => ({ queued: buffer.length, active: activeCount, bytes: queuedBytes + activeBytes, dropped }),
    clear: () => { buffer.length = 0; queuedBytes = 0; },
    setSink: fn => { sink = fn; }, setDeadSink: fn => { deadSink = fn; },
  };
}

const logger = createBufferedLogger({ sink: insertBatch, deadSink: deadLetter });
export const log = logger.log;
export const flush = logger.flush;
export const flushAndClose = logger.close;

export const logTrace = (event, message, ctx) => log(LOG_LEVELS.trace, event, message, ctx);
export const logDebug = (event, message, ctx) => log(LOG_LEVELS.debug, event, message, ctx);
export const logInfo = (event, message, ctx) => log(LOG_LEVELS.info, event, message, ctx);
export const logWarn = (event, message, ctx) => log(LOG_LEVELS.warn, event, message, ctx);
export const logError = (event, message, ctx) => log(LOG_LEVELS.error, event, message, ctx);
export const logFatal = (event, message, ctx) => log(LOG_LEVELS.fatal, event, message, ctx);

// Somente para testes: permitem inspecionar o buffer e injetar destinos falsos.
export const __testing = {
  config,
  buffer: logger.buffer,
  clear: logger.clear,
  setSink: logger.setSink,
  resetSink: () => logger.setSink(insertBatch),
  setDeadSink: logger.setDeadSink,
  resetDeadSink: () => logger.setDeadSink(deadLetter),
};
