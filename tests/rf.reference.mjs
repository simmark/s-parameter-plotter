// Pflicht-Regressionstest E: RF-Mathematik gegen Referenznetzwerke mit bekannter Lösung und gegen den Rechenkern
// der zuletzt veröffentlichten Fassung (Branch main). Läuft in Node, ohne Browser:  node tests/rf.reference.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from './load.mjs';

const { RF, Spice, Magnetic } = load();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
const close = (a, b, rel = 1e-9, abs = 1e-12) => Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b));
const cclose = (a, b, rel = 1e-9, abs = 1e-12) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= abs + rel * Math.max(Math.hypot(...a), Math.hypot(...b));
const C = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }, s: (a, k) => [a[0] * k, a[1] * k] };
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
const logf = (f1, f2, n) => Float64Array.from({ length: n }, (_, k) => f1 * (f2 / f1) ** (k / (n - 1)));
const active = n => RF.indices(n).map(() => ({ type: 'active' }));
function dataset(n, freq, sampleAt, refs = Array(n).fill(50)) {
  return { name: 'ref.s' + n + 'p', n, refs, freq: Float64Array.from(freq), samples: Array.from(freq, sampleAt), version: '1.0', format: 'RI', sourceKind: 'S', portNames: [], sourcePairs: [], profile: null, embedded: null, warnings: [], noiseCount: 0, demo: false };
}
function matrixOf(n, fn) { const m = RF.matrix(n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) RF.put(m, n, i, j, fn(i, j)); return m; }
// random passive-looking reciprocal matrix
const randomS = n => { const v = []; for (let i = 0; i < n; i++) { v.push([]); for (let j = 0; j <= i; j++) v[i].push([rnd() * 0.6 / Math.sqrt(n), rnd() * 0.6 / Math.sqrt(n)]); } return matrixOf(n, (i, j) => i >= j ? v[i][j] : v[j][i]); };
const netlist = text => { const lib = Spice.parse(text, 'ref.lib'); return (sweep, name) => Spice.dataset(lib, lib.tops.find(t => !name || t.name.toLowerCase() === name.toLowerCase()) ?? lib.tops[0], sweep); };
const run = (ds, config) => { const layout = RF.prepareNetwork(ds, config); return { layout, points: Array.from(ds.freq, (_, i) => RF.processPoint(ds, config, layout, i)) }; };
const seriesS = (Z, z0 = 50) => { const d = C.add(Z, [2 * z0, 0]), s11 = C.div(Z, d), s21 = C.div([2 * z0, 0], d); return matrixOf(2, (i, j) => i === j ? s11 : s21); };
const shuntS = (Z, z0 = 50) => { const d = C.add([z0, 0], C.s(Z, 2)), s11 = C.div([-z0, 0], d), s21 = C.div(C.s(Z, 2), d); return matrixOf(2, (i, j) => i === j ? s11 : s21); };

console.log('Touchstone und S-Parameter (Single Ended)');
{
  const lines = (fmt, conv) => '# MHz S ' + fmt + ' R 50\n' + [1, 10, 100].map(f => [f, ...[[0.1, 0.2], [0.7, -0.3], [0.7, -0.3], [-0.2, 0.05]].flatMap(conv)].join(' ')).join('\n') + '\n';
  const ri = RF.parseTouchstone(lines('RI', v => v), 'a.s2p');
  const ma = RF.parseTouchstone(lines('MA', v => [Math.hypot(...v), Math.atan2(v[1], v[0]) * 180 / Math.PI]), 'a.s2p');
  const db = RF.parseTouchstone(lines('DB', v => [20 * Math.log10(Math.hypot(...v)), Math.atan2(v[1], v[0]) * 180 / Math.PI]), 'a.s2p');
  const same = (a, b) => a.samples.every((s, i) => s.every((v, k) => close(v, b.samples[i][k], 1e-12, 1e-13)));
  check('RI, MA und DB ergeben dieselben komplexen Werte', same(ri, ma) && same(ri, db));
  check('Frequenzeinheit MHz und Bezugsimpedanz', ri.freq[1] === 10e6 && ri.refs[0] === 50);
  check('Zweitor-Reihenfolge S11 S21 S12 S22', cclose(RF.get(ri.samples[0], 2, 1, 0), [0.7, -0.3]) && cclose(RF.get(ri.samples[0], 2, 1, 1), [-0.2, 0.05]));
  const pad = netlist('.subckt PAD 1 2\nR1 1 0 96.2475\nR2 1 2 71.1512\nR3 2 0 96.2475\n.ends\n')({ f1: 1e5, f2: 1e9, n: 11 });
  const s21 = RF.get(pad.samples[5], 2, 1, 0), s11 = RF.get(pad.samples[5], 2, 0, 0);
  check('10-dB-π-Dämpfungsglied: S21 = −10 dB, S11 = 0', close(20 * Math.log10(RF.abs(s21)), -10, 0, 1e-3) && RF.abs(s11) < 1e-4, (20 * Math.log10(RF.abs(s21))).toFixed(4) + ' dB');
}

