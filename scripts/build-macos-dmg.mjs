import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('build-macos-dmg.mjs must run on macOS.');

const target = process.env.ND_RUNTIME_TARGET || process.argv[2] || 'aarch64-apple-darwin';
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error(`Unsupported macOS target: ${target}`);
}

const root = resolve(process.cwd());
const targetRoot = join(root, 'src-tauri', 'target', target, 'release', 'bundle');
const app = join(targetRoot, 'macos', 'ND Image Converter.app');
const dmgScript = join(targetRoot, 'dmg', 'bundle_dmg.sh');
const suffix = target.startsWith('aarch64') ? 'aarch64' : 'x64';
const output = resolve(process.env.ND_DMG_OUTPUT || join(targetRoot, 'dmg', `ND Image Converter_0.9.0_${suffix}.dmg`));
const background = join(root, 'src-tauri', 'icons', 'dmg-background.png');

for (const [label, path] of [['app', app], ['bundle_dmg.sh', dmgScript], ['DMG background', background]]) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}
mkdirSync(join(output, '..'), { recursive: true });
if (existsSync(output)) {
  if (process.env.ND_DMG_FORCE !== '1') {
    throw new Error(`DMG already exists: ${output}. Set ND_DMG_FORCE=1 only when replacing this generated artifact.`);
  }
  rmSync(output, { force: true });
}

const args = [
  dmgScript,
  '--skip-jenkins',
  '--no-internet-enable',
  '--volname', 'ND Image Converter',
  '--background', background,
  '--window-size', '660', '400',
  '--icon-size', '128',
  '--icon', 'ND Image Converter.app', '180', '200',
  '--app-drop-link', '480', '200',
  output,
  app,
];
const result = spawnSync('bash', args, { stdio: 'inherit' });
if (result.error || result.status !== 0) {
  throw new Error(`DMG creation failed: ${result.error?.message || result.status}`);
}
if (!existsSync(output) || statSync(output).size === 0) throw new Error(`DMG was not created: ${output}`);
const imageInfo = spawnSync('hdiutil', ['imageinfo', output], { encoding: 'utf8' });
if (imageInfo.status !== 0) throw new Error(`hdiutil imageinfo failed: ${imageInfo.stderr || imageInfo.stdout}`);
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
console.log(JSON.stringify({ target, output, bytes: statSync(output).size, sha256, format: 'UDZO', status: 'passed' }, null, 2));
