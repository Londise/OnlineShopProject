import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { prisma, owner, serve, resetDatabase, closeDatabase, sessionFixture, verificationMessages } from '../../test-support/integration.js';

beforeEach(resetDatabase);
after(closeDatabase);
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const verifyBody = token => ({ token, name: 'Mailbox owner', password: 'owner-selected-password-42', role: 'ADMIN' });

test('registration status/body/cookies are identical for new, verified, inactive and privileged emails', async t => {
  const existing = await sessionFixture('CUSTOMER');
  const admin = await sessionFixture('ADMIN');
  const inactive = await sessionFixture('CUSTOMER', { active: false });
  const api = await serve(); t.after(api.close);
  const responses = [];
  for (const email of ['new@example.test', existing.user.email, admin.user.email, inactive.user.email]) {
    const response = await api.request('/api/v1/auth/register', post({ email, password: 'attacker-selected-password', role: 'ADMIN' }));
    assert.equal(response.status, 202); assert.equal(response.headers.get('set-cookie'), null);
    responses.push(await response.json());
  }
  assert.ok(responses.every(value => JSON.stringify(value) === JSON.stringify(responses[0])));
  assert.equal(await prisma.user.count(), 3);
  assert.equal(await prisma.pendingRegistration.count(), 4);
  assert.equal(verificationMessages.length, 4);
  assert.ok(!JSON.stringify(responses).includes('token'));
});

test('opening/requesting a link never activates a user; mailbox owner chooses password and token is single-use', async t => {
  const api = await serve(); t.after(api.close);
  await api.request('/api/v1/auth/register', post({ email: 'owner@example.test', name: 'Attacker', password: 'attacker-selected-password' }));
  const token = verificationMessages[0].token;
  await api.request('/api/v1/auth/register', post({ email: 'OWNER@example.test' }));
  assert.equal(verificationMessages[1].token, token);
  assert.equal(verificationMessages[1].nonce, verificationMessages[0].nonce);
  assert.equal(await prisma.user.count(), 0);
  const response = await api.request('/api/v1/auth/verify-email', post(verifyBody(token)));
  assert.equal(response.status, 200);
  const user = await prisma.user.findUnique({ where: { email: 'owner@example.test' } });
  assert.equal(user.role, 'CUSTOMER'); assert.equal(user.name, 'Mailbox owner');
  assert.ok(user.emailVerifiedAt);
  assert.equal(await argon2.verify(user.passwordHash, 'attacker-selected-password'), false);
  assert.equal(await argon2.verify(user.passwordHash, 'owner-selected-password-42'), true);
  const replay = await api.request('/api/v1/auth/verify-email', post(verifyBody(token)));
  assert.equal(replay.status, 422);
  assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
});

test('legacy unverified customer cannot log in or reuse a session; verification preserves ID and revokes old access', async t => {
  const fixture = await sessionFixture('CUSTOMER', { email: 'Legacy@Example.test', emailVerifiedAt: null,
    passwordHash: await argon2.hash('attacker-selected-password') });
  const api = await serve(); t.after(api.close);
  assert.equal((await api.request('/api/v1/orders/me', { headers: { cookie: fixture.cookie } })).status, 401);
  const login = await api.request('/api/v1/auth/login', post({ email: fixture.user.email, password: 'attacker-selected-password' }));
  assert.equal(login.status, 401);
  await api.request('/api/v1/auth/register', post({ email: 'legacy@example.test' }));
  const response = await api.request('/api/v1/auth/verify-email', post(verifyBody(verificationMessages[0].token)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, fixture.user.id);
  assert.ok((await prisma.authSession.findUnique({ where: { id: fixture.session.id } })).revokedAt);
  assert.equal((await api.request('/api/v1/orders/me', { headers: { cookie: fixture.cookie } })).status, 401);
});

test('expired, invalid and concurrently consumed verification tokens cannot create extra accounts/sessions', async t => {
  const api = await serve(); t.after(api.close);
  await api.request('/api/v1/auth/register', post({ email: 'expired@example.test' }));
  await owner.pendingRegistration.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await api.request('/api/v1/auth/verify-email', post(verifyBody(verificationMessages[0].token)))).status, 422);
  assert.equal((await api.request('/api/v1/auth/verify-email', post(verifyBody('Z'.repeat(43))))).status, 422);
  await api.request('/api/v1/auth/register', post({ email: 'race@example.test' }));
  const token = verificationMessages.find(message => message.email === 'race@example.test').token;
  const responses = await Promise.all([api.request('/api/v1/auth/verify-email', post(verifyBody(token))),
    api.request('/api/v1/auth/verify-email', post(verifyBody(token)))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 422]);
  assert.equal(await prisma.user.count(), 1); assert.equal(await prisma.authSession.count(), 1);
});

test('public verification cannot overwrite verified customers, reactivate disabled users or replace staff credentials', async t => {
  const fixtures = [await sessionFixture('CUSTOMER'), await sessionFixture('ADMIN'),
    await sessionFixture('CUSTOMER', { active: false, emailVerifiedAt: null })];
  const api = await serve(); t.after(api.close);
  for (const fixture of fixtures) {
    await api.request('/api/v1/auth/register', post({ email: fixture.user.email }));
    const token = verificationMessages.find(message => message.email === fixture.user.email).token;
    assert.equal((await api.request('/api/v1/auth/verify-email', post(verifyBody(token)))).status, 409);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: fixture.user.id } }), fixture.user);
  }
});
