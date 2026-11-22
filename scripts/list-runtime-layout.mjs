import { existsSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--'));
const root = resolve(rootArg || process.cwd());
const maxDepth = 6;
const maxEntries = 200;
const names = new Set([
  'ffmpeg.exe',
  'ffprobe.exe',
  'yt-dlp.exe',
  'gallery-dl.exe',
  'bgutil-pot.exe',
  'ffmpeg',
  'ffprobe',
  'yt-dlp',
  'gallery-dl',
  'bgutil-pot',
  'runtime-manifest.json',
]);

const entries = [];
const visit = (directory, depth) => {
  if (depth > maxDepth || entries.length >= maxEntries || !existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entries.length >= maxEntries) break;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path, depth + 1);
      continue;
    }
    if (!entry.isFile() || (!names.has(entry.name) && !entry.name.endsWith('-setup.exe'))) continue;
    const size = statSync(path).size;
    entries.push({ path: relative(root, path) || '.', size });
  }
};

console.log(`Runtime layout root: ${root}`);
visit(root, 0);
if (entries.length === 0) {
  console.log('Runtime layout: no bounded runtime candidates found.');
} else {
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    console.log(`RUNTIME_FILE ${entry.path} ${entry.size} bytes`);
  }
}
if (entries.length >= maxEntries) console.log(`Runtime layout listing capped at ${maxEntries} files.`);