console.log('Portabschlüsse: offen, kurzgeschlossen, angepasst, R, R+jX, RLC');
{
  const Z = [100, 40], ds = dataset(2, [1e6, 1e7], () => seriesS(Z));
  const zin = load => { const cfg = { loads: [{ type: 'active' }, load], pairs: [], ref: null }; const [se] = run(ds, cfg).points[1]; return RF.reflection(RF.get(se, 1, 0, 0), 50); };
  check('Port 2 offen: Γ = +1 (Leerlauf)', (() => { const cfg = { loads: [{ type: 'active' }, { type: 'open' }], pairs: [], ref: null }; return cclose(RF.get(run(ds, cfg).points[0][0], 1, 0, 0), [1, 0], 1e-12); })());
  check('Port 2 kurzgeschlossen: Zin = Z', cclose(zin({ type: 'short' }), Z, 1e-10));
  check('Port 2 angepasst: Zin = Z + 50 Ω', cclose(zin({ type: 'match' }), C.add(Z, [50, 0]), 1e-10));
  check('Port 2 mit 25 Ω: Zin = Z + 25 Ω', cclose(zin({ type: 'resistor', r: 25, x: 0, l: 0, c: 0 }), C.add(Z, [25, 0]), 1e-10));
  check('Port 2 mit 30 + j20 Ω', cclose(zin({ type: 'complex', r: 30, x: 20, l: 0, c: 0 }), C.add(Z, [30, 20]), 1e-10));
  const w = 2 * Math.PI * 1e7;
  check('Port 2 mit RLC-Serie (10 Ω, 1 µH, 1 nF) bei 10 MHz', cclose(zin({ type: 'series', r: 10, x: 0, l: 1e-6, c: 1e-9 }), C.add(Z, [10, w * 1e-6 - 1 / (w * 1e-9)]), 1e-10));
  const yp = [1 / 200, w * 2e-12 - 1 / (w * 5e-6)];
  check('Port 2 mit RLC-Parallel (200 Ω, 5 µH, 2 pF) bei 10 MHz', cclose(zin({ type: 'parallel', r: 200, x: 0, l: 5e-6, c: 2e-12 }), C.add(Z, C.div([1, 0], yp)), 1e-10));
  const ds3 = dataset(3, [1e6], () => randomS(3));
  const j = run(ds3, { loads: [{ type: 'active' }, { type: 'active' }, { type: 'join', to: 1 }], pairs: [], ref: null });
  check('Verbundene Ports ergeben ein gültiges reduziertes Netzwerk', !!j.points[0][0] && j.layout.active.length === 2 && j.points[0][0].every(Number.isFinite));
}

console.log('Port-Renormierung');
{
  const Z = [80, -35], s50 = seriesS(Z, 50), s75 = RF.changeRef(s50, [50, 50], [75, 75]);
  check('50 Ω → 75 Ω stimmt mit der direkten Rechnung überein', cclose(RF.get(s75, 2, 0, 0), RF.get(seriesS(Z, 75), 2, 0, 0), 1e-11) && cclose(RF.get(s75, 2, 1, 0), RF.get(seriesS(Z, 75), 2, 1, 0), 1e-11));
  const back = RF.changeRef(s75, [75, 75], [50, 50]);
  check('Hin und zurück ergibt die Ausgangsmatrix', back.every((v, k) => close(v, s50[k], 1e-11, 1e-13)));
  const s4 = randomS(4), odd = RF.changeRef(s4, [50, 50, 50, 50], [10, 75, 100, 33]), again = RF.changeRef(odd, [10, 75, 100, 33], [50, 50, 50, 50]);
  check('Ungleiche Referenzen je Port, 4 Ports, hin und zurück', again.every((v, k) => close(v, s4[k], 1e-10, 1e-12)));
  const z1 = RF.toZY(s4, [50, 50, 50, 50], 'Z'), z2 = RF.toZY(odd, [10, 75, 100, 33], 'Z');
  check('Die Z-Matrix hängt nicht von der Referenz ab', z1.every((v, k) => close(v, z2[k], 1e-8, 1e-9)));
  const y1 = RF.toZY(s4, [50, 50, 50, 50], 'Y');
  const prod = matrixOf(4, (i, j) => { let acc = [0, 0]; for (let k = 0; k < 4; k++) acc = C.add(acc, C.mul(RF.get(z1, 4, i, k), RF.get(y1, 4, k, j))); return acc; });
  check('Z · Y = Einheitsmatrix', RF.indices(4).every(i => RF.indices(4).every(j => cclose(RF.get(prod, 4, i, j), [i === j ? 1 : 0, 0], 0, 1e-9))));
}

