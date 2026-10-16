# API Ferchu Modas

## Arquitetura

`React/Vite → Express → Prisma 6 → PostgreSQL (Supabase ou local)`.

O backend usa apenas PostgreSQL. Express, as rotas, Argon2id e as sessões próprias
em cookie HttpOnly continuam. Imagens são servidas pelo Supabase Storage; seu SDK
é usado somente no backend. Não é necessário Supabase Auth,
Edge Functions ou `supabase-js` no frontend. As tabelas ficam no schema privado
`app`; não adicione esse schema aos schemas expostos pela Data API.

## Conexões

No painel Supabase, use **Connect → ORM → Prisma**. Para este servidor persistente,
use a conexão direta se a rede tiver IPv6; em IPv4, use **Session pooler (5432)**.
Não use o pooler de transações (6543) para migrações.

- `DATABASE_URL`: conexão do runtime com um login dedicado, membro de
  `ferchu_backend`, sem permissões administrativas.
- `DIRECT_URL`: conexão do proprietário/admin usada pelo Prisma Migrate. Pode
  ser direta ou Session pooler. Não compartilhe a senha com o frontend.
- Ambas precisam de `schema=app`; conexões remotas precisam de `sslmode=require`.
  Use senha URL-encoded e um limite conservador de conexões, como o exemplo.
- As variáveis `VITE_SUPABASE_*` e chaves publicáveis não são conexões PostgreSQL.

O schema Prisma declara explicitamente `app` em todos os modelos e enums. Não
gerencie a mesma estrutura com migrações Prisma e Supabase CLI ao mesmo tempo.

## Início rápido: banco novo

1. Execute `npm ci` em `server/` (Node 22+).
2. Copie `.env.example` para `.env` **somente se não existir um arquivo local**,
   preencha as conexões e mantenha quaisquer credenciais existentes necessárias.
3. Execute `npm run prisma:validate`, `npm run prisma:generate` e
   `npm run prisma:deploy`. As migrações criam a estrutura, não transferem dados.
4. Como proprietário do banco, provisione um LOGIN dedicado e conceda a ele
   `GRANT ferchu_backend TO <login_do_backend>`. A migração cria apenas o grupo
   NOLOGIN, sem senha; não use o login `postgres` no runtime. Configure a senha
   fora do código, via ferramenta administrativa segura, e coloque a URL desse
   login em `DATABASE_URL`. O usuário de migração precisa poder criar o grupo.
5. Execute `npm run db:check`. Ele confere o acesso Prisma e exibe apenas contagens.
6. **Somente para um banco de desenvolvimento novo e vazio:** configure
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` e execute `npm run prisma:seed`.
7. Execute `npm run dev`. A API ficará em `http://localhost:3001`.

O frontend continua usando `VITE_API_URL=http://localhost:3001/api/v1`. Em produção,
configure `FRONTEND_ORIGIN` com a origem HTTPS exata e mantenha todos os segredos
somente no servidor. Considere as restrições de rede e valide o certificado TLS
da conexão de acordo com a configuração do ambiente.

## Migração de dados reais

Neste ambiente, as migrações PostgreSQL foram aplicadas e os dados de origem foram
copiados e conferidos campo a campo nas 16 tabelas. `DATABASE_URL` usa um login
restrito PostgreSQL; `DIRECT_URL` é reservada às migrações. A cópia não usa o seed
e não troca senhas nem o sistema de autenticação. Ferramentas temporárias de
transferência não são dependências do backend e ficam fora do repositório.

Para migrar outro ambiente, siga os passos abaixo; aplicar o schema sozinho não
transfere dados:

A conversão do schema **não copia clientes, senhas, sessões ou pedidos**. Antes
de trocar a conexão da aplicação:

1. Obtenha acesso ao banco de origem e ao PostgreSQL de destino.
2. Faça um ensaio de importação com os IDs, hashes, sessões, snapshots e relações
   preservados. Não importe a tabela `_prisma_migrations` antiga e não rode o seed.
3. Confira timezone das datas de origem (o destino usa `timestamptz`), unicidades,
   contagens, totais e reservas. Constraints rejeitam dados inconsistentes: não os
   descarte silenciosamente. As ferramentas de importação devem ser executadas
   separadamente do runtime e com o banco de destino vazio.
4. Pause escritas, copie a versão final, reconcilie e teste login/pedidos/estoque
   antes de publicar o backend com a nova conexão.
5. Só remova o banco antigo do projeto depois da conferência. Sem backup, ele é
   a única fonte recuperável até a cópia ser validada. Não desinstale um serviço
   que possa hospedar bancos de outros projetos.

Uma reversão depois de novas vendas exige copiar/reconciliar as novas gravações;
trocar a conexão de volta pode perder pedidos. Sessões próprias podem continuar
válidas se forem copiadas e o nome do cookie/origem/prazo permanecerem iguais.

