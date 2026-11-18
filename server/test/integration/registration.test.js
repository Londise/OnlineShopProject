import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { prisma, owner, serve, resetDatabase, closeDatabase, sessionFixture, verificationMessages,
  catalogFixture, orderInput, createApp } from '../../test-support/integration.js';
import { createOrder } from '../../src/services/order.service.js';

beforeEach(resetDatabase);
after(closeDatabase);
const post = (body, cookie) => ({ method: 'POST', headers: { 'content-type': 'application/json',
  ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const signup = email => ({ email, name: 'Ana Silva', password: 'signup-password-42', role: 'ADMIN' });
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];

test('signup creates a real unverified CUSTOMER with hashed chosen credentials, but never exposes account existence or signs in', async t => {
  const existing = await sessionFixture('CUSTOMER');
  const admin = await sessionFixture('ADMIN');
  const inactive = await sessionFixture('CUSTOMER', { active: false });
  const api = await serve(); t.after(api.close);
  const responses = [];
  for (const email of ['new@example.test', existing.user.email, admin.user.email, inactive.user.email]) {
    const response = await api.request('/api/v1/auth/register', post(signup(email)));
    assert.equal(response.status, 202);
    assert.match(cookieOf(response), /^ferchu_session_verification=[A-Za-z0-9_-]{43}$/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
    assert.doesNotMatch(response.headers.get('set-cookie'), /ferchu_session=/);
    responses.push(await response.json());
  }
  assert.ok(responses.every(value => JSON.stringify(value) === JSON.stringify(responses[0])));
  assert.equal(await prisma.user.count(), 4);
  assert.equal(await prisma.authSession.count(), 3);
  const created = await prisma.user.findUnique({ where: { email: 'new@example.test' } });
  assert.equal(created.role, 'CUSTOMER'); assert.equal(created.name, 'Ana Silva');
  assert.equal(created.emailVerifiedAt, null);
  assert.ok(await argon2.verify(created.passwordHash, signup().password));
  assert.equal(await prisma.pendingRegistration.count(), 4);
  assert.equal(verificationMessages.length, 4);
  assert.ok(!JSON.stringify(responses).includes('token'));
});

test('same-browser email confirmation asks for no credentials, changes no name/password, grants no login and is single-use', async t => {
  const api = await serve(); t.after(api.close);
  const registered = await api.request('/api/v1/auth/register', post(signup('OWNER@example.test')));
  const proof = cookieOf(registered), token = verificationMessages[0].token;
  const before = await prisma.user.findUnique({ where: { email: 'owner@example.test' } });
  const repeated = await api.request('/api/v1/auth/register', post(signup('owner@example.test'), proof));
  assert.equal(cookieOf(repeated), proof);
  assert.equal(verificationMessages[1].token, token);
  assert.equal(verificationMessages[1].nonce, verificationMessages[0].nonce);
  assert.equal((await api.request('/api/v1/auth/me', { headers: { cookie: proof } })).status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: before.id } })).emailVerifiedAt, null);
  const response = await api.request('/api/v1/auth/verify-email',
    post({ token, name: 'Injected change', password: 'injected-password', role: 'ADMIN' }, proof));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true });
  assert.doesNotMatch(response.headers.get('set-cookie'), /ferchu_session=/);
  const user = await prisma.user.findUnique({ where: { id: before.id } });
  assert.equal(user.name, before.name); assert.equal(user.passwordHash, before.passwordHash);
  assert.equal(user.role, 'CUSTOMER'); assert.ok(user.emailVerifiedAt);
  assert.equal(await prisma.authSession.count(), 0);
  assert.equal((await api.request('/api/v1/auth/verify-email', post({ token }, proof))).status, 422);
  const login = await api.request('/api/v1/auth/login', post({ email: user.email, password: signup().password }));
  assert.equal(login.status, 200);
  assert.ok((await login.json()).user.emailVerifiedAt);
});