console.log('Mixed Mode mit 4, 5, 6 und 8 Ports, alle Modenkombinationen');
{
  const R2 = Math.SQRT1_2;
  for (const [n, pairs] of [[4, [[0, 1], [2, 3]]], [4, [[0, 2], [1, 3]]], [5, [[0, 1], [2, 3]]], [6, [[0, 1], [2, 3], [4, 5]]], [8, [[0, 4], [1, 5], [2, 6], [3, 7]]]]) {
    const S = randomS(n), ds = dataset(n, [1e6], () => S);
    const cfg = { loads: active(n), pairs: pairs.map(([p, q], i) => ({ id: i + 1, p, q })), ref: null };
    const { layout, points } = run(ds, cfg), mm = points[0][1], size = layout.mmModes.length;
    // explicit modal vectors: D = (a_p − a_q)/√2, C = (a_p + a_q)/√2, unpaired ports stay single ended
    const vec = mode => { const v = Array(n).fill(0); if (mode.type === 'P') v[mode.port] = 1; else { v[mode.pair.p] = R2; v[mode.pair.q] = mode.type === 'D' ? -R2 : R2; } return v; };
    let worst = 0, kinds = new Set();
    layout.mmModes.forEach((row, r) => layout.mmModes.forEach((col, c) => {
      const a = vec(row), b = vec(col); let acc = [0, 0];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (a[i] && b[j]) acc = C.add(acc, C.s(RF.get(S, n, i, j), a[i] * b[j]));
      const got = RF.get(mm, size, r, c);
      worst = Math.max(worst, Math.hypot(got[0] - acc[0], got[1] - acc[1]));
      kinds.add(row.type + col.type);
    }));
    check(n + ' Ports, Paare ' + pairs.map(p => '(' + (p[0] + 1) + ',' + (p[1] + 1) + ')').join('') + ': ' + size + '×' + size + ' Moden, Kombinationen ' + [...kinds].sort().join(' '), worst < 1e-13, 'größte Abweichung ' + worst.toExponential(1));
    check('  Modenreferenzen: Z_D = 2·Z₀, Z_C = Z₀/2', layout.mmModes.every(m => m.type === 'D' ? m.ref === 100 : m.type === 'C' ? m.ref === 25 : m.ref === 50));
  }
  const S = randomS(4), ds = dataset(4, [1e6], () => S);
  const a = run(ds, { loads: active(4), pairs: [{ id: 1, p: 0, q: 1 }, { id: 2, p: 2, q: 3 }], ref: null }), b = run(ds, { loads: active(4), pairs: [{ id: 1, p: 0, q: 1 }, { id: 2, p: 3, q: 2 }], ref: null });
  const at = (r, key) => r.layout.mmModes.findIndex(m => m.key === key);
  check('Vertauschte Polarität eines Paars dreht das Vorzeichen von Sdd21, nicht von Scc21', cclose(RF.get(a.points[0][1], 4, at(a, 'D2'), at(a, 'D1')), C.s(RF.get(b.points[0][1], 4, at(b, 'D2'), at(b, 'D1')), -1), 1e-12) && cclose(RF.get(a.points[0][1], 4, at(a, 'C2'), at(a, 'C1')), RF.get(b.points[0][1], 4, at(b, 'C2'), at(b, 'C1')), 1e-12));
  const custom = run(ds, { loads: active(4), pairs: [{ id: 1, p: 0, q: 1, zd: 0.1, zc: 100 }, { id: 2, p: 2, q: 3 }], ref: null });
  const viaRef = RF.changeRef(a.points[0][1], a.layout.mmRefs, custom.layout.mmRefs);
  check('Eigene Modenimpedanzen (0,1 Ω / 100 Ω) entsprechen einer Renormierung der Mixed-Mode-Matrix', custom.points[0][1].every((v, k) => close(v, viaRef[k], 1e-9, 1e-12)));
  const term = run(ds, { loads: [{ type: 'active' }, { type: 'active' }, { type: 'match' }, { type: 'open' }], pairs: [{ id: 1, p: 0, q: 1 }], ref: null });
  check('Mixed Mode mit abgeschlossenen übrigen Ports (Z₀ und offen)', term.layout.mmModes.length === 2 && term.points[0][1].every(Number.isFinite));
}

console.log('Impedanzen');
{
  const Z = [12, 340];
  check('Reflexion: Zin = Z₀(1 + Γ)/(1 − Γ)', cclose(RF.reflection(C.div(C.sub(Z, [50, 0]), C.add(Z, [50, 0])), 50), Z, 1e-11));
  check('Serien-Fixture: Z = 2Z₀(1/S21 − 1)', cclose(RF.transmission(RF.get(seriesS(Z), 2, 1, 0), 50, 'series'), Z, 1e-11));
  check('Shunt-Fixture: Z = (Z₀/2)·S21/(1 − S21)', cclose(RF.transmission(RF.get(shuntS(Z), 2, 1, 0), 50, 'shunt'), Z, 1e-11));
  check('Singuläre Fälle geben „kein Wert“ statt NaN/∞: S21 = 0, S21 = 1, Γ = 1', RF.transmission([0, 0], 50, 'series') === null && RF.transmission([1, 0], 50, 'shunt') === null && RF.reflection([1, 0], 50) === null);
  // T network: Z11 = Za + Zc, Z21 = Zc
  const t = netlist('.subckt T 1 2\nR1 1 3 30\nR2 3 2 70\nR3 3 0 120\n.ends\n')({ f1: 1e5, f2: 1e8, n: 11 });
  const z = RF.toZY(t.samples[3], [50, 50], 'Z');
  check('Z-Matrix eines T-Glieds: Z11 = 150 Ω, Z22 = 190 Ω, Z21 = 120 Ω', cclose(RF.get(z, 2, 0, 0), [150, 0], 1e-7) && cclose(RF.get(z, 2, 1, 1), [190, 0], 1e-7) && cclose(RF.get(z, 2, 1, 0), [120, 0], 1e-7));
  const y = RF.toZY(netlist('.subckt PI 1 2\nR1 1 0 100\nR2 1 2 50\nR3 2 0 200\n.ends\n')({ f1: 1e5, f2: 1e8, n: 11 }).samples[3], [50, 50], 'Y');
  check('Y-Matrix eines π-Glieds: Y11 = 30 mS, Y21 = −20 mS', cclose(RF.get(y, 2, 0, 0), [0.03, 0], 1e-7) && cclose(RF.get(y, 2, 1, 0), [-0.02, 0], 1e-7));
}

