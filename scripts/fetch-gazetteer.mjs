// Looks up reference coordinates for places in two public gazetteers and saves them to
// data/gazetteer-reference.json. Needs the internet. No keys or accounts.
//   node scripts/fetch-gazetteer.mjs           only places that have no reference yet
//   node scripts/fetch-gazetteer.mjs --all     refresh every place
//   node scripts/fetch-gazetteer.mjs --apply   also copy the Wikipedia coordinate into places.json
//                                              when a place still has lat 0, lon 0
// Sources: Wikipedia coordinates API (place.wiki = article title) and OpenStreetMap Nominatim
// (place.osm = search text). Nominatim allows one request per second, so this is slow on purpose.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data') ? path.resolve(arg('--data')) : path.join(HERE, '..', 'data');
const placesFile = path.join(dataDir, 'places.json');
const refFile = path.join(dataDir, 'gazetteer-reference.json');
const UA = {'user-agent': 'local-teaching-map/1.0 (gazetteer lookup script)'};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

// One request per 1.2 seconds, and one slow retry when a service says it is busy.
async function politeFetch(url) {
  await sleep(1200);
  let res = await fetch(url, {headers: UA});
  if (res.status === 429 || res.status === 503) { await sleep(8000); res = await fetch(url, {headers: UA}); }
  return res;
}

async function wikipedia(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const res = await politeFetch(url);
  if (!res.ok) return {error: `HTTP ${res.status}`};
  const pages = Object.values((await res.json()).query?.pages || {});
  const page = pages[0];
  if (!page || page.missing !== undefined) return {error: 'no such article'};
  const c = page.coordinates?.[0];
  if (!c) return {error: 'article has no coordinates', title: page.title};
  return {title: page.title, lat: c.lat, lon: c.lon, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`};
}

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await politeFetch(url);
  if (!res.ok) return {error: `HTTP ${res.status}`};
  const hit = (await res.json())[0];
  if (!hit) return {error: 'no result'};
  return {query, lat: Number(hit.lat), lon: Number(hit.lon), display_name: hit.display_name};
}

const places = JSON.parse(await fs.readFile(placesFile, 'utf8'));
let refs = {};
try { refs = JSON.parse(await fs.readFile(refFile, 'utf8')); } catch { /* first run */ }
const all = process.argv.includes('--all'), apply = process.argv.includes('--apply');
let looked = 0;
for (const p of places) {
  const busy = (e) => e && /^HTTP/.test(e.error || '');
  if (!all && refs[p.id] && !busy(refs[p.id].wikipedia) && !busy(refs[p.id].osm)) continue;
  const entry = {fetched: today};
  if (p.wiki) entry.wikipedia = await wikipedia(p.wiki);
  if (p.osm) entry.osm = await nominatim(p.osm);
  refs[p.id] = entry;
  looked++;
  const w = entry.wikipedia, o = entry.osm;
  console.log(`${p.id}: wikipedia ${w ? (w.error || `${w.lat.toFixed(3)}, ${w.lon.toFixed(3)}`) : 'not asked'} | osm ${o ? (o.error || `${o.lat.toFixed(3)}, ${o.lon.toFixed(3)}`) : 'not asked'}`);
  if (apply && p.lat === 0 && p.lon === 0 && w && !w.error) { p.lat = Number(w.lat.toFixed(4)); p.lon = Number(w.lon.toFixed(4)); }
}
for (const id of Object.keys(refs)) if (!places.some((p) => p.id === id)) delete refs[id];
await fs.writeFile(refFile, `${JSON.stringify(refs, null, 1)}\n`);
if (apply) await fs.writeFile(placesFile, `${JSON.stringify(places, null, 1)}\n`);
console.log(`Looked up ${looked} place(s). Reference saved to ${path.relative(process.cwd(), refFile)}.`);
