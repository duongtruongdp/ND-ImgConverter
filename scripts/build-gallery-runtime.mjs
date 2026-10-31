import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// This script deliberately never installs Python packages or downloads source.
// CI must provide a pinned source checkout and a controlled Python/PyInstaller environment.
const target = process.env.ND_RUNTIME_TARGET || process.argv[2];
const source = process.env.ND_GALLERY_DL_SOURCE_DIR;
const python = process.env.ND_PYTHON || 'python3';
const outputRoot = resolve(process.env.ND_RUNTIME_OUTPUT || 'src-tauri/binaries');
const dependencyLock = process.env.ND_GALLERY_DEPENDENCY_LOCK || 'scripts/gallery-runtime/requirements-macos.lock';
if (!target || !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error('ND_RUNTIME_TARGET must be a macOS arm64 or x86_64 target.');
}
if (!source || !existsSync(join(source, 'gallery_dl', '__main__.py'))) {
  throw new Error('ND_GALLERY_DL_SOURCE_DIR must point to a checked-out gallery-dl source tree containing gallery_dl/__main__.py.');
}

const run = (args, options = {}) => {
  const result = spawnSync(python, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${python} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result;
};

const version = run(['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import gallery_dl; print(getattr(gallery_dl, "__version__", "unknown"))', source]).stdout.trim();
if (version !== '1.32.19') throw new Error(`Expected gallery-dl 1.32.19, found ${version}.`);
const pythonVersion = run(['--version']).stdout.trim();
const pyinstallerVersion = run(['-m', 'PyInstaller', '--version']).stdout.trim();
const commit = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const sourceCommit = process.env.ND_GALLERY_DL_SOURCE_COMMIT || (commit.status === 0 ? commit.stdout.trim() : 'unavailable');
const sourceArchive = spawnSync('git', ['-C', source, 'archive', '--format=tar', 'HEAD']);
const sourceSha256 = process.env.ND_GALLERY_DL_SOURCE_ARCHIVE_SHA256 || (sourceArchive.status === 0 ? createHash('sha256').update(sourceArchive.stdout).digest('hex') : 'unavailable');

const buildRoot = resolve(process.env.ND_GALLERY_BUILD_ROOT || join(tmpdir(), 'nd-gallery-runtime', target));
rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(buildRoot, { recursive: true });
const entry = join(source, 'gallery_dl', '__main__.py');
const sourceModules = [];
const collectModules = (directory, prefix) => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === '__pycache__') continue;
    const itemPath = join(directory, item.name);
    if (item.isDirectory()) {
      collectModules(itemPath, `${prefix}.${item.name}`);
    } else if (item.isFile() && item.name.endsWith('.py')) {
      const module = `${prefix}.${item.name.slice(0, -3)}`;
      sourceModules.push(module.endsWith('.__init__') ? module.slice(0, -9) : module);
    }
  }
};
collectModules(join(source, 'gallery_dl'), 'gallery_dl');
const pyinstallerArgs = [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--name', 'gallery-dl',
  '--paths', source, '--collect-submodules', 'gallery_dl', '--collect-data', 'gallery_dl',
  ...sourceModules.flatMap((module) => ['--hidden-import', module]),
  '--distpath', join(buildRoot, 'dist'), '--workpath', join(buildRoot, 'work'), '--specpath', buildRoot, entry,
];
run(pyinstallerArgs, { stdio: 'inherit' });

const built = join(buildRoot, 'dist', 'gallery-dl');
if (!existsSync(built)) throw new Error(`PyInstaller did not produce ${built}.`);
const fileInfo = spawnSync('file', [built], { encoding: 'utf8' });
const expectedArch = target.startsWith('aarch64') ? 'arm64' : 'x86_64';
if (fileInfo.status !== 0 || !fileInfo.stdout.includes(expectedArch)) {
  throw new Error(`Built gallery-dl architecture does not match ${target}: ${fileInfo.stdout || fileInfo.stderr}`);
}
if (process.platform === 'darwin') {
  const linkage = spawnSync('otool', ['-L', built], { encoding: 'utf8' });
  if (linkage.status !== 0 || /\/(?:opt\/homebrew|usr\/local)\//.test(linkage.stdout)) {
    throw new Error(`Built gallery-dl has an external Homebrew dependency: ${linkage.stdout || linkage.stderr}`);
  }
}
const outputPath = join(outputRoot, 'gallery-dl');
mkdirSync(outputRoot, { recursive: true });
copyFileSync(built, outputPath);
chmodSync(outputPath, 0o755);
const health = spawnSync(outputPath, ['--version'], { encoding: 'utf8' });
if (health.status !== 0 || !health.stdout.includes('1.32.19')) throw new Error('The packaged gallery-dl failed its version check.');

const artifactSha256 = createHash('sha256').update(readFileSync(outputPath)).digest('hex');
writeFileSync(join(outputRoot, 'gallery-dl-build.json'), `${JSON.stringify({
  schemaVersion: 1,
  target,
  mode: 'onefile',
  sourceVersion: version,
  sourceCommit,
  sourceSha256,
  sourceArchiveUrl: process.env.ND_GALLERY_DL_SOURCE_ARCHIVE_URL || 'https://codeberg.org/mikf/gallery-dl/releases/download/v1.32.19/gallery_dl-1.32.19.tar.gz',
  dependencyLock,
  pythonVersion,
  pyinstallerVersion,
  artifact: basename(outputPath),
  artifactSha256,
  artifactBytes: statSync(outputPath).size,
  builtAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`Built ${outputPath}; SHA-256 ${artifactSha256}`);
