// This worker binds only to loopback and replaces all persistence with doubles.
// Malformed HTTP must never be sent to a deployed API or a real database.
import express from 'express';
import multer from 'multer';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=app';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.ORIGIN_PROXY_SECRET = '';
process.env.MEDIA_UPLOAD_CONCURRENCY = '1';
const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/db/prisma.js');
const { receiveImage } = await import('../src/controllers/media.controller.js');
const { errorHandler } = await import('../src/middlewares/error-handler.js');
const { __testing, flushAndClose } = await import('../src/lib/logger.js');
__testing.config.mirror = false;
__testing.setSink(async () => {});
__testing.setDeadSink(async () => {});

// Verify actual PATCH route wiring without allowing any database calls.
prisma.$transaction = async callback => {
  const model = {
    findUnique: async () => ({ id: 'test', active: false, sortOrder: 7 }),
    update: async ({ data }) => ({ id: 'test', ...data }),
  };
  return callback({ category: model, variantOption: model, siteBanner: model, auditLog: { create: async () => ({}) } });
};
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
// Exercise the upstream advisory's async-fileFilter condition in isolation too.
const asyncUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, callback) => {
    setTimeout(() => callback(null, file.originalname !== 'reject.txt'), file.originalname === 'reject.txt' ? 5 : 30);
  },
}).any();
app.post('/test-async-upload', asyncUpload, (_req, res) => res.json({ ok: true }));
app.use(createApp({
  database: { $queryRaw: async () => [] },
  attachSession: (req, _res, next) => { req.user = { id: 'test-admin', role: 'ADMIN' }; next(); },
}));
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1', () => {
  process.send({ type: 'ready', port: server.address().port, node: process.version });
});
process.once('disconnect', async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await flushAndClose();
});
