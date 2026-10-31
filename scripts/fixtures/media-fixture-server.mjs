import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const host = value('--host', '127.0.0.1');
const port = Number(value('--port', '0'));
const root = value('--root', null) ? resolve(value('--root', null)) : null;
const video = process.env.ND_FIXTURE_VIDEO ? resolve(process.env.ND_FIXTURE_VIDEO) : null;
const audio = process.env.ND_FIXTURE_AUDIO ? resolve(process.env.ND_FIXTURE_AUDIO) : null;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const send = (response, status, body, type) => {
  response.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
};

const sendFile = (request, response, path, type) => {
  if (!path || !existsSync(path)) return send(response, 404, Buffer.from('fixture missing\n'), 'text/plain; charset=utf-8');
  const size = statSync(path).size;
  response.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'no-store', 'content-disposition': `inline; filename="${basename(path)}"` });
  createReadStream(path).pipe(response);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}`);
  if (url.pathname === '/health') return send(response, 200, Buffer.from('ok\n'), 'text/plain');
  if (url.pathname === '/missing') return send(response, 404, Buffer.from('not found\n'), 'text/plain');
  if (url.pathname === '/invalid') return send(response, 200, Buffer.from('not an image or media file\n'), 'application/octet-stream');
  if (url.pathname === '/video.mp4') return sendFile(request, response, video, 'video/mp4');
  if (url.pathname === '/audio.mp4') return sendFile(request, response, audio, 'audio/mp4');
  if (root && url.pathname.startsWith('/files/')) {
    const relative = decodeURIComponent(url.pathname.slice('/files/'.length));
    const path = resolve(root, relative);
    if (!path.startsWith(`${root}/`)) return send(response, 400, Buffer.from('unsafe fixture path\n'), 'text/plain');
    const type = path.endsWith('.mp4') ? 'video/mp4' : 'image/png';
    return sendFile(request, response, path, type);
  }
  if (url.pathname === '/playlist.json') {
    const base = `http://${host}:${server.address().port}`;
    return send(response, 200, Buffer.from(JSON.stringify({ items: Array.from({ length: 5 }, (_, index) => `${base}/gallery/${index + 1}.png`) })), 'application/json');
  }
  if (url.pathname.startsWith('/slow')) {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const total = 12 * 1024 * 1024;
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': total, 'cache-control': 'no-store' });
    for (let sent = 0; sent < total; sent += chunk.length) {
      if (response.destroyed) return;
      response.write(chunk);
      await delay(25);
    }
    return response.end();
  }
  if (url.pathname.startsWith('/gallery/') || url.pathname.startsWith('/unicode/')) {
    return send(response, 200, pixel, 'image/png');
  }
  return send(response, 404, Buffer.from('fixture route missing\n'), 'text/plain; charset=utf-8');
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ ready: true, host, port: server.address().port }));
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
