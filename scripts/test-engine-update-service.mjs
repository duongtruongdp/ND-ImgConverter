import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_UPDATE_CHECK_INTERVAL_MS,
  automaticCheckDelay,
  checkEngineUpdatesNow,
  dismissEngineUpdate,
  isEngineUpdateDismissed,
  readEngineUpdateCheckState,
  resetInFlightEngineUpdateCheck,
  startEngineUpdateAutoCheck,
} from '../src/components/settings/engineUpdateService.ts';

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

const result = (state = 'notConfigured') => ({ state, checkedAt: '1', manifestRevision: state === 'updateAvailable' ? 7 : undefined, message: state === 'updateAvailable' ? 'An engine update is ready.' : 'Updates are not configured.', updates: [] });

test('automatic checks use startup delay, 24-hour success interval and bounded failure backoff', () => {
  assert.equal(automaticCheckDelay(null), 800);
  const now = 100000;
  assert.equal(automaticCheckDelay({ lastAttemptAt: now, failureCount: 0, lastState: 'upToDate' }, now), ENGINE_UPDATE_CHECK_INTERVAL_MS);
  assert.equal(automaticCheckDelay({ lastAttemptAt: now, failureCount: 1, lastState: 'failed' }, now), 5 * 60 * 1000);
  assert.equal(automaticCheckDelay({ lastAttemptAt: now, failureCount: 2, lastState: 'failed' }, now), 10 * 60 * 1000);
});

test('concurrent engine checks share one backend request and persist a not-configured result', async () => {
  resetInFlightEngineUpdateCheck();
  const values = storage();
  let calls = 0;
  const invokeImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return result();
  };
  const first = checkEngineUpdatesNow({ invokeImpl, storage: values, now: 500 });
  const second = checkEngineUpdatesNow({ invokeImpl, storage: values, now: 500 });
  assert.strictEqual(first, second);
  assert.equal((await first).state, 'notConfigured');
  assert.equal(calls, 1);
  assert.equal(readEngineUpdateCheckState(values)?.lastState, 'notConfigured');
  resetInFlightEngineUpdateCheck();
});

test('backend failures are remembered for bounded retry backoff without showing an update', async () => {
  resetInFlightEngineUpdateCheck();
  const values = storage();
  await assert.rejects(
    checkEngineUpdatesNow({ invokeImpl: async () => { throw new Error('offline'); }, storage: values, now: 900 }),
    /offline/,
  );
  const state = readEngineUpdateCheckState(values);
  assert.equal(state?.lastState, 'failed');
  assert.equal(state?.failureCount, 1);
  assert.equal(automaticCheckDelay(state, 900), 5 * 60 * 1000);
  resetInFlightEngineUpdateCheck();
});

test('auto-check scheduler performs one deferred check and stops cleanly', async () => {
  resetInFlightEngineUpdateCheck();
  const values = storage();
  const timers = [];
  const clear = (timer) => { timer.cancelled = true; };
  const set = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  const seen = [];
  const stop = startEngineUpdateAutoCheck({
    storage: values,
    invokeImpl: async () => result(),
    onResult: (value) => seen.push(value.state),
    setTimeoutImpl: set,
    clearTimeoutImpl: clear,
  });
  assert.equal(timers[0].delay, 800);
  await timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['notConfigured']);
  stop();
  assert.equal(timers.at(-1).cancelled, true);
});

test('dismissal is scoped to the verified manifest revision and engine version', () => {
  const values = storage();
  const asset = { engine: 'yt-dlp', version: '2026.1' };
  assert.equal(isEngineUpdateDismissed(7, asset, values), false);
  dismissEngineUpdate(7, asset, values);
  assert.equal(isEngineUpdateDismissed(7, asset, values), true);
  assert.equal(isEngineUpdateDismissed(8, asset, values), false);
});
