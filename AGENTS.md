# Repository notes

- This repo has two independently installed Node packages: the React/Vite storefront at the root and the Express API in `server/`; run commands from the matching directory.
- Frontend commands (root): `npm run dev`, `npm run build`, `npm run preview`. There are no test, lint, or typecheck scripts in the root manifest.
- Backend commands (`server/`): `npm run dev` (watch mode) or `npm start`; Prisma tasks are `npm run prisma:generate`, `npm run prisma:migrate -- --name <migration>`, `npm run prisma:deploy`, and `npm run prisma:seed`.
- Backend setup requires PostgreSQL (Supabase or local) and `server/.env`: see `server/README.md`; application tables live in private schema `app`. Generate Prisma client and apply migrations before starting. Do not seed a database receiving real migrated data. The API defaults to port 3001; frontend API URL is `VITE_API_URL=http://localhost:3001/api/v1`.
- The frontend entrypoint is `src/main.jsx` → `src/App.jsx` → `src/routes/AppRoutes.jsx`; pages live in `src/pages/`, shared state in `src/contexts/`, and API calls in `src/services/api.js`.
- The API entrypoint is `server/src/server.js`; request routing is under `server/src/routes/`, with handlers in `controllers/` and business logic in `services/`. Prisma schema, migrations, and seed are under `server/prisma/`.
- Preserve Prisma migrations as the database change history; use a new migration for schema changes rather than editing an already-applied migration. `prisma:deploy` applies committed migrations for deployment.
- Original MySQL migrations are historical records in `server/prisma/history/mysql/`, not active migrations. Backend tests: `npm test` in `server/`; SQL tests use an isolated in-memory PostgreSQL, never the configured database.
- Images live in public Supabase Storage bucket `storefront-images`; privileged Storage keys stay only in backend secrets. Uploads require existing ADMIN sessions. `npm run media:migrate -- --verify` checks the image manifest; never overwrite/delete objects referenced by order snapshots.