console.log('CISPR 17');
{
  const Z = [35, 900];
  const a = RF.cispr(seriesS(Z), 50, 'series'), b = RF.cispr(shuntS(Z), 50, 'shunt');
  check('Zweitor · Serie liefert die Serienimpedanz', cclose(a.z, Z, 1e-10));
  check('Zweitor · Shunt liefert die Querimpedanz', cclose(b.z, Z, 1e-10));
  check('Symmetrieabweichungen eines symmetrischen Prüflings sind null', a.reflectionDelta < 1e-15 && a.transmissionDelta < 1e-15);
  // CMC: two coupled windings 1→3 and 2→4. CM: windings in parallel, DM: in series opposing.
  const L = 1e-3, k = 0.985, M = k * L;
  const cmc = netlist('.subckt CMC 1 2 3 4\nL1 1 3 ' + L + '\nL2 2 4 ' + L + '\nK1 L1 L2 ' + k + '\n.ends\n')({ f1: 1e3, f2: 1e7, n: 41 });
  const cfg = { loads: active(4), pairs: [{ id: 1, p: 0, q: 1 }, { id: 2, p: 2, q: 3 }], ref: null };
  const { layout, points } = run(cmc, cfg), at = key => layout.mmModes.findIndex(m => m.key === key);
  let worstC = 0, worstD = 0;
  cmc.freq.forEach((f, i) => {
    const w = 2 * Math.PI * f, mm = points[i][1];
    const cm = RF.cispr(RF.submatrix(mm, 4, [at('C1'), at('C2')]), 25, 'series').z, dm = RF.cispr(RF.submatrix(mm, 4, [at('D1'), at('D2')]), 100, 'series').z;
    worstC = Math.max(worstC, Math.hypot(cm[0], cm[1] - w * (L + M) / 2) / (w * (L + M) / 2));
    worstD = Math.max(worstD, Math.hypot(dm[0], dm[1] - 2 * w * (L - M)) / (2 * w * (L - M)));
  });
  check('Vierport · Z_CM = jω(L + M)/2 über 4 Dekaden', worstC < 1e-6, 'größte relative Abweichung ' + worstC.toExponential(1));
  check('Vierport · Z_DM = j2ω(L − M) über 4 Dekaden', worstD < 1e-6, 'größte relative Abweichung ' + worstD.toExponential(1));
}

console.log('CMC-Fit');
{
  const p = { lcm: 220e-6, ldm: 2.5e-6, cw: 1.9e-12, cg: 0.4e-12, ct: 3e-12, rcm: 6000, rdm: 900 };
  // The example stores its terminals as IN+ = P1, OUT+ = P2, IN− = P3, OUT− = P4; the modal analysis wants IN+, IN−, OUT+, OUT−.
  const demo = RF.demoNetwork(4), nat = Array.from(demo.freq, (f, i) => RF.cmcNatural(RF.submatrix(demo.samples[i], 4, [0, 2, 1, 3]), demo.refs, f));
  const fit = RF.fitCMC(demo.freq, nat, 1e6, 100e6);
  check('Demo-CMC: L+M 210 µH, L−M 2,4 µH, Cw 1,8 pF, Cg 0,32 pF, Ct 2,8 pF', close(fit.lcm, 210e-6, 2e-3) && close(fit.ldm, 2.4e-6, 2e-3) && close(fit.cw, 1.8e-12, 2e-3) && close(fit.cg, 0.32e-12, 2e-3) && close(fit.ctH, 2.8e-12, 2e-2) && close(fit.ctD, 2.8e-12, 2e-2),
    [fit.lcm * 1e6, fit.ldm * 1e6, fit.cw * 1e12, fit.cg * 1e12, fit.ctH * 1e12].map(v => v.toPrecision(4)).join(' · '));
  check('Fit-Fehler und Modenkopplung klein', fit.hError < 1e-6 && fit.dError < 1e-6 && fit.coupling < 1e-9);
  // the same quantities from a SPICE netlist: windings 1→3, 2→4, Cw between the windings on each side, Cg to ground, Ct across each winding
  const L = 1e-3, k = 0.99, Cw = 2e-12, Cg = 0.5e-12, Ct = 4e-12;
  const ds = netlist('.subckt CMC 1 2 3 4\nL1 1 3 ' + L + '\nL2 2 4 ' + L + '\nK1 L1 L2 ' + k + '\nCw1 1 2 ' + Cw + '\nCw2 3 4 ' + Cw + '\nCg1 1 0 ' + Cg + '\nCg2 2 0 ' + Cg + '\nCg3 3 0 ' + Cg + '\nCg4 4 0 ' + Cg + '\nCt1 1 3 ' + Ct + '\nCt2 2 4 ' + Ct + '\n.ends\n')({ f1: 1e4, f2: 2e6, n: 201 });
  const n2 = Array.from(ds.freq, (f, i) => RF.cmcNatural(ds.samples[i], ds.refs, f)), f2 = RF.fitCMC(ds.freq, n2, 2e4, 1e6);
  check('SPICE-CMC: Cw, Cg, L+M = L(1+k), L−M = L(1−k)', close(f2.cw, Cw, 1e-3) && close(f2.cg, Cg, 5e-3) && close(f2.lcm, L * (1 + k), 5e-3) && close(f2.ldm, L * (1 - k), 5e-3) && close(f2.k, k, 1e-3),
    'Cw ' + (f2.cw * 1e12).toFixed(3) + ' pF · Cg ' + (f2.cg * 1e12).toFixed(3) + ' pF · L+M ' + (f2.lcm * 1e3).toFixed(4) + ' mH · L−M ' + (f2.ldm * 1e6).toFixed(3) + ' µH · k ' + f2.k.toFixed(4));
  const verdict = Magnetic.analyze(ds).verdict;
  check('Physik-Erkennung: CMC ist der wahrscheinlichste Kandidat (ideales, verlustfreies Modell bleibt „unklar“)', verdict.ranked[0]?.category === 'cmc', verdict.ranked.map(r => r.category + ' ' + r.score).join(' · ') + ' · ' + verdict.level);
}

