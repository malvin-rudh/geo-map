// Local, read-only server for the geopolitical map. Usage: node serve.mjs [--port 4650] [--data <dir>]
import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const port = arg('--port') ? Number(arg('--port')) : 4650;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
const dataDir = arg('--data') ? path.resolve(arg('--data')) : path.join(HERE, 'data');
const outFile = arg('--data') ? path.join(dataDir, '.dist-data.json') : path.join(HERE, 'dist', 'data.json');

const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2'};
const ROOT_FILES = new Set(['index.html', 'style.css']);
const DIRS = new Set(['src', 'vendor']);
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  res.end(body);
};

const result = await build({dataDir, outFile});
if (!result.ok) {
  console.error('The data has problems, so the map was not started:');
  for (const e of result.errors) console.error(` - ${e}`);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, 'Local requests only.');
    if (req.method !== 'GET') return send(res, 405, 'Read-only server.');
    let rel = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'dist/data.json') return send(res, 200, await fs.readFile(outFile), TYPES['.json']);
    const parts = rel.split('/');
    const ok = !rel.includes('..') && TYPES[path.extname(rel)] && ((parts.length === 1 && ROOT_FILES.has(rel)) || DIRS.has(parts[0]));
    if (!ok) return send(res, 404, 'Not found.');
    const file = path.join(HERE, rel);
    if (!file.startsWith(HERE + path.sep)) return send(res, 404, 'Not found.');
    return send(res, 200, await fs.readFile(file), TYPES[path.extname(rel)]);
  } catch (err) {
    send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not found.' : 'Server error.');
  }
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is busy. Run with --port <number>; do not stop an unrelated service.` : err.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const c = result.counts;
  console.log(`Geopolitical map: http://localhost:${port}  (${c.events} events, ${c.arrows} arrows, ${c.places} places)`);
});