test('a pre-registration attacker cannot turn a victim clicking mail into a verified account; duplicate signup cannot steal browser proof', async t => {
  const api = await serve(); t.after(api.close);
  const first = await api.request('/api/v1/auth/register', post(signup('victim@example.test')));
  const attackerProof = cookieOf(first), token = verificationMessages[0].token;
  const duplicate = await api.request('/api/v1/auth/register', post({ ...signup('victim@example.test'),
    name: 'Mailbox owner', password: 'different-owner-password-42' }));
  const victimProof = cookieOf(duplicate);
  assert.notEqual(victimProof, attackerProof);
  for (const cookie of [undefined, victimProof]) {
    const response = await api.request('/api/v1/auth/verify-email', post({ token }, cookie));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'VERIFICATION_SIGN_IN_REQUIRED');
  }
  const saved = await prisma.user.findUnique({ where: { email: 'victim@example.test' } });
  assert.equal(saved.emailVerifiedAt, null);
  assert.ok(await argon2.verify(saved.passwordHash, signup().password));
  assert.equal(await prisma.authSession.count(), 0);
  assert.equal((await prisma.pendingRegistration.findFirst()).consumedAt, null);
});

test('unverified customers can log in/read their profile, but cannot create orders, read legacy orders or reach admin; guests remain supported', async t => {
  const fixture = await sessionFixture('CUSTOMER', { email: 'Legacy@Example.test', emailVerifiedAt: null,
    passwordHash: await argon2.hash('legacy-password-42') });
  const api = await serve(); t.after(api.close);
  const login = await api.request('/api/v1/auth/login', post({ email: 'legacy@example.test', password: 'legacy-password-42' }));
  assert.equal(login.status, 200);
  const current = cookieOf(login), me = await api.request('/api/v1/auth/me', { headers: { cookie: current } });
  assert.equal((await me.json()).user.emailVerifiedAt, null);
  const { variant } = await catalogFixture();
  for (const response of [
    await api.request('/api/v1/orders', post(orderInput(variant.id), current)),
    await api.request('/api/v1/orders/me', { headers: { cookie: current } }),
  ]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'EMAIL_NOT_VERIFIED');
  }
  await assert.rejects(createOrder(orderInput(variant.id), fixture.user), { code: 'EMAIL_NOT_VERIFIED' });
  assert.equal((await api.request('/api/v1/admin/inventory', { headers: { cookie: current } })).status, 403);
  assert.equal((await api.request('/api/v1/orders', post(orderInput(variant.id)))).status, 201);
  await api.request('/api/v1/auth/register', post(signup('legacy@example.test')));
  const before = await prisma.user.findUnique({ where: { id: fixture.user.id } });
  const verified = await api.request('/api/v1/auth/verify-email', post({ token: verificationMessages[0].token }, current));
  assert.equal(verified.status, 200);
  const after = await prisma.user.findUnique({ where: { id: fixture.user.id } });
  assert.equal(after.id, before.id); assert.equal(after.passwordHash, before.passwordHash); assert.equal(after.name, before.name);
  assert.ok(after.emailVerifiedAt);
  assert.ok((await prisma.authSession.findUnique({ where: { id: fixture.session.id } })).revokedAt);
  assert.equal((await api.request('/api/v1/orders/me', { headers: { cookie: fixture.cookie } })).status, 401);
  assert.equal((await api.request('/api/v1/orders/me', { headers: { cookie: current } })).status, 200);
});