console.log('Übertrager-Fit');
{
  const L1 = 350e-6, ratio = 2, L2 = L1 * ratio * ratio, k = 0.997, Cww = 12e-12;
  const ds = netlist('.subckt TR 1 2 3 4\nL1 1 2 ' + L1 + '\nL2 3 4 ' + L2 + '\nK1 L1 L2 ' + k + '\nR1 1 5 1e9\nR2 3 5 1e9\nCa 1 3 ' + Cww / 2 + '\nCb 2 4 ' + Cww / 2 + '\n.ends\n')({ f1: 1e4, f2: 3e7, n: 241 });
  const cfg = { loads: active(4), pairs: [{ id: 1, p: 0, q: 1 }, { id: 2, p: 2, q: 3 }], ref: null };
  const { layout, points } = run(ds, cfg), at = key => layout.mmModes.findIndex(m => m.key === key);
  const d = [at('D1'), at('D2')], c = [at('C1'), at('C2')];
  const pts = Array.from(ds.freq, (f, i) => RF.transformerPoint(RF.submatrix(points[i][1], 4, d), [100, 100], RF.submatrix(points[i][1], 4, c), [25, 25], f));
  const t = RF.analyzeTransformer(ds.freq, pts, 100e3);
  check('OCL = 350 µH, n = 2, |k| = 0,997', close(t.ocl, L1, 5e-3) && close(t.n, ratio, 5e-3) && close(Math.abs(t.k), k, 1e-3), (t.ocl * 1e6).toFixed(2) + ' µH · n ' + t.n.toFixed(4) + ' · k ' + t.k.toFixed(5));
  check('Streuinduktivität Lσ = L1(1 − k²) = ' + (L1 * (1 - k * k) * 1e6).toFixed(3) + ' µH', close(t.leak, L1 * (1 - k * k), 3e-2), (t.leak * 1e6).toFixed(3) + ' µH');
  check('Koppelkapazität Cww = 12 pF', close(t.cww, Cww, 2e-2), (t.cww * 1e12).toFixed(3) + ' pF');
  const scc = RF.abs(RF.get(points[0][1], 4, at('C2'), at('C1'))), sdd = RF.abs(RF.get(points[0][1], 4, at('D2'), at('D1')));
  check('Erkennung: Übertrager trennt den Gleichtakt', RF.classify4(ds.freq, scc, sdd).type === 'transformer', '|Scc21| = ' + scc.toExponential(1));
}

