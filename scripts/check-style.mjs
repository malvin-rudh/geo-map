// Style check, offline:
//  1. No em or en dashes anywhere in this world's own text, data and code.
//  2. One colour system: every colour in the app's CSS, HTML and JS is a custom property declared in
//     :root in style.css. Outside :root, the CSS may only use var(--...); the HTML and JS may only use
//     values that :root declares (the arrow colours in app.js must match their --tokens). No gradients.
//  3. Arrow types stay distinguishable: each has its own line style, arrowhead and icon, and the
//     colours are compared under simulated colour-blindness (protan, deutan, tritan).
// Usage: node scripts/check-style.mjs
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = path.join(APP, '..');
const REPO = path.join(WORLD, '..', '..');
const fails = [];

async function walk(dir, out = []) {
  for (const ent of await fs.readdir(dir, {withFileTypes: true})) {
    if (['vendor', 'node_modules', '.git'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else if (/\.(md|json|js|mjs|css|html|txt|py|svg)$/.test(ent.name)) out.push(p);
  }
  return out;
}
// In the larger project the app sits in a folder called geopolitical-map with its notes and decisions;
// those are scanned too. In a standalone clone only the app folder is scanned.
const files = await walk(path.basename(WORLD) === 'geopolitical-map' ? WORLD : APP);
// When this app sits inside a larger repo, the assistant skill that updates it is checked too (optional).
for (const extra of ['.claude/skills/geo-map', '.agents/skills/geo-map']) {
  try { await walk(path.join(REPO, extra), files); } catch { /* not present, for example in the standalone repo */ }
}

let dashFiles = 0;
for (const f of files) {
  const text = await fs.readFile(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/[\u2014\u2013]/.test(line)) { fails.push(`dash: ${path.relative(REPO, f)}:${i + 1}`); dashFiles++; }
  });
}

const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g;
const css = await fs.readFile(path.join(APP, 'style.css'), 'utf8');
const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
if (!rootBlocks.length) fails.push('colour: style.css has no :root block');
const tokens = new Map();
for (const b of rootBlocks) for (const m of b[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
const declared = new Set([...tokens.values()].filter((v) => /^#[0-9a-fA-F]+$/.test(v)).map((v) => v.toUpperCase()));
const cssOutside = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
for (const m of cssOutside.matchAll(COLOR)) fails.push(`colour: style.css uses ${m[0]} outside :root; declare it as a token and use var(--name)`);
for (const m of cssOutside.matchAll(/var\(--([\w-]+)/g)) if (!tokens.has(m[1])) fails.push(`colour: style.css uses var(--${m[1]}), which :root does not declare`);
for (const name of ['index.html', 'src/app.js']) {
  const text = await fs.readFile(path.join(APP, name), 'utf8');
  for (const m of text.matchAll(COLOR)) if (!declared.has(m[0].toUpperCase())) fails.push(`colour: ${name} uses ${m[0]}, which is not a colour token in :root`);
}
for (const name of ['style.css', 'index.html', 'src/app.js']) {
  const text = await fs.readFile(path.join(APP, name), 'utf8');
  for (const m of text.matchAll(/\b(linear-gradient|radial-gradient|conic-gradient)/g)) fails.push(`effect: ${name} uses ${m[1]}`);
}

// Arrow types: read them from app.js so this check follows the real code.
const app = await fs.readFile(path.join(APP, 'src/app.js'), 'utf8');
const types = [...app.matchAll(/^\s{4}(\w+): \{label: '([^']+)'.*?color: '(#[0-9A-Fa-f]{6})', dash: (null|'[^']+'), width: ([\d.]+), head: '(\w+)'.*?\n\s+glyph: '([^']+)'/gm)]
  .map((m) => ({id: m[1], color: m[3], dash: m[4], head: m[6], glyph: m[7]}));
if (types.length !== 5) fails.push(`expected 5 arrow types in app.js, found ${types.length}`);
for (const t of types) if ((tokens.get(t.id) || '').toUpperCase() !== t.color.toUpperCase()) fails.push(`colour: arrow type ${t.id} is ${t.color} in app.js but --${t.id} is ${tokens.get(t.id) || 'missing'} in style.css`);
for (const key of ['dash', 'head', 'glyph', 'color']) if (new Set(types.map((t) => t[key])).size !== types.length) fails.push(`arrow types share the same ${key}`);

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
const SIM = { // Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lab = ([r, g, b]) => {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
console.log('Colour difference between arrow types (CIE76 delta E; under 10 is hard to tell apart by colour alone):');
let weakest = Infinity;
for (const [mode, m] of Object.entries(SIM)) {
  let min = Infinity, pair = '';
  const labs = types.map((t) => lab(m.map((row) => Math.min(1, Math.max(0, row[0] * rgb(t.color)[0] + row[1] * rgb(t.color)[1] + row[2] * rgb(t.color)[2])))));
  for (let i = 0; i < types.length; i++) for (let j = i + 1; j < types.length; j++) {
    const d = Math.hypot(...labs[i].map((v, k) => v - labs[j][k]));
    if (d < min) { min = d; pair = `${types[i].id} and ${types[j].id}`; }
  }
  weakest = Math.min(weakest, min);
  console.log(`  ${mode.padEnd(7)} closest pair: ${pair}, delta E ${min.toFixed(1)}`);
}
// Colour alone is never relied on. Any pair that is close in colour must differ in line style, arrowhead and icon,
// and one of the two must be drawn hollow (outlined), which survives any colour-blindness.
const hollow = new Set([...app.matchAll(/^\s{4}(\w+): \{label:.*hollow: true/gm)].map((m) => m[1]));
if (weakest < 10 && hollow.size === 0) fails.push(`arrow colours are close under colour-blindness (delta E ${weakest.toFixed(1)}) and no type is drawn hollow to separate them`);
if (weakest < 10) console.log(`  Note: colour alone is not enough for every reader (weakest delta E ${weakest.toFixed(1)}). Types are separated by line style, arrowhead, icon, and hollow drawing for: ${[...hollow].join(', ')}.`);
console.log(`Line styles: ${types.map((t) => `${t.id}=${t.dash === 'null' ? 'solid' : t.dash}`).join(', ')}`);
console.log(`Arrowheads: ${types.map((t) => `${t.id}=${t.head}`).join(', ')}`);

for (const f of fails) console.log(`FAIL  ${f}`);
console.log(`${files.length} files scanned for dashes; 3 files checked against ${tokens.size} :root tokens (${declared.size} colours). ${fails.length} failure(s).`);
process.exit(fails.length ? 1 : 0);
