import assert from 'node:assert/strict';
import test from 'node:test';
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
const { useVideoGifStore } = await import('../src/stores/videoGifStore.ts');

const item = (overrides = {}) => ({
  id: 'clip-1',
  sourcePath: '/tmp/source.mp4',
  sourceName: 'source.mp4',
  name: 'source_001.gif',
  inPoint: 1,
  outPoint: 3,
  width: 640,
  fps: 12,
  quality: 80,
  outputDirectory: '/tmp',
  status: 'queued',
  ...overrides,
});

test.beforeEach(() => useVideoGifStore.getState().clear());

test('queue keeps independent clip snapshots and explicit updates', () => {
  const store = useVideoGifStore.getState();
  store.add(item());
  store.update('clip-1', { inPoint: 2, outPoint: 4, width: 480, progress: 0.5 });
  const saved = useVideoGifStore.getState().queue[0];
  assert.equal(saved.inPoint, 2);
  assert.equal(saved.outPoint, 4);
  assert.equal(saved.width, 480);
  assert.equal(saved.progress, 0.5);
});

test('duplicate resets output state without mutating the source clip', () => {
  const store = useVideoGifStore.getState();
  store.add(item({ status: 'completed', outputPath: '/tmp/source_001.gif', progress: 1 }));
  store.duplicate('clip-1', 'source_001-copy.gif');
  const queue = useVideoGifStore.getState().queue;
  assert.equal(queue.length, 2);
  assert.equal(queue[0].status, 'completed');
  assert.equal(queue[1].status, 'queued');
  assert.equal(queue[1].outputPath, undefined);
  assert.notEqual(queue[0].id, queue[1].id);
});
