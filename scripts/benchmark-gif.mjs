import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

const ffmpeg = process.env.ND_FFMPEG || 'ffmpeg';
const ffprobe = process.env.ND_FFPROBE || 'ffprobe';
const root = mkdtempSync(join(tmpdir(), 'nd-gif-benchmark-'));
const input = join(root, 'fixture source.mp4');

const run = (binary, args) => {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${binary} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result;
};

try {
  const ffmpegVersion = run(ffmpeg, ['-version']).stdout.trim().split(/\r?\n/, 1)[0];
  const ffprobeVersion = run(ffprobe, ['-version']).stdout.trim().split(/\r?\n/, 1)[0];
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30',
    '-t', '12', '-pix_fmt', 'yuv420p', '-y', input,
  ]);
  const probe = JSON.parse(run(ffprobe, [
    '-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate:format=duration',
    '-of', 'json', input,
  ]).stdout);
  const source = {
    codec: probe.streams?.[0]?.codec_name || 'unknown',
    width: probe.streams?.[0]?.width || 0,
    height: probe.streams?.[0]?.height || 0,
    fps: probe.streams?.[0]?.avg_frame_rate || 'unknown',
    duration: Number(probe.format?.duration || 0),
  };
  const cases = [
    { label: 'short-2s', duration: 2, width: 320, fps: 10 },
    { label: 'medium-6s', duration: 6, width: 480, fps: 12 },
    { label: 'long-12s', duration: 12, width: 640, fps: 15 },
  ];
  const results = cases.map((item) => {
    const output = join(root, `${item.label}.gif`);
    const filter = `fps=${item.fps},scale=${item.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=211[p];[s1][p]paletteuse=dither=sierra2_4a`;
    const started = performance.now();
    run(ffmpeg, [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', input,
      '-ss', '0', '-t', String(item.duration), '-vf', filter, '-loop', '0', '-f', 'gif', output,
    ]);
    const elapsedMs = Math.round(performance.now() - started);
    return { ...item, elapsedMs, outputBytes: statSync(output).size };
  });
  console.log(JSON.stringify({
    ffmpeg, ffprobe, versions: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion }, source, renderer: 'single-process palettegen/paletteuse', results,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
