import { Router } from 'express';
import { create, listMine } from '../controllers/order.controller.js';
import { requireAuth, requireVerifiedCustomer } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createOrderSchema } from '../schemas/order.schemas.js';

export const orderRouter = Router();
orderRouter.post('/', requireVerifiedCustomer, validate(createOrderSchema), create);
orderRouter.get('/me', requireAuth, requireVerifiedCustomer, listMine);
