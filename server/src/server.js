import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { flushAndClose, logInfo } from './lib/logger.js';
import { createShutdown } from './lib/shutdown.js';

const server = createApp().listen(env.PORT, '0.0.0.0', () => {
  logInfo('api.started', `API ouvindo na porta ${env.PORT}`, {
    data: { port: env.PORT, nodeEnv: env.NODE_ENV },
  });
});

const shutdown = createShutdown({
  server,
  flush: flushAndClose,
  disconnect: () => prisma.$disconnect(),
  onStart: signal => logInfo('api.stopping', 'Encerrando API', { data: { signal } }),
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
