import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || '.');
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
  .map((entry) => entry.name)
  .sort();

const lines = files.map((name) => {
  const digest = createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
  return `${digest}  ${name}`;
});

writeFileSync(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`Wrote SHA256SUMS.txt for ${files.length} file(s) in ${directory}`);
