import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const gallery = resolve(process.env.ND_GALLERY_DL || 'src-tauri/binaries/gallery-dl');
const fixtureServer = resolve('scripts/fixtures/media-fixture-server.mjs');
const root = mkdtempSync(join(tmpdir(), 'nd-media-fixtures-'));
const server = spawn(process.execPath, [fixtureServer, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const [line] = await once(server.stdout, 'data');
const fixture = JSON.parse(line.toString());
const base = `http://${fixture.host}:${fixture.port}`;

const run = (args, options = {}) => {
  const result = spawnSync(gallery, ['--no-input', ...args], { encoding: 'utf8', timeout: 30000, ...options });
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  return result;
};

try {
  const multiOutput = join(root, 'multi-output');
  const multi = run(['--destination', multiOutput, ...Array.from({ length: 5 }, (_, index) => `${base}/gallery/${index + 1}.png`)]);
  assert.equal(multi.status, 0, multi.stderr || multi.stdout);
  assert.equal(readdirSync(multiOutput, { recursive: true }).filter((entry) => entry.endsWith('.png')).length, 5);

  const unicodeOutput = join(root, 'ảnh đầu ra');
  const unicode = run(['--destination', unicodeOutput, `${base}/unicode/ảnh-đã-xử-lý.png`]);
  assert.equal(unicode.status, 0, unicode.stderr || unicode.stdout);
  assert.ok(readdirSync(unicodeOutput, { recursive: true }).some((entry) => entry.endsWith('.png')));

  const slowOutput = join(root, 'cancelled');
  const slow = spawn(gallery, ['--no-input', '--destination', slowOutput, `${base}/slow.png`], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  process.kill(-slow.pid, 'SIGTERM');
  const [close] = await once(slow, 'close');
  assert.notEqual(close, 0);

  const missing = run(['--destination', join(root, 'missing'), `${base}/missing`]);
  assert.notEqual(missing.status, 0, 'gallery-dl must fail visibly for a missing media response');
  console.log(JSON.stringify({ root, fixture: base, multiOutput: 5, unicode: true, cancellationExit: close, missingExit: missing.status, status: 'passed' }, null, 2));
} finally {
  server.kill('SIGTERM');
  await once(server, 'close').catch(() => {});
}