console.log('Zweipolmodelle');
{
  const freq = logf(1e4, 3e9, 301), w = f => 2 * Math.PI * f;
  const L = 10e-6, Cp = 5e-12, R = 0.2, Rp = 30e3;
  const zl = Array.from(freq, f => C.add([R, 0], C.div([1, 0], C.add(C.add(C.div([1, 0], [0, w(f) * L]), [0, w(f) * Cp]), [1 / Rp, 0]))));
  const el = RF.analyzeElement(freq, zl, 'series');
  check('Induktivität: L = 10 µH, SRF = 22,5 MHz, C_p = 5 pF, R_DC = 0,2 Ω', close(el.l, L, 1e-2) && close(el.fsrf, 1 / (2 * Math.PI * Math.sqrt(L * Cp)), 1e-2) && close(el.cp, Cp, 3e-2) && close(el.rdc, R, 2e-2),
    (el.l * 1e6).toFixed(3) + ' µH · ' + (el.fsrf / 1e6).toFixed(2) + ' MHz · ' + (el.cp * 1e12).toFixed(2) + ' pF');
  check('L(f) trägt oberhalb der Resonanz ein negatives Vorzeichen (nicht ausgeblendet)', Array.from(el.series.l).filter((v, i) => freq[i] > 2 * el.fsrf).every(v => v < 0));
  const Cc = 100e-9, ESR = 0.02, ESL = 0.8e-9, zc = Array.from(freq, f => [ESR, w(f) * ESL - 1 / (w(f) * Cc)]);
  const ec = RF.analyzeElement(freq, zc, 'shunt');
  check('Kondensator: C = 100 nF, ESL = 0,8 nH, ESR = 20 mΩ, SRF = 17,8 MHz', close(ec.c, Cc, 1e-2) && close(ec.esl, ESL, 3e-2) && close(ec.esr, ESR, 1e-6) && close(ec.fsrf, 1 / (2 * Math.PI * Math.sqrt(ESL * Cc)), 1e-2));
  check('C(f) und ESL(f) tragen ihr Vorzeichen über den ganzen Bereich, ohne Lücken', ec.series.c.every(Number.isFinite) && ec.series.l.every(Number.isFinite) && ec.series.l[0] < 0 && ec.series.c.at(-1) < 0);
  const lf = RF.lcFit(freq, Float64Array.from(zl, z => z[1]), el.fsrf / 2);
  check('lcFit: ω/X = 1/L − ω²C liefert L und C', close(lf.l, L, 1e-3) && close(lf.c, Cp, 2e-2), (lf.l * 1e6).toFixed(4) + ' µH · ' + (lf.c * 1e12).toFixed(3) + ' pF');
  // resonant model: fit, export as SPICE, read back, compare complex impedance (magnitude and phase)
  const model = el.model;
  check('fitResonant: Modell bis zur Resonanz mit kleinem Fehler', !!model && model.err < 0.05 && close(model.tanks[0].l, L, 3e-2) && close(model.f1, el.fsrf, 3e-2), model ? 'Fehler ' + (100 * model.err).toFixed(2) + ' % · L₁ ' + (model.tanks[0].l * 1e6).toFixed(3) + ' µH' : 'kein Modell');
  const lib = Spice.parse(RF.resonantNetlist(model, 'REF_ESB'), 'esb.lib'), back = Spice.dataset(lib, lib.tops[0], { f1: 1e4, f2: model.fMax, n: 121 });
  let worst = 0;
  back.freq.forEach((f, i) => { const z = RF.transmission(RF.get(back.samples[i], 2, 1, 0), 50, 'series'), m = RF.tankImpedance(model, f); worst = Math.max(worst, Math.hypot(z[0] - m[0], z[1] - m[1]) / Math.hypot(...m)); });
  check('SPICE-Export und Reimport: komplexe Impedanz des Modells bleibt erhalten', worst < 1e-4, 'größte relative Abweichung ' + worst.toExponential(1));
  const two = Magnetic.analyze(dataset(2, freq, (f, i) => seriesS(zl[i])));
  check('Physik-Erkennung der Referenzdrossel: Serien-Element, induktiv', two.topology === 'series' && ['inductor', 'coreless', 'ferrite-inductor'].includes(two.verdict.category), two.verdict.category + ' · ' + two.verdict.level);
  const capD = Magnetic.analyze(dataset(2, freq, (f, i) => seriesS(zc[i])));
  check('Physik-Erkennung: Kondensator bleibt auch in der Serien-Fixture ein Kondensator', capD.topology === 'series' && capD.verdict.category === 'capacitor', capD.verdict.category);
}

