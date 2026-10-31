import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.env.ND_RUNTIME_TARGET || process.argv[2] || process.env.TAURI_ENV_TARGET_TRIPLE;
if (!target) throw new Error('ND_RUNTIME_TARGET, target argument or TAURI_ENV_TARGET_TRIPLE is required.');

const configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const windows = target.includes('windows');
const names = windows
  ? ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe', 'gallery-dl.exe', 'bgutil-pot.exe']
  : ['ffmpeg', 'ffprobe', 'yt-dlp', 'gallery-dl', 'bgutil-pot', 'yt-dlp-plugins', 'lib'];
const resources = names
  .map((name) => `binaries/${name}`)
  .filter((resource) => existsSync(new URL(`../src-tauri/${resource}`, import.meta.url)));
resources.push('resources/FFMPEG-NOTICES.txt');
if (existsSync(new URL('../src-tauri/resources/GALLERY-DL-NOTICES.txt', import.meta.url))) resources.push('resources/GALLERY-DL-NOTICES.txt');
if (existsSync(new URL('../src-tauri/resources/MEDIA-ENGINE-NOTICES.txt', import.meta.url))) resources.push('resources/MEDIA-ENGINE-NOTICES.txt');
if (existsSync(new URL('../src-tauri/binaries/gallery-dl-build.json', import.meta.url))) resources.push('binaries/gallery-dl-build.json');
const manifest = 'binaries/runtime-manifest.json';
if (existsSync(new URL(`../src-tauri/${manifest}`, import.meta.url))) resources.push(manifest);
config.bundle.resources = [...new Set(resources)];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Configured ${config.bundle.resources.length} runtime resources for ${target}.`);
