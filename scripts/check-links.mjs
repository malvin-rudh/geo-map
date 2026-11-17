// Fetches every source URL in events.json and arrows.json and reports dead links. Needs the internet.
// "blocked" means the site refuses scripts (401, 403, 406, 429) but may open fine in a browser: check those by hand.
// Usage: node scripts/check-links.mjs [--data <dir>]
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data') ? path.resolve(arg('--data')) : path.join(HERE, '..', 'data');
const read = async (n) => JSON.parse(await fs.readFile(path.join(dataDir, n), 'utf8'));
const urls = new Map();
for (const e of await read('events.json')) for (const s of e.sources) urls.set(s.url, (urls.get(s.url) || new Set()).add(e.id));
for (const a of await read('arrows.json')) for (const s of a.sources) urls.set(s.url, (urls.get(s.url) || new Set()).add(a.event));

const headers = {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', accept: 'text/html,application/xhtml+xml'};
async function check(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {headers, redirect: 'follow', signal: AbortSignal.timeout(20000)});
      if (res.ok) return ['ok', res.status];
      if ([401, 403, 406, 429].includes(res.status)) return ['blocked', res.status];
      if (attempt === 1) return ['dead', res.status];
    } catch (err) {
      if (attempt === 1) return ['error', err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.message)];
    }
  }
}
const list = [...urls.keys()];
const results = [];
for (let i = 0; i < list.length; i += 6) results.push(...await Promise.all(list.slice(i, i + 6).map(async (u) => [u, ...(await check(u))])));
const count = {ok: 0, blocked: 0, dead: 0, error: 0};
for (const [u, state, detail] of results) {
  count[state]++;
  if (state !== 'ok') console.log(`${state.toUpperCase().padEnd(7)} ${detail}  ${u}  (${[...urls.get(u)].join(', ')})`);
}
console.log(`${list.length} unique links: ${count.ok} ok, ${count.blocked} blocked to scripts, ${count.dead} dead, ${count.error} could not connect.`);
process.exit(count.dead ? 1 : 0);
