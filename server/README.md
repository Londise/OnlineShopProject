# API Ferchu Modas

## Início rápido

1. Crie um banco MySQL vazio, por exemplo `ferchu_modas`.
2. Copie `.env.example` para `.env` e preencha `DATABASE_URL` e as credenciais do primeiro administrador.
3. Execute `npm install`, `npm run prisma:generate`, `npm run prisma:migrate -- --name init` e `npm run prisma:seed` dentro de `server`.
4. Execute `npm run dev`. A API ficará em `http://localhost:3001`.

O frontend deve usar `VITE_API_URL=http://localhost:3001/api/v1`. Em produção, configure `FRONTEND_ORIGIN` com a origem HTTPS exata da loja e mantenha todos os segredos somente no servidor.