As migrações originais permanecem em `prisma/history/mysql/` somente como histórico.
Apenas `prisma/migrations/` é aplicado no PostgreSQL. Não há cliente MySQL ativo.

## Imagens no Supabase Storage

- Bucket público `storefront-images`: downloads são públicos; gravações passam
  exclusivamente pelo Express, com sessão ADMIN e verificação de origem.
- Configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` somente em `server/.env`/secrets
  da hospedagem. Não use `VITE_` na chave secreta nem a envie ao navegador.
- Gestão → Imagens: upload, destino produto/categoria/banner/favicon, capa e ordem.
  Aceita JPEG/PNG/WebP não animados, até 5 MB e 16 megapixels. O servidor decodifica
  o conteúdo e cria caminhos imutáveis. Trocar a capa não sobrescreve o arquivo antigo.
- `POST /api/v1/admin/uploads`: multipart com `file`, `purpose`, `targetId` quando
  necessário, `optionId` opcional para produto, `primary`, `sortOrder` e `altText`.
- `GET /api/v1/admin/media-assets` lista a biblioteca; `PATCH /api/v1/admin/product-images/:id`
  altera capa/ordem. Não há exclusão de objetos pelo painel: URLs antigas podem ser
  snapshots de pedidos. Não conceda escrita pública no bucket e não manipule seus
  arquivos diretamente pelo schema SQL `storage`.
- As 27 imagens originais foram migradas sem recompressão e conferidas por SHA-256.
  O mapa público (sem chaves) está em `prisma/data/storage-images.json`; execute
  `npm run media:migrate -- --verify` para conferir downloads e registros novamente.
- A migração de origem usa `scripts/migrate-images.js` com os arquivos originais
  disponíveis; após remoção dos assets locais, use `--verify`. Não apague objetos
  existentes se uma nova importação falhar. Cloudinary não é dependência do runtime.
- Antes de aplicar `20261013000000_storage_media` em OUTRO ambiente, confira
  `media_assets.public_id`. Aqui não havia registros externos e a verificação foi
  feita antes do deploy. Se houver identificadores, a migração aborta para impedir
  perda de dados: é preciso primeiro copiar/verificar esses arquivos, conservar os
  IDs e vínculos de mídia e atualizar suas referências, em uma transição específica
  para aquele ambiente. O importador de arquivos locais não migra contas Cloudinary.
  Não remova o bloqueio nem marque essa migração como aplicada sem realizar a transição.
- Galerias e imagens de categorias vêm do banco. A Home lê banners da API e o
  favicon é atualizado por `/site-media`. Uma falha no catálogo mostra erro/placeholder,
  não produtos locais fictícios. Carrinhos persistidos reconciliam apenas suas imagens.

## Logs operacionais

- Telemetria da aplicação (requests HTTP, erros, eventos de negócio) em JSON
  estruturado; a auditoria de negócio continua em `audit.service.js`/`audit_logs`.
- `src/lib/logger.js`: `log(level, event, message, ctx)` redige PII (e-mail, CPF,
  cartão, chaves `password|token|secret|authorization|cookie`), empilha num buffer
  e grava em lote a cada `LOG_FLUSH_MS` (2 s) ou `LOG_BUFFER_MAX` (100) entradas.
  Falha no flush vai para `app.log_dead`; o processo nunca é derrubado pelo logger.
- Níveis numéricos estilo pino: 10 trace, 20 debug, 30 info, 40 warn, 50 error,
  60 fatal. `LOG_LEVEL` define o mínimo; `LOG_DEBUG_SAMPLE` (0–1) amostra debug.
- `trace-id`/`request-id` chegam pelo header `x-trace-id` (ou são gerados), voltam
  nos headers da resposta e fluem via AsyncLocalStorage: serviços não repassam IDs.
- Armazenamento: `app.log_entry` particionada por RANGE mensal (mais partição
  `DEFAULT`), criada por SQL cru na migração `20261013100000_log_system` — o
  `schema.prisma` não declara essas tabelas de propósito. Retenção de 90 dias e
  criação de partições futuras ficam em `app.log_entry_maintenance()`, agendada
  semanalmente quando `pg_cron` existe; sem ela, rode a função manualmente.
- Consulta: `GET /api/v1/admin/logs` (filtros `level`, `service`, `event`,
  `traceId`, `q`, `from`, `to`, `cursor`, `limit`), `GET /api/v1/admin/logs/trace/:id`
  e `GET /api/v1/admin/logs/dead`, todos somente ADMIN. Painel em Gestão → Logs.
- Guia de uso ilustrado: `docs/logs-guia.html` na raiz do repositório.

## Deploy: Render + Vercel

Guia de configuração: [`../docs/render-guia.html`](../docs/render-guia.html).
O banco, os usuários, as sessões e as imagens continuam no Supabase. Não rodar
seed, migrate dev, db push/reset ou migração de mídia para trocar de hospedagem.

- Render: Web Service Node, Root Directory `server`, Node `22.23.3` (arquivo
  `.node-version`), build `npm ci --include=dev && npm run prisma:generate`,
  start `npm start`, health `/health`. `render.yaml` opcional define Free e não
  cria banco. Não copiar `PORT=3001`: o Render fornece a porta.
- `NODE_ENV=production` exige `FRONTEND_ORIGIN=https://ferchumodas.shop` e
  `ORIGIN_PROXY_SECRET` aleatório de 32–256 caracteres (letras, números, `_`, `-`).
  O mesmo segredo fica somente nas envs do Render e do Vercel, nunca em `VITE_*`.
