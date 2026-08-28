import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const versions = JSON.parse(await readFile(new URL('./downloader-versions.json', import.meta.url), 'utf8'));
const version = versions.bgutilVersion;
const ytDlpVersion = versions.ytDlpVersion;
const root = join(process.cwd(), 'src-tauri', 'binaries');
const pluginRoot = join(root, 'yt-dlp-plugins');
const pluginPackage = join(pluginRoot, 'bgutil-ytdlp-pot-provider');
const pluginMarker = join(pluginPackage, 'yt_dlp_plugins', 'extractor', 'getpot_bgutil_cli.py');
const providerName = process.platform === 'win32' ? 'bgutil-pot.exe' : 'bgutil-pot';
const providerPath = join(root, providerName);
const ytDlpPath = join(root, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function ytDlpAsset() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux' && process.arch === 'x64') return 'yt-dlp_linux';
  return null;
}

function installedYtDlpVersion() {
  if (!existsSync(ytDlpPath)) return null;
  const result = spawnSync(ytDlpPath, ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function extractZip(zipPath, destination) {
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]
    : ['-oq', zipPath, '-d', destination];
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', args, { stdio: 'inherit' })
    : spawnSync('unzip', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not extract the yt-dlp PO Token plugin archive. Install unzip and retry.');
}

const providerAsset = process.platform === 'win32'
  ? 'bgutil-pot-windows-x86_64.exe'
  : process.platform === 'darwin'
    ? `bgutil-pot-macos-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
    : process.platform === 'linux' && process.arch === 'x64'
      ? 'bgutil-pot-linux-x86_64'
      : null;

if (!providerAsset) {
  console.warn(`[yt-dlp POT] No pinned provider asset for ${process.platform}/${process.arch}; use ND_BGUTIL_POT if needed.`);
  process.exit(0);
}

await mkdir(root, { recursive: true });
const ytDlpAssetName = ytDlpAsset();
if (!ytDlpAssetName) {
  console.warn(`[yt-dlp] No pinned nightly asset for ${process.platform}/${process.arch}; use ND_YTDLP if needed.`);
} else if (installedYtDlpVersion() !== ytDlpVersion) {
  console.log(`[yt-dlp] Downloading pinned nightly ${ytDlpVersion}...`);
  await download(`https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${ytDlpVersion}/${ytDlpAssetName}`, ytDlpPath);
  if (process.platform !== 'win32') await chmod(ytDlpPath, 0o755);
  if (installedYtDlpVersion() !== ytDlpVersion) {
    throw new Error(`Downloaded yt-dlp did not report expected version ${ytDlpVersion}.`);
  }
}
if (!(await exists(pluginMarker))) {
  const archive = join(root, 'bgutil-ytdlp-pot-provider.zip');
  await mkdir(pluginPackage, { recursive: true });
  console.log(`[yt-dlp POT] Downloading plugin ${version}...`);
  await download(`https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${version}/bgutil-ytdlp-pot-provider-rs.zip`, archive);
  extractZip(archive, pluginPackage);
  await rm(archive, { force: true });
}

if (!(await exists(providerPath))) {
  console.log(`[yt-dlp POT] Downloading provider ${version}...`);
  await download(`https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${version}/${providerAsset}`, providerPath);
  if (process.platform !== 'win32') await chmod(providerPath, 0o755);
}

console.log(`[yt-dlp POT] Plugin root: ${pluginRoot}`);
console.log(`[yt-dlp POT] Provider: ${providerPath}`);
