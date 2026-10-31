import { readFileSync } from 'node:fs';

const target = process.env.ND_RUNTIME_TARGET || process.argv[2];
if (!target) throw new Error('ND_RUNTIME_TARGET or a target triple is required.');
const ffmpegOnly = process.argv.includes('--ffmpeg-only');

const config = JSON.parse(readFileSync(new URL('./runtime-sources.json', import.meta.url), 'utf8'));
const sources = config.targets?.[target];
if (!sources) throw new Error(`No runtime source entry exists for ${target}.`);

const required = ffmpegOnly ? ['ffmpeg', 'ffprobe'] : ['ffmpeg', 'ffprobe', 'ytDlp', 'bgutilPot', 'bgutilPotPlugin'];
for (const name of required) {
  const entry = sources[name];
  if (!entry?.url || !entry.version || !entry.license || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Release source ${name} is incomplete for ${target}; URL, version, license and archive SHA-256 are required.`);
  }
  if (!entry.url.startsWith('https://')) throw new Error(`Release source ${name} must use HTTPS.`);
  if (['ffmpeg', 'ffprobe'].includes(name) && (!entry.binarySha256 || !/^[a-f0-9]{64}$/i.test(entry.binarySha256) || entry.archiveFormat !== 'zip' || !entry.executablePath)) {
    throw new Error(`Release source ${name} must include binarySha256, archiveFormat=zip and executablePath.`);
  }
}

const gallery = sources.galleryDl;
if (gallery?.status === 'approved-controlled-source-build') {
  if (!gallery.version || !gallery.license || !gallery.sourceRepository || !gallery.sourceTag || !gallery.sourceArchiveUrl || !/^[a-f0-9]{64}$/i.test(gallery.sourceArchiveSha256) || !gallery.buildMethod || !gallery.dependencyLock) {
    throw new Error(`Controlled gallery-dl source-build metadata is incomplete for ${target}.`);
  }
  if (!gallery.sourceArchiveUrl.startsWith('https://') || !gallery.sourceRepository.startsWith('https://')) {
    throw new Error(`Controlled gallery-dl source-build URLs must use HTTPS for ${target}.`);
  }
} else if (gallery?.url) {
  if (!gallery.version || !gallery.license || !gallery.binarySha256 || !/^[a-f0-9]{64}$/i.test(gallery.sha256) || !/^[a-f0-9]{64}$/i.test(gallery.binarySha256)) {
    throw new Error(`Optional gallery-dl source metadata is incomplete for ${target}.`);
  }
  if (!gallery.url.startsWith('https://') || gallery.archiveFormat !== 'binary') {
    throw new Error(`gallery-dl source for ${target} must be an HTTPS raw binary record.`);
  }
}

console.log(`Approved runtime source metadata is complete for ${target}.`);
