import { prisma } from '../db/prisma.js';
import { AppError, notFound } from '../lib/errors.js';
import { archiveOrder, createOrder, updateOrder } from '../services/order.service.js';
import { z } from 'zod';

const orderInclude = { items: true, user: { select: { id: true, name: true, email: true } } };
export const create = async (req, res) => {
  const key = z.string().uuid().safeParse(req.get('idempotency-key'));
  if (!key.success) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Informe um identificador UUID para este envio.');
  const order = await createOrder(req.body, req.user, {
    quoteShipping: req.app.locals.shippingQuote, idempotencyKey: key.data,
  });
  res.status(201).json({ order });
};

export const listMine = async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id, archivedAt: null },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders });
};

export const listAdmin = async (req, res) => {
  const status = req.query.status;
  const orders = await prisma.order.findMany({
    where: { archivedAt: null, ...(status ? { status } : {}) },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ orders });
};

export const getAdmin = async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, archivedAt: null },
    include: orderInclude,
  });
  if (!order) throw notFound('Pedido não encontrado.');
  res.json({ order });
};

export const update = async (req, res) =>
  res.json({ order: await updateOrder(req.params.id, req.body, req.user) });

export const archive = async (req, res) =>
  res.json({ order: await archiveOrder(req.params.id, req.user) });
