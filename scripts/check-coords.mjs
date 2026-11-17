// Checks every place in data/places.json. Works offline.
//  1. Distance to the saved gazetteer references (data/gazetteer-reference.json): at most 50 km
//     for a place, 400 km for a sea label (a sea has no single point).
//  2. The point lies inside its stated country on the Natural Earth map (or within about 20 km of
//     its coast). Seas and places marked "country_check": false are skipped, with the reason shown.
//  3. Hand-listed expectations for Iran, for example Natanz is near Isfahan.
// Also writes notes/coords-plot.svg (or coords-plot.svg next to the --data folder), a plain plot of
// every point, so a person can eyeball it.
// Usage: node scripts/check-coords.mjs [--data <dir>]
import {promises as fs, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data') ? path.resolve(arg('--data')) : path.join(APP, 'data');
const loadUmd = (file) => { const exports = {}; new Function('exports', 'module', readFileSync(path.join(APP, 'vendor', file), 'utf8'))(exports, {exports}); return exports; };
const d3 = loadUmd('d3.min.js'), topojson = loadUmd('topojson-client.min.js');

const NAME_FIX = {'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo'};
const topo = JSON.parse(readFileSync(path.join(APP, 'vendor', 'countries-50m.json'), 'utf8'));
const countries = new Map(topojson.feature(topo, topo.objects.countries).features.map((f) => [NAME_FIX[f.properties.name] || f.properties.name, f]));
const places = JSON.parse(await fs.readFile(path.join(dataDir, 'places.json'), 'utf8'));
let refs = {};
try { refs = JSON.parse(await fs.readFile(path.join(dataDir, 'gazetteer-reference.json'), 'utf8')); } catch { /* reported below */ }
const byId = new Map(places.map((p) => [p.id, p]));
const km = (a, b) => d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;

const fails = [], notes = [];
for (const p of places) {
  const isSea = p.type === 'water';
  const limit = isSea ? 400 : 50;
  const r = refs[p.id] || {};
  const good = [['Wikipedia', r.wikipedia], ['OpenStreetMap', r.osm]].filter(([, v]) => v && !v.error);
  if (!good.length) fails.push(`${p.id}: no gazetteer reference saved. Run scripts/fetch-gazetteer.mjs`);
  const dists = good.map(([name, v]) => [name, km(p, v)]);
  const near = dists.filter(([, d]) => d <= limit);
  if (good.length && !near.length) fails.push(`${p.id}: ${dists.map(([n, d]) => `${Math.round(d)} km from ${n}`).join(', ')} (limit ${limit} km)`);
  else if (near.length < dists.length) {
    const far = dists.filter(([, d]) => d > limit).map(([n, d]) => `${n} is ${Math.round(d)} km away`).join(', ');
    if (p.ref_note) notes.push(`${p.id}: matches ${near.map(([n]) => n).join(', ')}; ${far}. Explained: ${p.ref_note}`);
    else fails.push(`${p.id}: references disagree: ${far}. Check which is the right feature, then add a "ref_note" saying why.`);
  }
  p.refSummary = dists.map(([n, d]) => `${n} ${d.toFixed(1)} km`).join(', ');

  if (isSea || p.country_check === false) { notes.push(`${p.id}: country check skipped (${isSea ? 'sea label' : p.country_note || 'no reason given'})`); continue; }
  const f = countries.get(p.country);
  if (!f) { fails.push(`${p.id}: country "${p.country}" is not a country name on the map`); continue; }
  const inside = d3.geoContains(f, [p.lon, p.lat]);
  if (!inside) {
    const step = 0.2;
    const coastal = [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, step], [step, -step], [-step, -step]].some(([dx, dy]) => d3.geoContains(f, [p.lon + dx, p.lat + dy]));
    if (coastal) notes.push(`${p.id}: on the coast of ${p.country} (inside within about 20 km at map resolution)`);
    else fails.push(`${p.id}: point is outside ${p.country} on the map`);
  }
}

