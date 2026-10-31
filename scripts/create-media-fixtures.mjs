import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = resolve(process.argv[2] || process.env.ND_FIXTURE_OUTPUT || '/tmp/nd-media-fixtures');
const ffmpeg = resolve(process.env.ND_FIXTURE_FFMPEG || 'src-tauri/binaries/ffmpeg');
mkdirSync(join(output, 'gallery'), { recursive: true });
mkdirSync(join(output, 'playlist'), { recursive: true });

const run = (args) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`FFmpeg fixture generation failed with ${result.status}`);
};

const video = join(output, 'single-video.mp4');
const videoAudio = join(output, 'short-video-with-audio.mp4');
run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', video]);
run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.5', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', videoAudio]);

const colors = ['red', 'green', 'blue', 'yellow', 'purple'];
for (const [index, color] of colors.entries()) {
  const image = join(output, 'gallery', `${String(index + 1).padStart(2, '0')}.png`);
  run(['-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-y', image]);
  copyFileSync(image, join(output, 'playlist', `${String(index + 1).padStart(2, '0')}.png`));
}
copyFileSync(join(output, 'gallery', '01.png'), join(output, 'gallery', 'ảnh-đã-xử-lý.png'));
copyFileSync(join(output, 'gallery', '01.png'), join(output, 'gallery', 'duplicate.png'));
console.log(JSON.stringify({ output, video, videoAudio, galleryCount: 5, unicode: join(output, 'gallery', 'ảnh-đã-xử-lý.png'), duplicate: join(output, 'gallery', 'duplicate.png') }, null, 2));