console.log('Bearbeitbare Modelle: Parameter, feste Werte, Fitfenster');
{
  const freq = logf(1e4, 3e9, 301), w = f => 2 * Math.PI * f;
  const zl = Array.from(freq, f => C.add([0.2, 0], C.div([1, 0], C.add(C.add(C.div([1, 0], [0, w(f) * 1e-5]), [0, w(f) * 5e-12]), [1 / 3e4, 0]))));
  const auto = { type: 'tanks', ...RF.fitResonant(freq, zl) };
  check('Parameterliste des Drosselmodells: R₀, L₁, C₁, R₁', RF.modelParams(auto).map(p => p.key).join(' ') === 'r0 l1 c1 r1');
  const wrong = RF.modelWith(auto, { l1: 2e-5 }), q = RF.modelQuality(freq, zl, wrong, [1e4, 1e8]);
  check('Verstellter Wert: Abweichung in Betrag und Phase wird beziffert', q.err > 3 && q.phase > 5 && q.points > 100, q.err.toFixed(2) + ' dB · ' + q.phase.toFixed(1) + '°');
  const held = RF.fitModel(freq, zl, wrong, { fixed: ['l1'], band: [1e4, 1e8] });
  check('Fester Parameter bleibt exakt stehen, die freien passen sich an', held.model.tanks[0].l === 2e-5 && held.err < q.err && close(held.model.tanks[0].c, 2.5e-12, 0.2), 'C₁ ' + (held.model.tanks[0].c * 1e12).toFixed(3) + ' pF · ' + held.err.toFixed(2) + ' dB');
  const free = RF.fitModel(freq, zl, wrong, { band: [1e4, 1e8] });
  check('Alle frei: komplexer Fit findet 10 µH, 5 pF, 0,2 Ω, 30 kΩ', close(free.model.tanks[0].l, 1e-5, 1e-3) && close(free.model.tanks[0].c, 5e-12, 1e-3) && close(free.model.r0, 0.2, 1e-2) && close(free.model.tanks[0].r, 3e4, 1e-2) && free.err < 1e-3 && free.phase < 1e-2);
  const windowed = RF.fitModel(freq, zl, RF.modelWith(auto, { l1: 1.4e-5 }), { fixed: ['c1', 'r1'], band: [1e5, 5e6] });
  check('Fitfenster: nur Punkte im Fenster zählen', windowed.points === Array.from(freq).filter(f => f >= 1e5 && f <= 5e6).length && close(windowed.model.tanks[0].l, 1e-5, 1e-2), windowed.points + ' Punkte');
  check('Zu wenige Punkte im Fenster: kein Scheinergebnis', RF.fitModel(freq, zl, auto, { band: [1e6, 1.05e6] }) === null);
  let negative = 0;
  for (let t = 0; t < 40; t++) {
    const start = RF.modelWith(auto, Object.fromEntries(RF.modelParams(auto).map(p => [p.key, p.value * 10 ** (2 * rnd())])));
    const r = RF.fitModel(freq, zl, start, { fixed: t % 3 ? [] : ['r0'], band: [1e4, 10 ** (6 + 3 * (rnd() + 0.5))] });
    if (r && RF.modelParams(r.model).some(p => !(p.value > 0) || !Number.isFinite(p.value))) negative++;
  }
  check('40 Fits aus zufälligen Startwerten: nie ein negativer oder nicht endlicher Parameter', negative === 0);
  check('Ungültige Eingaben (negativ, null, NaN) werden nicht ins Modell übernommen', RF.modelWith(auto, { l1: -1, c1: 0, r0: NaN }).tanks[0].l === auto.tanks[0].l && RF.modelWith(auto, { r0: NaN }).r0 === auto.r0);
  const zc = Array.from(freq, f => [0.02, w(f) * 0.8e-9 - 1 / (w(f) * 1e-7)]), cap = RF.fitCapacitor(freq, zc);
  check('Kondensatormodell ESR + ESL + C: 20 mΩ, 0,8 nH, 100 nF', close(cap.c, 1e-7, 1e-4) && close(cap.esr, 0.02, 1e-4) && close(cap.esl, 0.8e-9, 1e-4) && RF.modelQuality(freq, zc, cap).err < 1e-6);
  const noisy = zc.map((z, i) => [z[0] * (1 + 0.02 * Math.sin(i * 1.7)), z[1] * (1 + 0.02 * Math.cos(i * 2.3))]), capN = RF.fitCapacitor(freq, noisy);
  check('…auch mit 2 % Messabweichung innerhalb 3 %', close(capN.c, 1e-7, 0.03) && close(capN.esl, 0.8e-9, 0.03) && close(capN.esr, 0.02, 0.05), [capN.c * 1e9, capN.esl * 1e9, capN.esr * 1e3].map(v => v.toFixed(3)).join(' · '));
  const lib = Spice.parse(RF.modelNetlist(cap, 'CAP'), 'c.lib'), back = Spice.dataset(lib, lib.tops[0], { f1: 1e4, f2: 3e9, n: 61 });
  let worst = 0;
  back.freq.forEach((f, i) => { const z = RF.transmission(RF.get(back.samples[i], 2, 1, 0), 50, 'series'), m = RF.modelImpedance(cap, f); worst = Math.max(worst, Math.hypot(z[0] - m[0], z[1] - m[1]) / Math.hypot(...m)); });
  check('Kondensator: SPICE-Export und Reimport erhalten die komplexe Impedanz', worst < 1e-5, 'größte relative Abweichung ' + worst.toExponential(1));
  check('Kein Modell ohne kapazitiven Bereich', RF.fitCapacitor(freq, zl.map(z => [z[0], Math.abs(z[1])])) === null);
}

console.log('Touchstone-Export und Wiedereinlesen');
{
  const freq = logf(1e5, 1e9, 31), ds = dataset(4, freq, () => randomS(4));
  const cfg = { loads: active(4), pairs: [{ id: 1, p: 0, q: 1 }, { id: 2, p: 2, q: 3 }], ref: null }, { layout, points } = run(ds, cfg);
  const network = { layout, se: points.map(p => p[0]), mm: points.map(p => p[1]), gaps: 0 };
  for (const basis of ['se', 'mm']) {
    // A mixed-mode file carries [Mixed-Mode Order]; the import turns it back into the single-ended matrix and keeps the pairs.
    const again = RF.parseTouchstone(RF.exportTouchstone(ds, network, basis), 'x.s4p');
    let worst = 0;
    again.samples.forEach((s, i) => s.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - network.se[i][k])); }));
    check('Export ' + (basis === 'se' ? 'Single Ended' : 'Mixed Mode') + ' → Import: gleiche Werte', again.n === 4 && again.freq.length === 31 && worst < 1e-9, 'größte Abweichung ' + worst.toExponential(1));
    if (basis === 'mm') check('Mixed-Mode-Datei bringt ihre Paare (1,2)(3,4) mit', JSON.stringify(again.sourcePairs) === JSON.stringify([{ p: 0, q: 1 }, { p: 2, q: 3 }]));
  }
}

console.log('Numerische Robustheit');
{
  const bad = dataset(2, [1e6, 2e6], (f, i) => i ? randomS(2) : Float64Array.from({ length: 8 }, () => NaN));
  const r = run(bad, { loads: [{ type: 'active' }, { type: 'short' }], pairs: [], ref: null });
  check('Ein ungültiger Messpunkt erzeugt eine Lücke, keine NaN-Lawine', (r.points[0][0] === null || !r.points[0][0].every(Number.isFinite)) && r.points[1][0].every(Number.isFinite));
  const singular = matrixOf(2, (i, j) => [1, 0]);
  check('Singuläre Matrix: Z-Umrechnung meldet „kein Wert“', RF.toZY(matrixOf(2, (i, j) => i === j ? [1, 0] : [0, 0]), [50, 50], 'Z') === null && RF.solve !== undefined);
  check('Zu kurzes Fit-Band wird erkannt statt falsch gefittet', RF.fitCMC(new Float64Array([1, 2, 3]), [null, null, null], 0, 10).count === 0);
  check('fitResonant ohne Daten gibt kein Modell', RF.fitResonant(new Float64Array(5), [null, null, null, null, null]) === null);
  void singular;
}