// Hand-listed expectations for Iran: [place, test, plain statement]
const near = (a, b, maxKm) => byId.has(a) && byId.has(b) && km(byId.get(a), byId.get(b)) <= maxKm;
const P = (id) => byId.get(id) || {lat: NaN, lon: NaN};
const expectations = [
  ['natanz', near('natanz', 'isfahan', 150), 'Natanz is within 150 km of Isfahan'],
  ['fordow', near('fordow', 'qom', 60), 'Fordow is within 60 km of Qom'],
  ['bandar-abbas', near('bandar-abbas', 'strait-of-hormuz', 110), 'Bandar Abbas is on the Strait of Hormuz (within 110 km of its centre)'],
  ['qeshm-island', near('qeshm-island', 'bandar-abbas', 90), 'Qeshm Island is next to Bandar Abbas'],
  ['parchin', near('parchin', 'tehran', 60), 'Parchin is within 60 km of Tehran'],
  ['arak', near('arak', 'tehran', 300) && P('arak').lon < P('tehran').lon, 'The Arak reactor is southwest of Tehran, within 300 km'],
  ['bushehr', P('bushehr').lat < 29.5 && P('bushehr').lon > 50 && P('bushehr').lon < 51.5, 'Bushehr is on the Persian Gulf coast'],
  ['kharg-island', near('kharg-island', 'bushehr', 100) && P('kharg-island').lon < P('bushehr').lon, 'Kharg Island is in the Gulf northwest of Bushehr'],
  ['chabahar', P('chabahar').lon > 60 && P('chabahar').lat < 26, 'Chabahar is on the Gulf of Oman in the far southeast'],
  ['tabriz', P('tabriz').lat > 37 && P('tabriz').lon < 47.5, 'Tabriz is in the far northwest'],
  ['mashhad', P('mashhad').lon > 58 && P('mashhad').lat > 35, 'Mashhad is in the far northeast'],
  ['shiraz', P('shiraz').lat < 30.5, 'Shiraz is in the south'],
  ['isfahan', near('isfahan', 'tehran', 400) && P('isfahan').lat < P('tehran').lat, 'Isfahan is south of Tehran, in the centre'],
  ['al-udeid', near('al-udeid', 'doha', 50), 'Al Udeid is just outside Doha'],
  ['nsa-bahrain', near('nsa-bahrain', 'manama', 20), 'The Fifth Fleet base is in Manama'],
  ['strait-of-hormuz', P('strait-of-hormuz').lat > 25.5 && P('strait-of-hormuz').lat < 27.2 && P('strait-of-hormuz').lon > 55.5 && P('strait-of-hormuz').lon < 57.2, 'The Strait of Hormuz label sits between Iran and Oman'],
];
for (const [id, ok, text] of expectations) if (!ok) fails.push(`${id}: expectation failed: ${text}`);

// Plain plot for eyeballing.
const proj = d3.geoNaturalEarth1().rotate([-11, 0]).fitSize([2400, 1200], {type: 'Sphere'});
const gp = d3.geoPath(proj);
const svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 1200" font-family="Arial" font-size="9"><rect width="2400" height="1200" fill="#0B1220"/>`];
for (const f of countries.values()) svgParts.push(`<path d="${gp(f)}" fill="#1A2540" stroke="#0B1220" stroke-width=".5"/>`);
for (const p of places) { const [x, y] = proj([p.lon, p.lat]); svgParts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#7CC8FF"/><text x="${(x + 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" fill="#EAF2FF">${p.name.replace(/&/g, 'and')}</text>`); }
svgParts.push('</svg>');
// With --data the plot goes next to that data folder, so a dry run never rewrites the live notes.
// Inside the larger project the plot goes to ../notes; in a standalone clone it stays in the app folder (gitignored).
const notesDir = path.join(APP, '..', 'notes');
const hasNotes = await fs.stat(notesDir).then((s) => s.isDirectory(), () => false);
const plotFile = arg('--data') ? path.join(dataDir, '..', 'coords-plot.svg') : hasNotes ? path.join(notesDir, 'coords-plot.svg') : path.join(APP, 'coords-plot.svg');
await fs.mkdir(path.dirname(plotFile), {recursive: true});
await fs.writeFile(plotFile, svgParts.join(''));

if (process.argv.includes('--verbose')) for (const p of places) console.log(`  ${p.id}: ${p.lat}, ${p.lon} | ${p.refSummary || 'no reference'}`);
for (const n of notes) console.log(`note  ${n}`);
for (const f of fails) console.log(`FAIL  ${f}`);
console.log(`${places.length} places, ${expectations.length} Iran-area expectations, ${fails.length} failure(s), ${notes.length} note(s). Plot: ${path.relative(path.join(APP, '..'), plotFile)}`);
process.exit(fails.length ? 1 : 0);
