import { Router } from 'express';
import { getProduct, listProducts } from '../controllers/catalog.controller.js';
import { listBanners } from '../controllers/public.controller.js';

export const publicRouter = Router();
publicRouter.get('/products', listProducts);
publicRouter.get('/products/:slug', getProduct);
publicRouter.get('/banners', listBanners);
