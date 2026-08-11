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
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { publicRouter } from './routes/public.routes.js';

const app = express();
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(verifySameOrigin);
app.use(attachUser);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Tente novamente mais tarde.' } } });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Tente novamente mais tarde.' } } });

app.get('/health', async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok' }); });
app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1/orders', orderLimiter, orderRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1', publicRouter);
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => console.log(`Ferchu API listening on port ${env.PORT}`));
async function shutdown(signal) { console.log(`${signal} received, stopping API…`); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); }
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
