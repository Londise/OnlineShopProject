import { Router } from 'express';
import { login, logout, me, register, verifyEmail } from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.js';
import { loginSchema, registerSchema, verifyEmailSchema } from '../schemas/auth.schemas.js';

/*
O router chama o get dependendo de como ele foi chamado, se for chamado um get para "/me" entao
ele executa a função "me" dentro de auth.controller.js
*/
export const authRouter = Router();
authRouter.post('/register', validate(registerSchema), register);
authRouter.post('/verify-email', validate(verifyEmailSchema), verifyEmail);
authRouter.post('/login', validate(loginSchema), login);
authRouter.post('/logout', logout);
authRouter.get('/me', me);
