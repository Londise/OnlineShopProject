import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const serverDir = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

// Never accepts DATABASE_URL, DIRECT_URL or a caller-provided directory.
// The only data removed here is the directory this invocation created.
export async function startTestDatabase({ signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const { pg_ctl: pgCtl } = await import(`@embedded-postgres/${platform}-${process.arch}`);
  const control = args => new Promise((resolve, reject) => {
    // Descendants can retain inherited pipe handles on Windows. pg_ctl logs
    // startup to its own file; no child needs a pipe back into this process.
    const child = spawn(pgCtl, args, { stdio: 'ignore', timeout: 45000, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`pg_ctl failed (${code ?? signal})`)));
  });
  const directory = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'ferchu-pg-'));
  let port;
  try { port = await unusedPort(); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const password = randomBytes(24).toString('hex');
  const messages = [];
  let started = false;
  const pg = new EmbeddedPostgres({
    databaseDir: join(directory, 'cluster'), port, user: 'installer', password,
    persistent: true, createPostgresUser: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'max_connections=30'],
    onLog: message => messages.push(String(message)), onError: message => messages.push(String(message)),
  });
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|systemdrive)$/i.test(key)));
  const installUrl = `postgresql://installer:${password}@127.0.0.1:${port}/ferchu_test?schema=app`;
  Object.assign(environment, {
    NODE_ENV: 'test', DOTENV_CONFIG_PATH: join(directory, 'no-dotenv'),
    DATABASE_URL: installUrl, DIRECT_URL: installUrl,
    FRONTEND_ORIGIN: 'http://localhost:5173', ORIGIN_PROXY_SECRET: '',
    WHATSAPP_NUMBER: '5511999998888', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '',
    FERCHU_ISOLATED_TEST: 'embedded-postgres',
  });
  let admin;
  const close = async () => {
    try {
      if (admin) await admin.end();
    } finally {
      admin = undefined;
      if (started) {
        await control(['-D', join(directory, 'cluster'), 'stop', '-m', 'fast', '-w', '-t', '30']);
        started = false;
      }
      // Never remove the directory if pg_ctl failed to stop its live server.
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    onProgress({ phase: 'allocated', directory, port });
    signal?.throwIfAborted();
    await pg.initialise();
    signal?.throwIfAborted();
    // pg_ctl detaches the postmaster without inherited Node pipe handles and
    // performs a bounded, graceful shutdown on Windows as well as Unix.
    await control(['-D', join(directory, 'cluster'), '-l', join(directory, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${port} -c max_connections=30`, 'start', '-w', '-t', '30']);
    started = true;
    onProgress({ phase: 'postgres-started', directory, port });
    signal?.throwIfAborted();
    admin = pg.getPgClient('postgres', '127.0.0.1');
    await admin.connect();
    signal?.throwIfAborted();
    await admin.query('CREATE DATABASE ferchu_test');
    await admin.end();
    admin = pg.getPgClient('ferchu_test', '127.0.0.1');
    await admin.connect();
    await admin.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
    for (const args of [['validate'], ['generate'], ['migrate', 'deploy']]) {
      signal?.throwIfAborted();
      onProgress({ phase: `prisma-${args.join('-')}`, directory, port });
      await exec(process.execPath, [prismaCli, ...args], { cwd: serverDir, env: environment, timeout: 60000 });
    }
    signal?.throwIfAborted();
    await admin.query(`CREATE ROLE ferchu_test_runtime LOGIN PASSWORD '${password}' IN ROLE ferchu_backend`);
    environment.TEST_INSTALL_URL = installUrl;
    environment.DATABASE_URL = installUrl.replace('installer:', 'ferchu_test_runtime:');
    environment.DIRECT_URL = environment.DATABASE_URL;
    onProgress({ phase: 'ready', directory, port });
    signal?.throwIfAborted();
    return { environment, close };
  } catch (error) {
    await close();
    throw new Error(`Cannot initialize disposable PostgreSQL: ${String(error.message).replaceAll(password, '[REDACTED]')}\n${messages.join('').replaceAll(password, '[REDACTED]')}`);
  }
}
