// Unit tests of the physics classifier on synthetic SPICE networks (no vendor data needed).
// Run: node tests/magnetic.unit.mjs [path/to/index.html]
import { load } from './load.mjs';
const { RF, Spice, Magnetic } = load(process.argv[2]);
let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : '')); cond ? pass++ : fail++; };
const freq = Float64Array.from({ length: 301 }, (_, i) => 1e4 * 1e5 ** (i / 300));
function net(text, name = 'dut') {
  const lib = Spice.parse(text, name + '.lib');
  const sub = lib.tops[0];
  const samples = Spice.sparams(Spice.flatten(lib, sub), freq);
  return { name, n: sub.pins.length, refs: Array(sub.pins.length).fill(50), freq, samples, version: 'Touchstone 1.x', vendor: null };
}
function permute(ds, order) {
  const n = ds.n;
  return { ...ds, samples: ds.samples.map(s => { const out = new Float64Array(2 * n * n); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) RF.put(out, n, r, c, RF.get(s, n, order[r], order[c])); return out; }) };
}
const cat = r => r.verdict?.category + ':' + r.verdict?.level;
const sortPairs = pairs => JSON.stringify(pairs.map(p => [...p].sort()).sort());

// --- four-port magnetics ---
const cmcNet = '.subckt cmc 1 2 3 4\nL1 1 a 10m\nRa a 2 0.2\nL2 3 b 10m\nRb b 4 0.2\nK1 L1 L2 0.997\nRp1 1 2 8k\nRp2 3 4 8k\nC1 1 2 8p\nC2 3 4 8p\n.ends';
const cmc = Magnetic.analyze(net(cmcNet));
ok(cmc.verdict.category === 'cmc', 'CMC (10 mH, k 0,997, Kernverlust) → CMC', cat(cmc));
ok(sortPairs(cmc.windings.pairs) === sortPairs([[0, 1], [2, 3]]) && cmc.windings.confidence === 'sicher', 'CMC: Wicklungspfade P1–P2, P3–P4 sicher', JSON.stringify(cmc.windings));
ok(Math.abs(cmc.features.k - 0.997) < 0.002, 'CMC: k aus Y-Matrix ≈ 0,997', String(cmc.features.k));
ok(Math.abs(cmc.features.L1 - 10e-3) / 10e-3 < 0.05, 'CMC: L1 ≈ 10 mH', String(cmc.features.L1));
const dd = Magnetic.analyze(net('.subckt dd 1 2 3 4\nL1 1 a 10u\nRa a 2 20m\nL2 3 b 10u\nRb b 4 20m\nK1 L1 L2 0.97\nC1 1 2 5p\nC2 3 4 5p\n.ends'));
ok(dd.verdict.category === 'coupled', 'Doppeldrossel (10 µH, k 0,97, verlustarm) → gekoppelt', cat(dd));
ok(Math.abs(dd.features.k - 0.97) < 0.005, 'Doppeldrossel: k ≈ 0,97', String(dd.features.k));
const tr = Magnetic.analyze(net('.subckt tr 1 2 3 4\nL1 1 a 100u\nRa a 2 0.3\nL2 3 b 400u\nRb b 4 0.6\nK1 L1 L2 0.999\n.ends'));
ok(tr.verdict.category === 'transformer', 'Übertrager 1:2 → Übertrager', cat(tr) + ' n=' + tr.features.n);
ok(tr.recommended === 'winding', 'Übertrager: Wicklungs-Zuordnung empfohlen', tr.recommended);
const two = Magnetic.analyze(net('.subckt two 1 2 3 4\nL1 1 a 10u\nRa a 2 50m\nL2 3 b 22u\nRb b 4 50m\n.ends'));
ok(two.verdict.category === 'two-elements', 'Zwei ungekoppelte Spulen → zwei Zweipole', cat(two));
const grounded = Magnetic.analyze(net('.subckt g 1 2 3 4\nR1 1 3 10\nC1 1 0 1n\nC2 2 0 1n\nR2 2 4 10\nC3 3 0 1n\nL4 4 0 1u\n.ends'));
ok(grounded.verdict.category === 'other' && grounded.verdict.level === 'unklar', 'Massebezogenes Netzwerk → keine Wicklungen, unklar', cat(grounded));

// Permutation and polarity invariance: class stays, proposed pairs follow the ports.
for (const order of [[2, 3, 0, 1], [1, 0, 3, 2], [0, 2, 1, 3], [3, 1, 2, 0], [0, 1, 3, 2]]) {
  const base = net(cmcNet), r = Magnetic.analyze(permute(base, order));
  const back = r.windings.pairs.map(p => p.map(i => order[i]));
  ok(r.verdict.category === 'cmc' && sortPairs(back) === sortPairs([[0, 1], [2, 3]]), 'Permutation ' + order.join('') + ': Klasse und Wicklungen folgen den Ports', cat(r) + ' ' + JSON.stringify(r.windings.pairs));
  const line = r.mappings.find(m => m.kind === 'line').pairs.map(p => p.map(i => order[i]));
  ok(sortPairs(line) === sortPairs([[0, 2], [1, 3]]), 'Permutation ' + order.join('') + ': Leitungspaare gleichsinnig (gepunktete Enden)', JSON.stringify(line));
}

