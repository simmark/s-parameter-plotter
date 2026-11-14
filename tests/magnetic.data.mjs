// Regression of the physics classifier on private vendor measurements and simulations.
// The data are not part of the repository (licence); point SPA_PRIVATE_DATA at a folder with
//   dd/*.s4p (WE-DD), mcri/*.s4p (WE-MCRI), cmc/*.s4p (measured CMCs), rfi/*.s2p, lan/7490220115.s6p, sim/*.json
// Missing folders are skipped and reported. Results on these files are a regression baseline, not an independent accuracy.
import fs from 'node:fs';
import { load, read, list, DATA } from './load.mjs';
const { RF, Magnetic } = load(process.argv[2]);
let pass = 0, fail = 0, skipped = [];
const ok = (cond, name, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : '')); cond ? pass++ : fail++; };
const cat = r => r.status !== 'candidate' ? r.status : r.verdict.level === 'unklar' ? 'unklar' : r.verdict.category;
const dir = name => { const files = list(DATA + '/' + name); if (!files.length) skipped.push(name); return files; };
const confusion = {};
const tally = (group, r) => { const c = (confusion[group] ||= {}); const k = r.status !== 'candidate' ? r.status : r.verdict.category ? r.verdict.category + ' (' + r.verdict.level + ')' : 'unklar'; c[k] = (c[k] || 0) + 1; };
const times = [];
const run = ds => { const t = performance.now(); const r = Magnetic.analyze(ds); times.push(performance.now() - t); return r; };
function permute(ds, order) {
  const n = ds.n;
  return { ...ds, samples: ds.samples.map(s => { if (!s) return s; const o = new Float64Array(2 * n * n); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) RF.put(o, n, r, c, RF.get(s, n, order[r], order[c])); return o; }) };
}