console.log('Vergleich mit dem Rechenkern der veröffentlichten Fassung (Branch main)');
{
  let old = null;
  try {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spa-main-')), 'index.html');
    fs.writeFileSync(file, execFileSync('git', ['-C', path.dirname(new URL('.', import.meta.url).pathname), 'show', (process.env.SPA_OLD_REF || 'origin/main') + ':index.html'], { maxBuffer: 64 * 1024 * 1024 }));
    old = load(file);
  } catch { old = null; }
  if (!old) check('Alte Fassung aus Git lesbar', false, 'git show origin/main:index.html fehlgeschlagen');
  else {
    let diff = 0, cases = 0;
    const same = (a, b) => (a === null && b === null) || (!!a && !!b && a.length === b.length && a.every((v, k) => Object.is(v, b[k]) || v === b[k]));
    for (let t = 0; t < 60; t++) {
      const n = [2, 3, 4, 4, 6, 8][t % 6], S = Array.from({ length: 4 }, () => randomS(n)), ds = dataset(n, [1e5, 1e6, 1e7, 1e8], (f, i) => S[i], RF.indices(n).map(i => [50, 50, 75, 100][(i + t) % 4]));
      const loads = RF.indices(n).map(i => i < 2 ? { type: 'active' } : [{ type: 'active' }, { type: 'match' }, { type: 'open' }, { type: 'short' }, { type: 'resistor', r: 33, x: 0, l: 0, c: 0 }, { type: 'series', r: 5, x: 0, l: 1e-7, c: 1e-10 }][(i + t) % 6]);
      const act = RF.indices(n).filter(i => loads[i].type === 'active'), pairs = [];
      for (let i = 0; i + 1 < act.length && pairs.length < (t % 3); i += 2) pairs.push({ id: pairs.length + 1, p: act[i], q: act[i + 1], ...(t % 5 === 0 ? { zd: 0.1, zc: 100 } : {}) });
      const cfg = { loads, pairs, ref: t % 4 === 0 ? 60 : null };
      const a = RF.prepareNetwork(ds, cfg), b = old.RF.prepareNetwork(ds, cfg);
      for (let i = 0; i < 4; i++) { const x = RF.processPoint(ds, cfg, a, i), y = old.RF.processPoint(ds, cfg, b, i); cases++; if (!same(x[0], y[0]) || !same(x[1], y[1])) diff++; }
    }
    check('Netzwerkberechnung (Lasten, Renormierung, Mixed Mode) in ' + cases + ' Fällen bitgleich mit main', diff === 0, diff + ' Abweichungen');
    const demo = RF.demoNetwork(8), demoOld = old.RF.demoNetwork(8);
    check('Beispielnetzwerk bitgleich', demo.samples.every((s, i) => same(s, demoOld.samples[i])));
    const nat = (R, d) => Array.from(d.freq, (f, i) => R.cmcNatural(R.submatrix(d.samples[i], 4, [0, 2, 1, 3]), [50, 50, 50, 50], f));
    const d4 = RF.demoNetwork(4), fa = RF.fitCMC(d4.freq, nat(RF, d4), 1e6, 1e8), fb = old.RF.fitCMC(d4.freq, nat(old.RF, d4), 1e6, 1e8);
    check('CMC-Fit bitgleich', JSON.stringify(fa) === JSON.stringify(fb));
    const freq = logf(1e4, 3e9, 301), w = f => 2 * Math.PI * f, zl = Array.from(freq, f => C.add([0.2, 0], C.div([1, 0], C.add(C.add(C.div([1, 0], [0, w(f) * 1e-5]), [0, w(f) * 5e-12]), [1 / 3e4, 0]))));
    const strip = r => JSON.stringify({ ...r, series: undefined });
    check('Zweipol-Kennwerte (L, SRF, C_p, Modell) bitgleich', strip(RF.analyzeElement(freq, zl, 'series')) === strip(old.RF.analyzeElement(freq, zl, 'series')));
    const zc = Array.from(freq, f => [0.02, w(f) * 0.8e-9 - 1 / (w(f) * 1e-7)]);
    check('Kondensator-Kennwerte (C, ESL, ESR, SRF) bitgleich', strip(RF.analyzeElement(freq, zc, 'shunt')) === strip(old.RF.analyzeElement(freq, zc, 'shunt')));
    const lib = 'x.lib', text = '.subckt A 1 2 3 4\nL1 1 3 1m\nL2 2 4 1m\nK1 L1 L2 0.98\nC1 1 2 2p\nR1 3 4 1k\n.ends\n';
    const sa = Spice.dataset(Spice.parse(text, lib), Spice.parse(text, lib).tops[0], { f1: 1e4, f2: 1e8, n: 41 }), sb = old.Spice.dataset(old.Spice.parse(text, lib), old.Spice.parse(text, lib).tops[0], { f1: 1e4, f2: 1e8, n: 41 });
    check('SPICE-Simulation bitgleich', sa.samples.every((s, i) => same(s, sb.samples[i])));
    check('Physik-Erkennung bitgleich', JSON.stringify(Magnetic.analyze(sa)) === JSON.stringify(old.Magnetic.analyze(sb)));
  }
}

console.log((fail ? 'FAIL' : 'PASS') + ' · E · RF-Mathematik · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