// --- two-pole elements ---
const two2 = (body, pins = '1 2') => Magnetic.analyze(net('.subckt e ' + pins + '\n' + body + '\n.ends'));
const capShunt = two2('Rt 1 2 1m\nC1 1 a 100n\nRs a b 10m\nLs b 0 0.5n');
ok(capShunt.topology === 'shunt' && capShunt.verdict.category === 'capacitor' && Math.abs(capShunt.features.C - 100e-9) / 100e-9 < 0.05, 'Kondensator quer 100 nF → Kondensator, C erkannt', capShunt.topology + ' ' + cat(capShunt) + ' C=' + capShunt.features.C);
const capSeries = two2('C1 1 a 10n\nR1 a 2 50m');
ok(capSeries.topology === 'series' && capSeries.verdict.category === 'capacitor', 'Kondensator in Serie → Kondensator', capSeries.topology + ' ' + cat(capSeries));
const res = two2('R1 1 a 10\nL1 a 2 0.2n');
ok(res.verdict.category === 'resistor' && Math.abs(res.features.R - 10) < 0.2, 'Widerstand 10 Ω → Widerstand', cat(res) + ' R=' + res.features.R);
const air = two2('R1 1 a 0.05\nL1 a 2 100n\nC1 1 2 0.2p');
ok(air.verdict.category === 'coreless', 'Luftspule 100 nH, Q hoch, L konstant → Luft-/Keramikkern', cat(air) + ' q=' + air.features.qMax + ' flat=' + air.features.flat);
const ferrite = two2('R1 1 a 0.1\nL1 a b 2u\nL2 b 2 8u\nR2 b 2 200\nC1 1 2 2p');
ok(ferrite.verdict.category === 'ferrite-inductor', 'Spule mit Permeabilitätsabfall → Ferritkern', cat(ferrite) + ' flat=' + ferrite.features.flat + ' tan=' + ferrite.features.tanMax);
const bead = two2('Rdc 1 a 0.1\nL1 a 2 1u\nRp a 2 300\nCp a 2 1p');
ok(bead.verdict.category === 'bead', 'Ferrit-Perle (L ∥ R) → Bead', cat(bead) + ' span=' + bead.features.resistiveSpan);
const one = (() => { const d = net('.subckt o 1 2\nL1 1 a 1u\nR1 a 2 0.1\n.ends'); const s = d.samples.map(x => { const o = new Float64Array(2); const z = RF.div(RF.scale(RF.sub([1, 0], RF.get(x, 2, 1, 0)), 100), RF.get(x, 2, 1, 0)); const g = RF.div(RF.sub(z, [50, 0]), RF.add(z, [50, 0])); o[0] = g[0]; o[1] = g[1]; return o; }); return Magnetic.analyze({ ...d, n: 1, refs: [50], samples: s }); })();
ok(one.topology === 'one-port' && ['ferrite-inductor', 'coreless'].includes(one.verdict.category), 'Eintor (.s1p) mit Spule → Induktivität', one.topology + ' ' + cat(one));

// --- data quality, metadata, fingerprints ---
const narrow = Magnetic.analyze({ ...net(cmcNet), freq: Float64Array.from(freq, f => 1e6 + f * 1e-9) });
ok(narrow.status === 'insufficient-data', 'Zu schmales Band → Datenlage unzureichend', narrow.status + ' ' + (narrow.reason || ''));
const six = Magnetic.analyze({ n: 6, refs: Array(6).fill(50), freq, samples: [] });
ok(six.status === 'not-applicable', '6-Port wird nicht physikalisch klassifiziert (Vorlagen übernehmen)', six.status);
const meta = Magnetic.analyze({ ...net(cmcNet), vendor: { family: 'WE-DD', part: '7448709022' } });
ok(meta.manufacturer.category === 'coupled' && meta.verdict.category === 'cmc' && meta.agreement === 'widerspricht', 'Herstellerangabe und Physik bleiben getrennt; Widerspruch wird gemeldet', meta.agreement);
ok(Magnetic.familyClass('WE-CMB') === 'cmc' && Magnetic.familyClass('WE-MCRI') === 'coupled' && Magnetic.familyClass('WE-LAN') === 'transformer' && Magnetic.familyClass('WCAP-CSGP') === 'capacitor' && Magnetic.familyClass('XYZ') === null, 'Familienzuordnung WE-CMB/MCRI/LAN/WCAP');
ok(Magnetic.categoryFromName('CMC Netz') === 'cmc' && Magnetic.categoryFromName('LAN-Übertrager') === 'transformer' && Magnetic.categoryFromName('WE-DD 1210') === 'coupled' && Magnetic.categoryFromName('Messung 3') === null, 'Kategorie aus Vorlagenname');
const fpA = Magnetic.fingerprint(cmc), fpB = Magnetic.fingerprint(dd);
ok(fpA.kind === 'm4' && Number.isFinite(fpA.k) && fpA.sdc21.length === 5, 'Physik-Fingerabdruck enthält k, Kernverlust, Sdd21/Scc21/Sdc21', JSON.stringify(fpA).slice(0, 120));
ok(Magnetic.distance(fpA, fpA) === 0 && Magnetic.distance(fpA, fpB) > 0.5 && Magnetic.distance(fpA, Magnetic.fingerprint(capShunt)) === null, 'Abstand: gleich 0, CMC↔DD groß, Zweipol↔Vierpol nicht vergleichbar', String(Magnetic.distance(fpA, fpB)));
const frozen = net(cmcNet), copy = Float64Array.from(frozen.samples[10]);
Magnetic.analyze(frozen);
ok(frozen.samples[10].every((v, i) => v === copy[i]), 'Analyse verändert den Datensatz nicht');

console.log(pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
