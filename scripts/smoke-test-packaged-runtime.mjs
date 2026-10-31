import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32' || args.includes('--windows');
const rootArg = args.find((arg) => !arg.startsWith('--'));
const app = resolve(rootArg || (isWindows
  ? 'src-tauri/target/x86_64-pc-windows-msvc/release'
  : 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ND Image Converter.app'));
const binaryName = (name) => isWindows ? `${name}.exe` : name;
const resourceRoots = [
  app,
  join(app, 'Contents', 'Resources'),
  join(app, 'resources'),
  join(app, 'Resources'),
];
const findBinary = (name) => {
  for (const root of resourceRoots) {
    const candidate = join(root, 'binaries', binaryName(name));
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Bundled ${name} was not found below ${app}.`);
};
const ffmpeg = findBinary('ffmpeg');
const ffprobe = findBinary('ffprobe');
const temp = mkdtempSync(join(tmpdir(), 'nd-m27-smoke-'));
const env = isWindows ? { ...process.env } : { ...process.env, PATH: '/usr/bin:/bin' };

const run = (binary, args) => {
  const result = spawnSync(binary, args, { env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${binary} ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || result.status).trim()}`);
  }
  return result;
};

try {
  const input = join(temp, 'input.mp4');
  const gif = join(temp, 'output.gif');
  const still = join(temp, 'still.png');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', input]);
  const probe = run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', input]);
  const metadata = JSON.parse(probe.stdout);
  if (metadata.streams?.[0]?.codec_name !== 'h264') throw new Error('Bundled FFprobe did not report the generated H.264 stream.');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', 'fps=12,scale=160:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a', '-loop', '0', '-y', gif]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', input, '-frames:v', '1', '-y', still]);
  for (const file of [input, gif, still]) {
    if (statSync(file).size === 0) throw new Error(`Smoke-test output is empty: ${file}`);
  }
  console.log(JSON.stringify({ app, ffmpeg, ffprobe, input, gif, still, status: 'passed' }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
