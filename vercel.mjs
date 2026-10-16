import { createVercelConfig } from './deploy/vercel-config.js';

export const config = createVercelConfig(process.env);
