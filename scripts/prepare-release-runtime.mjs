import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.env.ND_RUNTIME_TARGET || process.argv[2];
if (!target) throw new Error('ND_RUNTIME_TARGET or a target triple is required.');

const config = JSON.parse(readFileSync(new URL('./runtime-sources.json', import.meta.url), 'utf8'));
const source = config.targets[target];
if (!source) throw new Error(`No runtime source entry exists for ${target}.`);
const root = process.env.ND_RUNTIME_OUTPUT || 'src-tauri/binaries';
mkdirSync(root, { recursive: true });

const isWindows = target.includes('windows');
const directName = (name) => isWindows ? `${name}.exe` : name;
const sha256 = (path) => {
  const hash = createHash('sha256');
  const data = readFileSync(path);
  hash.update(data);
  return hash.digest('hex');
};

const versionArgs = (name) => ['ytDlp', 'bgutilPot', 'galleryDl'].includes(name) ? ['--version'] : ['-version'];

const validateArchiveLayout = (archivePath, executablePath) => {
  const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`Could not inspect ${archivePath} as a ZIP archive.`);
  const entries = listing.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
      throw new Error(`Unsafe archive path in ${archivePath}: ${entry}`);
    }
  }
  if (!entries.includes(executablePath)) {
    throw new Error(`${archivePath} does not contain the approved executable path ${executablePath}.`);
  }
};

const download = async (name, entry) => {
  if (!entry?.url || !entry.sha256 || !entry.binarySha256 || !entry.version || !entry.license) {
    throw new Error(`No approved ${name} source/version/hash/license is configured for ${target}. Release packaging is intentionally blocked.`);
  }
  if (!entry.url.startsWith('https://')) throw new Error(`${name} source must use HTTPS.`);
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256) || !/^[a-f0-9]{64}$/i.test(entry.binarySha256)) {
    throw new Error(`${name} archive and binary SHA-256 values must be 64 hexadecimal characters.`);
  }
  if (entry.archiveFormat !== 'zip' || !entry.executablePath) {
    throw new Error(`${name} must declare a ZIP archive and executablePath.`);
  }
  const response = await fetch(entry.url, { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`${name} download failed with HTTP ${response.status}.`);
  const archivePath = join(root, `.${name}.archive`);
  const finalPath = join(root, directName(name));
  const tempPath = `${finalPath}.download`;
  rmSync(archivePath, { force: true });
  rmSync(tempPath, { force: true });
  const output = createWriteStream(archivePath, { flags: 'wx' });
  let bytes = 0;
  const limit = 2 * 1024 * 1024 * 1024;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > limit) { output.close(); rmSync(archivePath, { force: true }); throw new Error(`${name} exceeds the 2 GiB safety limit.`); }
    if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
  }
  await new Promise((resolve, reject) => { output.end((error) => error ? reject(error) : resolve()); });
  const archiveHash = sha256(archivePath);
  if (archiveHash.toLowerCase() !== entry.sha256.toLowerCase()) {
    rmSync(archivePath, { force: true });
    throw new Error(`${name} archive SHA-256 mismatch.`);
  }
  validateArchiveLayout(archivePath, entry.executablePath);
  const extractedFd = openSync(tempPath, 'wx');
  const extraction = spawnSync('unzip', ['-p', archivePath, entry.executablePath], { stdio: ['ignore', extractedFd, 'pipe'] });
  closeSync(extractedFd);
  if (extraction.status !== 0) throw new Error(`${name} executable extraction failed.`);
  const binaryHash = sha256(tempPath);
  if (binaryHash.toLowerCase() !== entry.binarySha256.toLowerCase()) {
    throw new Error(`${name} binary SHA-256 mismatch.`);
  }
  if (!isWindows) chmodSync(tempPath, 0o755);
  const result = spawnSync(tempPath, versionArgs(name), { encoding: 'utf8' });
  const versionOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0 || !versionOutput.includes(entry.version)) {
    throw new Error(`${name} failed its approved version check.`);
  }
  renameSync(tempPath, finalPath);
  rmSync(archivePath, { force: true });
  console.log(`${name}: archive ${archiveHash}; binary ${binaryHash}; version ${entry.version}; size ${statSync(finalPath).size}`);
};

const downloadRawBinary = async (name, outputName, entry) => {
  if (!entry?.url || !entry.sha256 || !entry.binarySha256 || !entry.version || !entry.license) {
    throw new Error(`No approved ${name} source/version/hash/license is configured for ${target}.`);
  }
  if (!entry.url.startsWith('https://') || !/^[a-f0-9]{64}$/i.test(entry.sha256) || !/^[a-f0-9]{64}$/i.test(entry.binarySha256)) {
    throw new Error(`${name} source or SHA-256 metadata is invalid.`);
  }
  const response = await fetch(entry.url, { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`${name} download failed with HTTP ${response.status}.`);
  const tempPath = join(root, `.${outputName}.download`);
  const finalPath = join(root, outputName);
  rmSync(tempPath, { force: true });
  const output = createWriteStream(tempPath, { flags: 'wx' });
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 512 * 1024 * 1024) { output.close(); rmSync(tempPath, { force: true }); throw new Error(`${name} exceeds the 512 MiB safety limit.`); }
    if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
  }
  await new Promise((resolve, reject) => { output.end((error) => error ? reject(error) : resolve()); });
  const archiveHash = sha256(tempPath);
  if (archiveHash.toLowerCase() !== entry.sha256.toLowerCase()) { rmSync(tempPath, { force: true }); throw new Error(`${name} SHA-256 mismatch.`); }
  if (sha256(tempPath).toLowerCase() !== entry.binarySha256.toLowerCase()) { rmSync(tempPath, { force: true }); throw new Error(`${name} binary SHA-256 mismatch.`); }
  if (!isWindows) chmodSync(tempPath, 0o755);
  const result = spawnSync(tempPath, versionArgs(name), { encoding: 'utf8' });
  const versionOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0 || !versionOutput.includes(entry.version)) { rmSync(tempPath, { force: true }); throw new Error(`${name} failed its approved version check.`); }
  renameSync(tempPath, finalPath);
  console.log(`${name}: binary ${archiveHash}; version ${entry.version}; size ${statSync(finalPath).size}`);
};

await download('ffmpeg', source.ffmpeg);
await download('ffprobe', source.ffprobe);
if (source.galleryDl?.url) await downloadRawBinary('galleryDl', directName('gallery-dl'), source.galleryDl);
console.log(`Prepared verified runtime files for ${target} in ${root}.`);
