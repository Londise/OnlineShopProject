import { Router } from 'express';
import { getLogsByTrace, listDeadLogs, listLogs } from '../controllers/logs.controller.js';
import { validateQuery } from '../middlewares/validate.js';
import { logsQuerySchema } from '../schemas/logs.schemas.js';

export const logsRouter = Router();
logsRouter.get('/', validateQuery(logsQuerySchema), listLogs);
logsRouter.get('/dead', listDeadLogs);
logsRouter.get('/trace/:traceId', getLogsByTrace);
