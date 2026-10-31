import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--'));
const requireDownloader = args.includes('--require-downloader');
const requireGallery = args.includes('--require-gallery');
const root = resolve(rootArg || process.cwd());

const isWindows = process.platform === 'win32' || args.includes('--windows');
const candidates = (name) => isWindows ? [`${name}.exe`, name] : [name];
const tools = [
  { name: 'ffmpeg', args: ['-version'], required: true, capability: ['-filters', 'palettegen', 'paletteuse'] },
  { name: 'ffprobe', args: ['-version'], required: true },
  { name: 'yt-dlp', args: ['--version'], required: requireDownloader },
  { name: 'gallery-dl', args: ['--version'], required: requireGallery },
];

const searchRoots = [
  root,
  join(root, 'Contents', 'Resources'),
  join(root, 'resources'),
  join(root, 'Resources'),
];

const findTool = (name) => {
  for (const searchRoot of searchRoots) {
    for (const file of candidates(name)) {
      const path = join(searchRoot, 'binaries', file);
      if (existsSync(path)) return path;
    }
  }
  return null;
};

const failures = [];
const observed = new Map();
const expectedArchitecture = process.arch === 'arm64' ? ['arm64', 'aarch64'] : process.arch === 'x64' ? ['x86_64', 'x86-64', 'amd64', 'x64'] : [process.arch];

const architectureOf = (path) => {
  if (isWindows) {
    const data = readFileSync(path);
    if (data.subarray(0, 2).toString('ascii') !== 'MZ') return 'unknown PE header';
    if (data.length < 0x40) return 'invalid PE header';
    const peOffset = data.readUInt32LE(0x3c);
    if (peOffset + 6 > data.length) return 'invalid PE header';
    if (data.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0') return 'invalid PE header';
    const machine = data.readUInt16LE(peOffset + 4);
    return ({ 0x8664: 'x86_64', 0xaa64: 'arm64', 0x14c: 'x86' })[machine] || `machine 0x${machine.toString(16)}`;
  }
  const result = spawnSync('file', [path], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
};

for (const tool of tools) {
  const path = findTool(tool.name);
  if (!path) {
    if (tool.required) failures.push(`${tool.name}: missing`);
    else console.log(`${tool.name}: optional/missing`);
    continue;
  }
  const stat = statSync(path);
  if (!isWindows && (stat.mode & 0o111) === 0) failures.push(`${tool.name}: not executable (${path})`);
  if (['ffmpeg', 'ffprobe'].includes(tool.name)) {
    const header = readFileSync(path).subarray(0, 512).toString('utf8');
    if (header.startsWith('#!') || header.includes('ND_FFMPEG_SYSTEM')) failures.push(`${tool.name}: development wrapper is not a self-contained binary (${path})`);
  }
  const architecture = architectureOf(path);
  console.log(`${tool.name}: architecture ${architecture}`);
  if (architecture === 'unknown' || architecture.startsWith('unknown PE') || architecture.startsWith('invalid PE')) {
    failures.push(`${tool.name}: architecture could not be determined (${path})`);
  } else if (!expectedArchitecture.some((token) => architecture.includes(token))) {
    failures.push(`${tool.name}: architecture does not match runner (${architecture}; expected ${expectedArchitecture.join('/')})`);
  }
  const result = spawnSync(path, tool.args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    failures.push(`${tool.name}: version check failed (${result.error?.message || result.stderr.trim() || result.status})`);
    continue;
  }
  const version = (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0];
  observed.set(tool.name, { path, version, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
  console.log(`${tool.name}: ${version} [${path}]`);
  if (tool.capability) {
    const capabilityResult = spawnSync(path, [tool.capability[0]], { encoding: 'utf8' });
    const capabilityOutput = `${capabilityResult.stdout || ''}\n${capabilityResult.stderr || ''}`;
    for (const capability of tool.capability.slice(1)) {
      if (!capabilityOutput.includes(capability)) failures.push(`${tool.name}: missing capability ${capability}`);
    }
  }
  if (path.includes('/opt/homebrew/') || path.includes('/usr/local/bin/') || /[\\/]Program Files[\\/]/.test(path)) {
    failures.push(`${tool.name}: resolved to a development/system path (${path})`);
  }
  if (!isWindows) {
    const linkage = spawnSync('otool', ['-L', path], { encoding: 'utf8' });
    if (linkage.status !== 0) {
      failures.push(`${tool.name}: otool -L failed (${path})`);
    } else if (/\/(?:opt\/homebrew|usr\/local)\//.test(linkage.stdout)) {
      failures.push(`${tool.name}: contains a Homebrew/local dynamic dependency (${path})`);
    }
  }
}

const manifestCandidates = searchRoots.map((searchRoot) => join(searchRoot, 'binaries', 'runtime-manifest.json')).filter(existsSync);
if (manifestCandidates.length > 0) {
  try {
    const manifest = JSON.parse(readFileSync(manifestCandidates[0], 'utf8'));
    for (const entry of manifest.files || []) {
      const actual = observed.get(entry.file.replace(/\.exe$/i, ''));
      if (actual && entry.sha256 && actual.sha256 !== entry.sha256) failures.push(`${entry.file}: runtime manifest SHA-256 mismatch`);
    }
  } catch (error) {
    failures.push(`runtime-manifest.json: invalid JSON (${error.message})`);
  }
}

if (observed.get('ffmpeg')?.version && observed.get('ffprobe')?.version) {
  const ffmpegVersion = observed.get('ffmpeg').version.match(/version\s+([^\s]+)/i)?.[1];
  const ffprobeVersion = observed.get('ffprobe').version.match(/version\s+([^\s]+)/i)?.[1];
  if (ffmpegVersion && ffprobeVersion && ffmpegVersion !== ffprobeVersion) failures.push(`ffmpeg/ffprobe version mismatch (${ffmpegVersion} vs ${ffprobeVersion})`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Runtime bundle verification passed for ${basename(root)}.`);
}
