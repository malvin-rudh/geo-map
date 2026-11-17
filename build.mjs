// Validates the data files and bundles them into dist/data.json.
// Usage: node build.mjs [--check] [--data <dir>] [--out <file>]
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLACE_TYPES = ['capital', 'city', 'nuclear', 'base', 'port', 'energy', 'chokepoint', 'water', 'territory'];
export const ARROW_TYPES = ['military', 'sanctions', 'trade', 'diplomacy', 'proxy'];
export const STATUSES = ['active', 'escalating', 'easing', 'talks', 'ceasefire', 'frozen'];
export const REGIONS = ['Middle East', 'Europe', 'Asia-Pacific', 'South Asia', 'Africa', 'Americas', 'Global'];
export const MAX_ARROWS = 40;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BANNED_CHARS = /[\u2014\u2013]/; // em dash and en dash
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isUrl = (v) => isStr(v) && /^https?:\/\/[^\s]+$/.test(v);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function checkSources(list, where, errors) {
  if (!Array.isArray(list) || list.length === 0) { errors.push(`${where}: needs at least one source`); return; }
  list.forEach((s, i) => {
    if (!isUrl(s.url)) errors.push(`${where}: source ${i + 1} has no valid url`);
    if (!isStr(s.publisher)) errors.push(`${where}: source ${i + 1} has no publisher`);
    if (!ISO.test(s.published || '')) errors.push(`${where}: source ${i + 1} needs a published date (YYYY-MM-DD)`);
  });
}

export function validate({places, events, arrows, meta}) {
  const errors = [];
  const walk = (v, where) => {
    if (typeof v === 'string') { if (BANNED_CHARS.test(v)) errors.push(`${where}: contains an em or en dash`); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
  };
  walk({places, events, arrows, meta}, 'data');

  const placeIds = new Set();
  for (const p of places) {
    const w = `place ${p.id}`;
    if (!isStr(p.id)) errors.push('place without id');
    if (placeIds.has(p.id)) errors.push(`${w}: duplicate id`);
    placeIds.add(p.id);
    if (!isStr(p.name)) errors.push(`${w}: no name`);
    if (!isStr(p.country)) errors.push(`${w}: no country`);
    if (!PLACE_TYPES.includes(p.type)) errors.push(`${w}: unknown type ${p.type}`);
    if (!(typeof p.lat === 'number' && p.lat >= -90 && p.lat <= 90)) errors.push(`${w}: bad lat`);
    if (!(typeof p.lon === 'number' && p.lon >= -180 && p.lon <= 180)) errors.push(`${w}: bad lon`);
    if (!isStr(p.why)) errors.push(`${w}: no "why it matters" line`);
    if (![1, 2, 3].includes(p.tier)) errors.push(`${w}: tier must be 1, 2 or 3`);
  }

  const eventIds = new Set();
  for (const e of events) {
    const w = `event ${e.id}`;
    if (!isStr(e.id)) errors.push('event without id');
    if (eventIds.has(e.id)) errors.push(`${w}: duplicate id`);
    eventIds.add(e.id);
    for (const k of ['title', 'hotspot', 'why_it_matters']) if (!isStr(e[k])) errors.push(`${w}: no ${k}`);
    if (!Array.isArray(e.summary) || e.summary.length < 2 || e.summary.length > 3 || !e.summary.every(isStr)) errors.push(`${w}: summary must be 2 or 3 short lines`);
    if (!ISO.test(e.date || '')) errors.push(`${w}: bad date`);
    if (!STATUSES.includes(e.status)) errors.push(`${w}: unknown status ${e.status}`);
    if (!REGIONS.includes(e.region)) errors.push(`${w}: unknown region ${e.region}`);
    if (typeof e.verified !== 'boolean') errors.push(`${w}: verified must be true or false`);
    checkSources(e.sources, w, errors);
    const independent = new Set((e.sources || []).map((s) => (s.publisher || '').toLowerCase().trim() || host(s.url)));
    if (e.verified === true && independent.size < 2) errors.push(`${w}: only ${independent.size} independent source, so it must be marked unverified`);
    if (e.verified === false && !isStr(e.verify_note)) errors.push(`${w}: unverified events need a verify_note saying why`);
  }

  const arrowIds = new Set();
  const eventsWithArrows = new Set();
  const usedPlaces = new Set();
  for (const a of arrows) {
    const w = `arrow ${a.id}`;
    if (!isStr(a.id)) errors.push('arrow without id');
    if (arrowIds.has(a.id)) errors.push(`${w}: duplicate id`);
    arrowIds.add(a.id);
    if (!placeIds.has(a.from)) errors.push(`${w}: from "${a.from}" is not a known place`);
    if (!placeIds.has(a.to)) errors.push(`${w}: to "${a.to}" is not a known place`);
    if (a.from === a.to) errors.push(`${w}: from and to are the same place`);
    if (!ARROW_TYPES.includes(a.type)) errors.push(`${w}: unknown type ${a.type}`);
    if (!eventIds.has(a.event)) errors.push(`${w}: event "${a.event}" does not exist`);
    for (const k of ['label', 'who', 'what', 'when', 'why']) if (!isStr(a[k])) errors.push(`${w}: no ${k}`);
    checkSources(a.sources, w, errors);
    eventsWithArrows.add(a.event);
    usedPlaces.add(a.from); usedPlaces.add(a.to);
  }
  for (const e of events) if (!eventsWithArrows.has(e.id)) errors.push(`event ${e.id}: has no arrows (orphan)`);
  if (arrows.length > MAX_ARROWS) errors.push(`too many arrows: ${arrows.length} (limit ${MAX_ARROWS})`);

  if (!ISO.test(meta.last_updated || '')) errors.push('meta.last_updated must be YYYY-MM-DD');
  if (!Array.isArray(meta.top_events) || meta.top_events.length < 5 || meta.top_events.length > 7) errors.push('meta.top_events must list 5 to 7 event ids');
  for (const id of meta.top_events || []) if (!eventIds.has(id)) errors.push(`meta.top_events: "${id}" is not a current event`);
  return errors;
}

export async function build({dataDir = path.join(HERE, 'data'), outFile = path.join(HERE, 'dist', 'data.json'), checkOnly = false} = {}) {
  const [places, events, arrows, meta] = await Promise.all(['places', 'events', 'arrows', 'meta'].map((n) => readJson(path.join(dataDir, `${n}.json`))));
  const errors = validate({places, events, arrows, meta});
  const counts = {
    places: places.length,
    events: events.length,
    arrows: arrows.length,
    events_verified: events.filter((e) => e.verified).length,
    events_unverified: events.filter((e) => !e.verified).length,
  };
  if (errors.length) return {ok: false, errors, counts};
  if (!checkOnly) {
    await fs.mkdir(path.dirname(outFile), {recursive: true});
    await fs.writeFile(outFile, JSON.stringify({meta: {...meta, counts}, places, events, arrows}));
  }
  return {ok: true, errors: [], counts};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const result = await build({
    dataDir: arg('--data') ? path.resolve(arg('--data')) : undefined,
    outFile: arg('--out') ? path.resolve(arg('--out')) : undefined,
    checkOnly: process.argv.includes('--check'),
  });
  if (!result.ok) {
    console.error(`Data check failed with ${result.errors.length} problem(s):`);
    for (const e of result.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  const c = result.counts;
  console.log(`Data OK: ${c.places} places, ${c.events} events (${c.events_unverified} unverified), ${c.arrows} arrows.${process.argv.includes('--check') ? '' : ' Wrote dist/data.json.'}`);
}
