// This worker binds only to loopback and replaces all persistence with doubles.
// Malformed HTTP must never be sent to a deployed API or a real database.
const startedAt = performance.now();
const startup = stage => process.send({ type: 'startup', stage, elapsedMs: Math.round(performance.now() - startedAt) });
startup('import-express');
const { default: express } = await import('express');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=app';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.ORIGIN_PROXY_SECRET = '';
process.env.MEDIA_UPLOAD_CONCURRENCY = '1';
process.env.LOG_LEVEL = 'fatal';
startup('import-app');
const { createApp } = await import('../src/app.js');
const { receiveImage } = await import('../src/controllers/media.controller.js');
const { errorHandler } = await import('../src/middlewares/error-handler.js');
const { flushAndClose } = await import('../src/lib/logger.js');
const { prisma } = await import('../src/db/prisma.js');
startup('compose-app');
const app = express();
app.post('/test-upload', (req, res, next) => {
  req.once('data', () => process.send({ type: 'upload-started' }));
  res.once('close', () => process.send({ type: 'upload-closed' }));
  receiveImage(req, res, error => {
    if (error) return next(error);
    req.releaseUploadSlot();
    res.json({ bytes: req.file?.size ?? 0 });
  });
});
app.use(createApp({
  database: { $queryRaw: async () => [] },
  attachSession: (_req, _res, next) => next(),
}));
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1', () => {
  process.send({ type: 'ready', port: server.address().port, node: process.version });
});
process.once('disconnect', async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await flushAndClose();
  await prisma.$disconnect();
});
