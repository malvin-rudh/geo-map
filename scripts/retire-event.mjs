// Retires an event: moves it and its arrows out of the live data into data/archive/, dated.
// History is never deleted. Usage:
//   node scripts/retire-event.mjs <event-id> --reason "why it ended" [--date YYYY-MM-DD] [--data <dir>]
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const id = process.argv[2];
const reason = arg('--reason');
const date = arg('--date') || new Date().toISOString().slice(0, 10);
const dataDir = arg('--data') ? path.resolve(arg('--data')) : path.join(HERE, '..', 'data');
if (!id || id.startsWith('--') || !reason) { console.error('Usage: node scripts/retire-event.mjs <event-id> --reason "why it ended" [--date YYYY-MM-DD] [--data <dir>]'); process.exit(1); }
if (/[\u2014\u2013]/.test(reason)) { console.error('No em or en dashes in the reason.'); process.exit(1); }

const file = (n) => path.join(dataDir, n);
const read = async (n) => JSON.parse(await fs.readFile(file(n), 'utf8'));
const write = (n, v) => fs.writeFile(file(n), `${JSON.stringify(v, null, 1)}\n`);
const [events, arrows, meta] = await Promise.all([read('events.json'), read('arrows.json'), read('meta.json')]);
const event = events.find((e) => e.id === id);
if (!event) { console.error(`No live event with id "${id}".`); process.exit(1); }
const gone = arrows.filter((a) => a.event === id);
const archiveFile = path.join(dataDir, 'archive', `${date}-${id}.json`);
await fs.mkdir(path.dirname(archiveFile), {recursive: true});
try { await fs.access(archiveFile); console.error(`${archiveFile} already exists. Nothing changed.`); process.exit(1); } catch { /* good, it is new */ }
await fs.writeFile(archiveFile, `${JSON.stringify({retired_on: date, reason, event, arrows: gone}, null, 1)}\n`);
await write('events.json', events.filter((e) => e.id !== id));
await write('arrows.json', arrows.filter((a) => a.event !== id));
if (meta.top_events.includes(id)) {
  meta.top_events = meta.top_events.filter((x) => x !== id);
  await write('meta.json', meta);
  console.log(`Removed "${id}" from the top events list. It now has ${meta.top_events.length}; it must have 5 to 7.`);
}
console.log(`Retired "${id}" with ${gone.length} arrow(s) to ${path.relative(process.cwd(), archiveFile)}.`);
