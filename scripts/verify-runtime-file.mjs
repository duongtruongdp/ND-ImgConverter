import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [file, expectedHash, expectedVersion, versionArg = '--version'] = process.argv.slice(2);
if (!file || !expectedHash) throw new Error('Usage: node scripts/verify-runtime-file.mjs <file> <sha256> [version] [version-arg]');

const actualHash = createHash('sha256').update(readFileSync(file)).digest('hex');
if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
  throw new Error(`${file}: SHA-256 mismatch (expected ${expectedHash}, got ${actualHash}).`);
}

if (expectedVersion) {
  const result = spawnSync(file, [versionArg], { encoding: 'utf8' });
  const actualVersion = (result.stdout || result.stderr || '').trim().split(/\r?\n/, 1)[0];
  if (result.status !== 0 || !actualVersion.includes(expectedVersion)) {
    throw new Error(`${file}: version mismatch (expected ${expectedVersion}, got ${actualVersion || result.status}).`);
  }
}

console.log(`${file}: verified SHA-256 ${actualHash}${expectedVersion ? ` and version ${expectedVersion}` : ''}.`);
