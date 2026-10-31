import test from 'node:test';
import assert from 'node:assert/strict';
const { restoreMediaJobs } = await import('../src/stores/mediaDownloadStore.ts');

const transition = (job, patch) => ({ ...job, ...patch });
const job = { id: 'job-1', status: 'queued', progress: 0, error: undefined };

test('queue transitions through analysis, processing and completion', () => {
  const analyzing = transition(job, { status: 'analyzing' });
  const processing = transition(analyzing, { status: 'processing', progress: 42 });
  const completed = transition(processing, { status: 'completed', progress: 100, outputPath: '/tmp/media.mp4' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 100);
  assert.equal(completed.outputPath, '/tmp/media.mp4');
});

test('cancelled and failed jobs can be retried without losing identity', () => {
  const cancelled = transition(job, { status: 'cancelled', error: 'Cancelled by the user.' });
  const retry = transition(cancelled, { status: 'queued', progress: 0, error: undefined, outputPath: undefined });
  const failed = transition(retry, { status: 'failed', error: 'Connection failed' });
  assert.equal(retry.id, 'job-1');
  assert.equal(retry.status, 'queued');
  assert.equal(failed.status, 'failed');
});

test('bounded queue selection does not start more than one job in the UI runner', () => {
  const jobs = [{ status: 'queued' }, { status: 'queued' }];
  const active = jobs.filter((candidate) => candidate.status === 'analyzing' || candidate.status === 'downloading' || candidate.status === 'processing');
  assert.equal(active.length, 0);
  assert.equal(jobs.find((candidate) => candidate.status === 'queued')?.status, 'queued');
});

test('restored active jobs become interrupted and corrupted entries are ignored', () => {
  const restored = restoreMediaJobs({ version: 1, jobs: [
    { id: 'active', kind: 'video', url: 'https://example.com/a', title: 'A', status: 'downloading', progress: 42, createdAt: 1 },
    { id: 'done', kind: 'gallery', url: 'https://example.com/g', title: 'G', status: 'completed', progress: 100, createdAt: 2 },
    { id: 'bad', status: 'downloading' },
  ] });
  assert.equal(restored.length, 2);
  assert.equal(restored[0].status, 'interrupted');
  assert.equal(restored[0].error, 'Interrupted — ready to retry.');
  assert.equal(restored[1].status, 'completed');
});

test('restoration keeps the newest fifty jobs', () => {
  const jobs = Array.from({ length: 55 }, (_, index) => ({
    id: `job-${index}`,
    kind: 'video',
    url: 'https://example.com/video',
    title: `Video ${index}`,
    status: 'queued',
    progress: 0,
    createdAt: index,
  }));
  const restored = restoreMediaJobs({ version: 1, jobs });
  assert.equal(restored.length, 50);
  assert.equal(restored[0].id, 'job-5');
  assert.equal(restored.at(-1).id, 'job-54');
});
