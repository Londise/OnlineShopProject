import test from 'node:test';
import assert from 'node:assert/strict';
import { sendVerificationEmail } from '../src/services/email.service.js';

const config = { RESEND_API_KEY: 're_local_fixture_only', EMAIL_FROM: 'verify@send.example.test',
  EMAIL_REPLY_TO: 'contact@example.test', FRONTEND_ORIGIN: 'https://staging.example.test' };
test('verification email uses fixed Resend HTTPS endpoint, fragment link, idempotency and server-only credentials', async () => {
  let request;
  await sendVerificationEmail({ email: 'owner@example.test', token: 'A'.repeat(43), nonce: 'local-fixture-nonce' }, { config,
    fetchImpl: async (url, options) => { request = { url, ...options }; return new Response('{"id":"fixture"}'); } });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers.Authorization, `Bearer ${config.RESEND_API_KEY}`);
  assert.equal(request.headers['Idempotency-Key'], 'verify/local-fixture-nonce');
  const body = JSON.parse(request.body);
  assert.deepEqual(body.to, ['owner@example.test']);
  assert.equal(body.reply_to, config.EMAIL_REPLY_TO);
  assert.ok(body.text.includes(`https://staging.example.test/verify-email#token=${'A'.repeat(43)}`));
  assert.ok(body.text.includes('seu nome e sua senha continuam os mesmos'));
  assert.ok(!body.text.includes('nova senha'));
  assert.ok(!request.body.includes(config.RESEND_API_KEY));
});
test('missing email configuration and provider/network/redirect failures never expose tokens or diagnostics', async () => {
  for (const fetchImpl of [
    async () => new Response('private diagnostic re_fixture_secret', { status: 403 }),
    async () => { throw new Error('private network diagnostic'); },
  ]) await assert.rejects(sendVerificationEmail({ email: 'owner@example.test', token: 'A'.repeat(43), nonce: 'fixture' },
    { config, fetchImpl }), error => error.status === 503 && !JSON.stringify(error).includes('private'));
  await assert.rejects(sendVerificationEmail({ email: 'owner@example.test', token: 'A'.repeat(43), nonce: 'fixture' },
    { config: {} }), { code: 'EMAIL_UNAVAILABLE' });
});
