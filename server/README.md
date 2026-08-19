# API Ferchu Modas

## Início rápido

1. Crie um banco MySQL vazio, por exemplo `ferchu_modas`.
2. Copie `.env.example` para `.env` e preencha `DATABASE_URL` e as credenciais do primeiro administrador.
3. Execute `npm install`, `npm run prisma:generate`, `npm run prisma:migrate -- --name init` e `npm run prisma:seed` dentro de `server`.
4. Execute `npm run dev`. A API ficará em `http://localhost:3001`.

O frontend deve usar `VITE_API_URL=http://localhost:3001/api/v1`. Em produção, configure `FRONTEND_ORIGIN` com a origem HTTPS exata da loja e mantenha todos os segredos somente no servidor.

Estado/lógica deve ficar o mais próximo possível do componente que realmente precisa dele!!!.

### app.use()
registra e aplica funções de middleware

## FLUXO

`
BROWSER FAZ UMA REQUISIÇÃO, EX: REQUISIÇÃO GET EM /api/v1/auth/me
   │
   │ GET /api/v1/auth/me
   │ Cookie: sessão...
   ▼
EXPRESS PASSA A REQUISIÇÃO PELOS MIDDLEWARES ATRAVÉS DO app.use()
   │
   ▼
cookieParser()
   │
   ├── middleware que parseia o cabeçalho da requisição e preenche
   │   req.cookies com as cookies do navegador
   │
   ▼
verifySameOrigin()
   │
   ▼
attachUser()
   │
   ├── pega a cookie do cabeçalho da requisição com os dados do user
   │
   ├── procura uma sessão no banco que corresponda ao user da cookie
   │
   ├── encontra usuário -> preenche o req.user com o user da cookie
   │
   └── logo, req.user = usuário da cookie
   │
   ▼
 next()
   │
   ▼
app.use("/api/v1/auth", authRouter) 
   │
   ▼
authRouter.get("/me", me)
   │
   ▼
me(req, res)
   │
   ├── pega req.user
   │
   ├── publicUser(req.user)
   │
   └── res.json(...)
   │
   ▼
BROWSER
   │
   │ { user: {...} }
   ▼
api.auth.me()
   │
   ▼
.then(data => setUser(data.user))
   │
   ▼
REACT
   │
   └── user = {...}
`