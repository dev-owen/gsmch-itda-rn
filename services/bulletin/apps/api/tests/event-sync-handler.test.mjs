import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { sourceOrigin, syncAdminRoutes } from '../.test-dist/event-sync.js';
import worker from '../.test-dist/index.js';

const env = { BETTER_AUTH_URL: 'https://itda.example.org', WEB_ORIGIN: 'https://itda.example.org' };
test('sync accepts only a configured HTTPS origin and prevents importing the app into itself', () => {
  assert.equal(sourceOrigin(env), 'https://gsmch-youth-bulletin.gsmch-youth-dev.workers.dev');
  for (const origin of ['http://source.example', 'https://user:password@source.example', 'https://source.example/path', 'https://source.example?q=1']) {
    assert.throws(() => sourceOrigin({ ...env, BULLETIN_SOURCE_ORIGIN: origin }), /INVALID_SOURCE_ORIGIN/);
  }
  assert.throws(() => sourceOrigin({ ...env, BULLETIN_SOURCE_ORIGIN: env.BETTER_AUTH_URL }), /SOURCE_LOOP/);
});
test('anonymous callers cannot fetch sync history or trigger a network/database sync', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('pool', { query() { throw new Error('database must not be accessed'); } }); await next(); });
  app.route('/v1', syncAdminRoutes);
  app.get('/v1/public-test', (c) => c.json({ public: true }));
  for (const method of ['GET','POST']) {
    const response = await app.request('/v1/admin/event-sync', { method, ...(method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}) }, env);
    assert.equal(response.status, 401);
  }
  assert.equal((await app.request('/v1/public-test', {}, env)).status, 200);
});
test('the Worker retains HTTP serving and registers background work through waitUntil', async () => {
  assert.equal(typeof worker.fetch, 'function');
  const work = [];
  worker.scheduled({ cron: '0 0 * * MON' }, env, { waitUntil(promise) { work.push(promise); } });
  assert.equal(work.length, 1);
  await assert.rejects(work[0], /DATABASE_NOT_CONFIGURED/);
});
