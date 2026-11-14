// Unit tests must not discover developer credentials through dotenv.
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = new URL('./no-unit-dotenv', import.meta.url).pathname;
process.env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:9/ferchu_unit?schema=app';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.ORIGIN_PROXY_SECRET = '';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
