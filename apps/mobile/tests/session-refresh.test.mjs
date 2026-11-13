import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRefreshGate } from '../src/services/session-refresh.ts';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function session(initialUser = 'A') {
  const gate = createSessionRefreshGate();
  const state = { user: initialUser, error: null, settled: 0 };
  const refresh = pending => gate.run(() => pending.promise, {
    success: user => { state.user = user; state.error = null; },
    failure: error => { state.user = null; state.error = error; },
    settled: () => { state.settled++; },
  });
  return { gate, state, refresh };
}

test('a response begun before logout cannot restore the signed-out user', async () => {
  const { gate, state, refresh } = session();
  const old = deferred(); const request = refresh(old);
  const epoch = gate.beginAuthChange();
  assert.equal(gate.finishAuthChange(epoch), true);
  state.user = null;
  old.resolve('A'); await request;
  assert.deepEqual(state, { user: null, error: null, settled: 0 });
});

test('a late old-account response or error cannot replace a newly signed-in account', async () => {
  for (const fail of [false, true]) {
    const { gate, state, refresh } = session();
    const old = deferred(); const request = refresh(old);
    const epoch = gate.beginAuthChange();
    assert.equal(gate.finishAuthChange(epoch), true);
    const latest = deferred(); const replacement = refresh(latest);
    latest.resolve('B'); await replacement;
    if (fail) old.reject(new Error('old session expired')); else old.resolve('A');
    await request;
    assert.deepEqual(state, { user: 'B', error: null, settled: 1 });
  }
});

test('automatic lookups during an authentication change are held until its final refresh', async () => {
  const { gate, state, refresh } = session();
  const epoch = gate.beginAuthChange();
  let loads = 0;
  await gate.run(async () => { loads++; return 'A'; }, {
    success: () => assert.fail('a transient session must not be published'),
    failure: () => assert.fail('a transient session error must not be published'),
    settled: () => assert.fail('a transient lookup must not end loading'),
  });
  assert.equal(loads, 0);
  gate.finishAuthChange(epoch);
  const next = deferred(); const request = refresh(next);
  next.resolve('B'); await request;
  assert.equal(state.user, 'B');
});

test('failed logout keeps the existing user and still invalidates earlier lookups', async () => {
  const { gate, state, refresh } = session();
  const old = deferred(); const request = refresh(old);
  const epoch = gate.beginAuthChange();
  // Failure releases the authentication transition without clearing the user.
  gate.finishAuthChange(epoch);
  old.reject(new Error('lookup from before failed logout')); await request;
  assert.deepEqual(state, { user: 'A', error: null, settled: 0 });
  const current = deferred(); const retry = refresh(current);
  current.resolve('A'); await retry;
  assert.equal(state.user, 'A'); assert.equal(state.settled, 1);
});

test('only the latest same-session lookup may publish, and invalidated requests remain silent', async () => {
  const { gate, state, refresh } = session();
  const first = deferred(); const second = deferred();
  const older = refresh(first); const latest = refresh(second);
  second.resolve('updated A'); await latest;
  first.reject(new Error('outdated failure')); await older;
  assert.deepEqual(state, { user: 'updated A', error: null, settled: 1 });
  const pending = deferred(); const stale = refresh(pending);
  gate.invalidate(); pending.resolve('outlived component'); await stale;
  assert.equal(state.user, 'updated A'); assert.equal(state.settled, 1);
});