- `/health` fica acessível para o Render. As rotas `/api/*` só aceitam chamadas
  do proxy com o segredo correto e `x-ferchu-client-ip` válido. Acesso direto ao backend
  sem esse segredo retorna 403, inclusive para o catálogo: é intencional.
- Express não confia genericamente em `x-forwarded-for`/hop counts. O rate limit
  usa o IP verificado do proxy (com agrupamento IPv6); localmente usa o socket.
  `middleware.js` captura o IP da plataforma Vercel e sobrescreve o header
  customizado, pois headers padrão podem ser reescritos pelo ingress do Render.
  O segredo não substitui sessão/roles nem a verificação de origem.
- Vercel: `vercel.mjs` encaminha `/api/*` ao host real informado por
  `RENDER_BACKEND_URL`; `middleware.js` injeta o segredo server-only e o IP
  verificado apenas nos headers da requisição upstream. O navegador usa
  `VITE_API_URL=/api/v1`, preservando o cookie HttpOnly/Secure/SameSite=Lax.
  Configuração ausente impede o novo deploy, em vez de publicar localhost.
- Nenhuma resposta `/api` deve ser cacheada. Testar login, refresh, logout,
  `/management`, IPs distintos e cabeçalhos forjados pela cadeia real de proxies.
- Render usa apenas `DATABASE_URL` restrita; se o build Prisma exigir DIRECT_URL,
  repetir essa URL restrita no Render. A URL owner fica no ambiente protegido de
  migrações, fora do processo. Aplicar migrações pendentes separadamente e antes
  do deploy compatível; o Free não tem pre-deploy command.
- `LOG_QUEUE_MAX_ENTRIES`/`LOG_QUEUE_MAX_BYTES` são tetos reais (incluem o lote em
  andamento). Produção emite JSON redigido no stdout. Falha das duas gravações
  descarta entradas com contador; não há promessa de entrega durável durante queda.
  Shutdown aguarda lote ativo e fila, com deadline de 25 s antes dos 30 s do Render.
- `MEDIA_UPLOAD_CONCURRENCY=1` limita uploads completos para reduzir consumo de
  memória na instância de 512 MB; excesso responde 503, sem repetir POST sozinho.
- Free dorme após 15 min sem tráfego; é indicado para validação, não uma promessa
  de disponibilidade para vendas. Não usar pings para contornar essa limitação.

Segurança de dependências: `proxy-addr` e `qs` foram atualizados no lockfile.
Restam avisos do npm audit relacionados ao CLI/configuração Prisma e `deepmerge-ts`;
não executar `npm audit fix --force` (ele sugere downgrade incompatível). Revisar
atualização/patch compatível de Prisma separadamente antes de considerar a loja
pronta para produção. Os testes e o deploy não são substitutos de uma auditoria.

### Testes e alterações futuras

- `npm test`: testes de configuração, transações e SQL em PostgreSQL isolado
  em memória (PGlite). Não usa `.env` para acessar nenhum banco real. Isso não
  substitui os testes de conectividade, concorrência e API no Supabase real.
- `npm run db:check`: verificação somente leitura do banco configurado.
- Novas mudanças: `npm run prisma:migrate -- --name <nome>` somente em banco
  de desenvolvimento descartável, com shadow database adequado. Nunca execute
  `migrate dev`, `db push` ou `migrate reset` no projeto com dados reais.
- Deploy: `npm run prisma:deploy` aplica somente migrações versionadas.
- Tabelas novas precisam de grants restritos e RLS compatível com o grupo técnico.
  A autorização por cliente/STAFF/ADMIN continua no Express, não em `auth.uid()`.
- Pedido mínimo único: 15 peças. Bloqueios de inventário usam ordem determinística;
  conflitos de transações Serializable têm no máximo três tentativas. As funções
  transacionais não podem fazer chamadas externas ou outros efeitos irreversíveis.

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

O modal recebe a quantidade de itens disponíveis de uma variante através de um cálculo que toma em conta
o estoque e o carrinho
EX: Estoque: 10, Carrinho: 2, então a quantidade disponível é (10 - 2) = 8
