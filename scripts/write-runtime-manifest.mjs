import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] || 'src-tauri/binaries';
const files = ['ffmpeg', 'ffmpeg.exe', 'ffprobe', 'ffprobe.exe', 'yt-dlp', 'yt-dlp.exe', 'gallery-dl', 'gallery-dl.exe', 'bgutil-pot', 'bgutil-pot.exe']
  .map((name) => join(root, name))
  .filter(existsSync);

const versionArgs = (file) => /yt-dlp|gallery-dl|bgutil-pot/i.test(file) ? ['--version'] : ['-version'];
const buildConfiguration = (file) => {
  if (!/ffmpeg(?:\.exe)?$/i.test(file)) return null;
  const output = spawnSync(file, ['-buildconf'], { encoding: 'utf8' });
  return output.status === 0 ? (output.stdout || output.stderr).trim().slice(0, 12000) : null;
};
const manifest = files.map((file) => {
  const data = readFileSync(file);
  const output = spawnSync(file, versionArgs(file), { encoding: 'utf8' });
  return {
    file: basename(file),
    bytes: statSync(file).size,
    sha256: createHash('sha256').update(data).digest('hex'),
    version: output.status === 0 ? (output.stdout || output.stderr).trim().split(/\r?\n/, 1)[0] : null,
    buildConfiguration: buildConfiguration(file),
  };
});

writeFileSync(join(root, 'runtime-manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`);
console.log(`Wrote runtime manifest for ${manifest.length} binary files.`);
