import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../.test-dist/index.js';

// A lazy pg Pool is constructed, but anonymous requests must fail before any SQL.
const env = { DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
  WEB_ORIGIN: 'https://church.example', BETTER_AUTH_URL: 'https://api.church.example' };
const id = '00000000-0000-4000-8000-000000000001';

test('every mounted admin route and future admin paths reject anonymous requests at the root boundary', async () => {
  const routes = app.routes.filter(route => route.path.startsWith('/v1/admin/') && route.method !== 'ALL');
  assert.ok(routes.length >= 20);
  for (const route of [...routes, { method: 'POST', path: '/v1/admin/future-operation' }]) {
    const path = route.path.replace(/:[^/]+/g, id);
    const response = await app.request(path, { method: route.method }, env);
    assert.equal(response.status, 401, `${route.method} ${path}`);
    assert.equal((await response.json()).code, 'UNAUTHENTICATED');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('profile, registration, retreat and account identity routes require a session before reading input', async () => {
  for (const [method, path] of [
    ['GET', '/v1/me'], ['PATCH', '/v1/me'], ['POST', '/v1/me/member-verification'],
    ['GET', '/v1/me/registrations'], ['GET', `/v1/me/registrations/${id}`],
    ['PATCH', `/v1/me/registrations/${id}`], ['DELETE', `/v1/me/registrations/${id}`],
    ['POST', `/v1/events/${id}/registrations`], ['GET', '/v1/me/retreats/nehemiah-winter/registration'],
    ['POST', '/v1/retreats/nehemiah-winter/registrations'], ['GET', '/v1/account/session'],
    ['GET', '/v1/me/login-methods'],
  ]) {
    const response = await app.request(path, { method }, env);
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).code, 'UNAUTHENTICATED');
  }
});

test('untrusted browser writes fail before authentication or database work; native writes still require login', async () => {
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await app.request('/v1/admin/bulletins', { method: 'POST', headers }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'UNTRUSTED_ORIGIN');
  }
  for (const headers of [{}, { Origin: env.WEB_ORIGIN }, { Origin: env.BETTER_AUTH_URL }]) {
    const response = await app.request('/v1/admin/bulletins', { method: 'POST', headers }, env);
    assert.equal(response.status, 401);
  }
});

test('raw auth account mutations cannot bypass the account proof routes', async () => {
  for (const path of ['link-social', 'unlink-account', 'delete-user']) {
    const response = await app.request(`/api/auth/${path}/`, { method: 'POST' }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ACCOUNT_OPERATION_REQUIRED');
  }
});
