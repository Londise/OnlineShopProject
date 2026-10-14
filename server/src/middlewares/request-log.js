import { log, LOG_LEVELS } from '../lib/logger.js';
import { patchTrace } from '../lib/trace-context.js';

// Uma linha por request ao final da resposta: método, rota, status e latência.
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  const route = `${req.method} ${(req.originalUrl ?? req.url).split('?')[0]}`.slice(0, 160);
  patchTrace({ route });
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const status = res.statusCode;
    const isHealth = route.endsWith('/health');
    const level =
      status >= 500 ? LOG_LEVELS.error
      : status >= 400 ? LOG_LEVELS.warn
      : isHealth ? LOG_LEVELS.debug
      : LOG_LEVELS.info;
    log(level, 'http.request', `${route} ${status} · ${durationMs}ms`, {
      route,
      status,
      durationMs,
      actorId: req.user?.id ?? null,
      data: { userAgent: req.get('user-agent')?.slice(0, 160) },
    });
  });
  next();
}
