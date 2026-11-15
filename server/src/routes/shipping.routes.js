import { Router } from 'express';
import { quote } from '../controllers/shipping.controller.js';
import { validate } from '../middlewares/validate.js';
import { quoteSchema } from '../schemas/shipping.schemas.js';

export const shippingRouter = Router();
shippingRouter.post('/quote', validate(quoteSchema), quote);
