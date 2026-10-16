import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { attachUser } from './middlewares/auth.js';
import { verifySameOrigin } from './middlewares/csrf.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-log.js';
import { traceMiddleware } from './middlewares/trace.js';
import { clientRateLimitKey, requireProxyOrigin } from './middlewares/proxy-origin.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { publicRouter } from './routes/public.routes.js';

// Composition is separate from listen/signals so HTTP tests can start an
// isolated app without starting the real process or contacting a real DB.
export function createApp({ config = env, database = prisma, attachSession = attachUser } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(traceMiddleware);
  app.use(requestLogger);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' });
    next();
  });

  // Render health checks must not require the Vercel secret or a user session.
  app.get('/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    await database.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  app.use('/api', requireProxyOrigin(config.ORIGIN_PROXY_SECRET));
  app.use(cors({
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-trace-id', 'x-request-id'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(verifySameOrigin);
  app.use(attachSession);

  const limiter = () => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    keyGenerator: clientRateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Tente novamente mais tarde.' } },
  });
  app.use('/api/v1/auth', limiter(), authRouter);
  app.use('/api/v1/orders', limiter(), orderRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1', publicRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