test('expired, invalid and concurrently consumed tokens never verify twice or create sessions', async t => {
  const api = await serve(); t.after(api.close);
  const expired = await api.request('/api/v1/auth/register', post(signup('expired@example.test')));
  await owner.pendingRegistration.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await api.request('/api/v1/auth/verify-email', post({ token: verificationMessages[0].token }, cookieOf(expired)))).status, 422);
  assert.equal((await api.request('/api/v1/auth/verify-email', post({ token: 'Z'.repeat(43) }))).status, 422);
  const race = await api.request('/api/v1/auth/register', post(signup('race@example.test')));
  const token = verificationMessages.find(message => message.email === 'race@example.test').token;
  const responses = await Promise.all([api.request('/api/v1/auth/verify-email', post({ token }, cookieOf(race))),
    api.request('/api/v1/auth/verify-email', post({ token }, cookieOf(race)))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 422]);
  assert.equal(await prisma.user.count(), 2); assert.equal(await prisma.authSession.count(), 0);
  assert.equal(await prisma.user.count({ where: { emailVerifiedAt: { not: null } } }), 1);
});

test('public confirmation never overwrites verified users, reactivates disabled users or verifies privileged identities', async t => {
  const fixtures = [await sessionFixture('CUSTOMER'), await sessionFixture('ADMIN'),
    await sessionFixture('CUSTOMER', { active: false, emailVerifiedAt: null })];
  const api = await serve(); t.after(api.close);
  for (const fixture of fixtures) {
    const response = await api.request('/api/v1/auth/register', post(signup(fixture.user.email)));
    assert.equal(response.status, 202);
    const token = verificationMessages.find(message => message.email === fixture.user.email).token;
    const confirmation = await api.request('/api/v1/auth/verify-email', post({ token }, fixture.cookie));
    assert.equal(confirmation.status, fixture.user.active ? 409 : 403);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: fixture.user.id } }), fixture.user);
  }
});

test('resending requires login, has a persistent atomic per-account cooldown, rotates expired links and recovers without new credentials', async t => {
  const fixture = await sessionFixture('CUSTOMER', { emailVerifiedAt: null });
  const apis = [await serve(), await serve()]; apis.forEach(api => t.after(api.close));
  assert.equal((await apis[0].request('/api/v1/auth/resend-verification', post({}))).status, 401);
  const first = await apis[0].request('/api/v1/auth/resend-verification', post({}, fixture.cookie));
  assert.equal(first.status, 202);
  const oldToken = verificationMessages[0].token;
  assert.equal((await apis[1].request('/api/v1/auth/resend-verification', post({}, fixture.cookie))).status, 429);
  await owner.pendingRegistration.updateMany({ data: { createdAt: new Date(0), expiresAt: new Date(0) } });
  const replies = await Promise.all(apis.map(api => api.request('/api/v1/auth/resend-verification', post({}, fixture.cookie))));
  assert.deepEqual(replies.map(r => r.status).sort(), [202, 429]);
  assert.equal(verificationMessages.length, 2);
  const newToken = verificationMessages[1].token;
  assert.notEqual(newToken, oldToken);
  assert.equal((await apis[0].request('/api/v1/auth/verify-email', post({ token: oldToken }, fixture.cookie))).status, 422);
  assert.equal((await apis[0].request('/api/v1/auth/verify-email', post({ token: newToken }, fixture.cookie))).status, 200);
  assert.equal(await prisma.user.count(), 1);
});

test('provider failures leave the account unverified and recoverable; malformed signup never creates an account', async t => {
  const api = await serve(createApp({ verificationMailer: async () => { throw new Error('local mail outage'); } }));
  t.after(api.close);
  for (const body of [{ email: 'missing@example.test' }, { ...signup('bad@example.test'), password: 'short' }])
    assert.equal((await api.request('/api/v1/auth/register', post(body))).status, 422);
  assert.equal(await prisma.user.count(), 0);
  assert.equal((await api.request('/api/v1/auth/register', post(signup('outage@example.test')))).status, 500);
  const saved = await prisma.user.findUnique({ where: { email: 'outage@example.test' } });
  assert.equal(saved.emailVerifiedAt, null);
  assert.ok(await argon2.verify(saved.passwordHash, signup().password));
  assert.equal((await api.request('/api/v1/auth/login', post({ email: saved.email, password: signup().password }))).status, 200);
});
