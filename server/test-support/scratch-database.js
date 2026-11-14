import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

// Only additional databases inside the already-disposable loopback cluster.
// No caller-supplied name/URL can reach CREATE or DROP DATABASE.
export async function scratchDatabase(t) {
  assert.equal(process.env.FERCHU_ISOLATED_TEST, 'embedded-postgres');
  const url = new URL(process.env.TEST_INSTALL_URL);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/ferchu_test');
  const name = `ferchu_scratch_${randomBytes(6).toString('hex')}`;
  const adminUrl = new URL(url); adminUrl.searchParams.delete('schema');
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  let client, created = false;
  t.after(async () => {
    try {
      await client?.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally { await admin.end(); }
  });
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  url.pathname = `/${name}`;
  const connection = new URL(url); connection.searchParams.delete('schema');
  client = new Client({ connectionString: connection.href });
  await client.connect();
  return { client, url: url.href };
}
