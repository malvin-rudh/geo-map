// Runs the Gate A checks in order and prints one PASS, FAIL or NOT RUN line per gate.
// Gates: build check (schema, links between files, limits), coordinates, source links, style.
// Usage: node scripts/verify.mjs [--data <dir>] [--skip-links]
//   --data <dir>   check a copy of the data instead of app/data (passed to every gate that reads data)
//   --skip-links   do not fetch source links (no internet); the links gate is reported as NOT RUN
// Exit code: 0 when every gate that ran passed, 1 otherwise. Full output of a failing gate is printed.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const data = arg('--data') ? ['--data', path.resolve(arg('--data'))] : [];
const skipLinks = process.argv.includes('--skip-links');

const gates = [
  ['A1 build check', ['build.mjs', '--check', ...data]],
  ['A2 coordinates', ['scripts/check-coords.mjs', ...data]],
  ['A3 links', ['scripts/check-links.mjs', ...data], skipLinks ? 'skipped with --skip-links' : ''],
  ['A4 style', ['scripts/check-style.mjs']],
];

let failed = 0;
const lines = [];
for (const [name, args, skip] of gates) {
  if (skip) { lines.push(`NOT RUN  ${name} (${skip})`); continue; }
  const r = spawnSync(process.execPath, args, {cwd: APP, encoding: 'utf8'});
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const last = out.split('\n').filter(Boolean).pop() || '(no output)';
  if (r.status === 0) lines.push(`PASS     ${name}: ${last}`);
  else { failed++; lines.push(`FAIL     ${name}: ${last}`); console.log(`--- ${name} output ---\n${out}\n`); }
}
for (const l of lines) console.log(l);
console.log(failed ? `Gate A: ${failed} gate(s) failed.` : 'Gate A: all gates that ran passed.');
process.exit(failed ? 1 : 0);