// 1 · Coupled inductors (negative class for CMC): never a CMC, ideally recognised as coupled.
for (const fam of ['dd', 'mcri']) {
  const files = dir(fam);
  let cmcHits = 0, coupled = 0, worst = '';
  for (const f of files) {
    const r = run(read(RF, f)); tally('WE-' + fam.toUpperCase() + ' Messung', r);
    if (r.verdict?.category === 'cmc') { cmcHits++; worst = f; }
    if (r.verdict?.category === 'coupled') coupled++;
  }
  if (files.length) {
    ok(cmcHits === 0, 'WE-' + fam.toUpperCase() + ': keine Datei als CMC eingestuft', cmcHits + '/' + files.length + (worst ? ' z. B. ' + worst : ''));
    ok(coupled / files.length >= 0.9, 'WE-' + fam.toUpperCase() + ': mindestens 90 % als gekoppelte Drossel erkannt', coupled + '/' + files.length);
  }
}
// 2 · Measured CMCs (complex, with phase): recognised as CMC, windings and k plausible.
for (const f of dir('cmc')) {
  const r = run(read(RF, f)); tally('CMC Messung', r);
  ok(r.verdict?.category === 'cmc', 'CMC-Messung ' + f.split('/').pop() + ' → CMC', cat(r) + ' k=' + r.features?.k + ' tan=' + r.features?.tanMax);
}
// 3 · Port permutations and reversed windings keep the class; proposed windings follow the ports.
for (const f of [...dir('dd').slice(0, 3), ...dir('cmc').slice(0, 2)]) {
  const d = read(RF, f), base = Magnetic.analyze(d);
  for (const order of [[2, 3, 0, 1], [1, 0, 2, 3], [0, 3, 2, 1], [3, 2, 1, 0]]) {
    const r = Magnetic.analyze(permute(d, order));
    const back = JSON.stringify(r.windings.pairs.map(p => p.map(i => order[i]).sort()).sort());
    ok(cat(r) === cat(base) && back === JSON.stringify(base.windings.pairs.map(p => [...p].sort()).sort()), 'Permutation ' + order.join('') + ' ' + f.split('/').pop(), cat(base) + ' → ' + cat(r));
  }
}
// 4 · Independent mixed-mode check: module (own transform) vs the analyzer's network pipeline at the decade points.
for (const f of dir('dd').slice(0, 2).concat(dir('cmc').slice(0, 1))) {
  const d = read(RF, f), r = Magnetic.analyze(d), line = r.mappings.find(m => m.kind === 'line').pairs;
  const config = { loads: d.refs.map(() => ({ type: 'active' })), pairs: line.map(([p, q], i) => ({ p, q, id: i + 1 })), ref: null };
  const layout = RF.prepareNetwork(d, config);
  let worst = 0;
  for (const row of r.features.modes) {
    const i = d.freq.indexOf(row.f), mm = RF.processPoint(d, config, layout, i)[1], m = layout.mmModes.length;
    const at = key => layout.mmModes.findIndex(x => x.key === key);
    const v = (o, inp) => 20 * Math.log10(RF.abs(RF.get(mm, m, at(o), at(inp))));
    worst = Math.max(worst, Math.abs(v('D2', 'D1') - row.sdd21), Math.abs(v('C2', 'C1') - row.scc21), Math.abs(v('D2', 'C1') - row.sdc21));
  }
  ok(worst < 0.01, 'Sdd21/Scc21/Sdc21 unabhängig gegengerechnet ' + f.split('/').pop(), 'max. Abweichung ' + worst.toExponential(2) + ' dB');
}
// 4b · Physical k from the measurement against the coupling parameter K of the vendor model of the same article.
{
  const libFile = DATA + '/libs/dd/WE-DD.lib';
  if (fs.existsSync(libFile)) {
    const lib = fs.readFileSync(libFile, 'latin1'), diffs = [];
    for (const f of list(DATA + '/dd')) {
      const part = (f.match(/(7448\d{5,6})/) || [])[1]; if (!part) continue;
      const at = lib.search(new RegExp('\\.subckt[^\\n]*' + part, 'i')); if (at < 0) continue;
      const k = lib.slice(at, lib.indexOf('.ends', at)).match(/^\+\s*K\s*=\s*([0-9.eE+-]+)/mi); if (!k) continue;
      diffs.push(Math.abs(Math.abs(Magnetic.analyze(read(RF, f)).features.k) - Number(k[1])));
    }
    diffs.sort((a, b) => a - b);
    ok(diffs.length > 0 && diffs.at(-1) <= 0.08 && diffs[diffs.length >> 1] <= 0.04, 'Gemessenes k gegen Modell-K (WE-DD LTspice): Median ≤ 0,04, max. ≤ 0,08', diffs.length + ' Artikel, Median ' + diffs[diffs.length >> 1]?.toFixed(3) + ', max. ' + diffs.at(-1)?.toFixed(3));
  } else skipped.push('libs/dd');
}
// 5 · Two-port inductors and the reduced LAN transformer.
for (const f of dir('rfi')) { const r = run(read(RF, f)); tally('WE-RFI Messung', r); ok(['ferrite-inductor', 'coreless'].includes(r.verdict?.category), 'RFI ' + f.split('/').pop() + ' → Induktivität', cat(r)); }
const lan = list(DATA + '/lan').find(f => /7490220115/.test(f));
if (lan) {
  const d = read(RF, lan), keep = [0, 2, 3, 5];
  const r = run({ ...d, n: 4, refs: [50, 50, 50, 50], vendor: null, samples: d.samples.map(s => s && RF.terminate(s, 6, keep, [1, 4], [[1, 0], [1, 0]])) });
  tally('LAN-Übertrager (4-Port reduziert)', r);
  ok(r.verdict?.category !== 'coupled', 'LAN-Übertrager reduziert: nicht als Doppeldrossel', cat(r) + ' (' + r.verdict.ranked.slice(0, 2).map(x => x.category).join('/') + ')');
} else skipped.push('lan');
// 6 · Simulated vendor models (simulation, never treated as measurement).
for (const [fam, label] of [['cmb', 'cmc'], ['dd', 'coupled'], ['mcri', 'coupled'], ['rfi', null]]) {
  const file = DATA + '/sim/' + fam + '.json';
  if (!fs.existsSync(file)) { skipped.push('sim/' + fam); continue; }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  let wrong = 0;
  for (const row of j.rows) {
    const r = run({ name: row.name, n: row.n, refs: Array(row.n).fill(50), freq: Float64Array.from(j.freq), samples: row.samples.map(x => x && Float64Array.from(x)), version: 'SPICE', vendor: null });
    tally('Simulation ' + fam.toUpperCase(), r);
    if (r.provenance !== 'simulation') wrong++;
    if (label === 'coupled' && r.verdict?.category === 'cmc') wrong++;
    if (label === 'cmc' && r.verdict?.category === 'coupled') wrong++;
  }
  ok(wrong === 0, 'Simulation ' + fam.toUpperCase() + ': keine Verwechslung CMC↔Doppeldrossel, als Simulation markiert', wrong + '/' + j.rows.length);
}
console.log('\nErgebnis je Gruppe (Regression, keine unabhängige Genauigkeit):');
for (const [g, v] of Object.entries(confusion)) console.log('  ' + g.padEnd(34) + Object.entries(v).map(([k, n]) => k + ': ' + n).join(' · '));
const sorted = times.sort((a, b) => a - b);
if (times.length) console.log('Laufzeit je Datei: Median ' + sorted[sorted.length >> 1].toFixed(1) + ' ms, Maximum ' + sorted.at(-1).toFixed(1) + ' ms (' + times.length + ' Analysen)');
if (skipped.length) console.log('Übersprungen (Daten fehlen): ' + [...new Set(skipped)].join(', '));
console.log(pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
