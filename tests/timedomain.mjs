// Time domain and eye diagram (block td-core) against analytic cases. The test data are written here, not taken from the app.
//   Reference line: |S21| = 0.8, delay 0.4 ns, 41 log points 10 kHz … 10 GHz (sparse: plain unwrapping fails at the top).
//   RC low pass τ = 100 ps: step 1 − e^(−t/τ); NRZ eye sampled at the end of the bit: 2A·(1 − 2e^(−T/τ)).
//   Gaussian edge: 10–90 % rise time; TDR: Γ = 0.2 at 50 Ω is 75 Ω; PRBS: all words exactly once.
import { load } from './load.mjs';
import { logf } from './connector-fixture.mjs';

const { RF, TD } = load();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
const section = name => console.log(name);
const ps = v => (v * 1e12).toFixed(2) + ' ps';

section('Laufzeit und Phasenentfaltung');
const fr = logf(1e4, 1e10, 41), line = fr.map(f => { const p = -2 * Math.PI * f * 0.4e-9; return [0.8 * Math.cos(p), 0.8 * Math.sin(p)]; });
const gd = TD.groupDelay(fr, line);
check('Gruppenlaufzeit 0,4 ns an allen 41 Punkten (dünn, logarithmisch)', Array.from(gd.tau).every(t => Math.abs(t - 0.4e-9) < 1e-15), 'geführte Schritte ' + gd.guided + ', größter Schritt ' + gd.maxStep.toFixed(2) + ' rad');
check('… die geführte Entfaltung wird gemeldet (Phasenschritt > π)', gd.guided > 0 && gd.maxStep > Math.PI);
{
  let p = Math.atan2(line[0][1], line[0][0]); const out = [p];
  for (let i = 1; i < line.length; i++) { let d = Math.atan2(line[i][1], line[i][0]) - p; d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; p += d; out.push(p); }
  const tauTop = -(out.at(-1) - out.at(-2)) / (2 * Math.PI * (fr.at(-1) - fr.at(-2)));
  check('Gegenprobe: einfache Entfaltung liefert oben eine falsche Laufzeit', Math.abs(tauTop - 0.4e-9) > 1e-11, ps(tauTop));
}
// A filter edge (high pass) must not be mistaken for a delay: no guided steps for a first-order high pass on a log grid.
{
  const fh = logf(1e3, 1e9, 61), hp = fh.map(f => { const x = f / 1e5; return [x * x / (1 + x * x), x / (1 + x * x)]; });
  check('Hochpass 1. Ordnung: keine geführten Schritte (Phase ist keine Laufzeit)', TD.groupDelay(fh, hp).guided === 0);
}
check('Abtastung erkannt: logarithmisch / linear', TD.sampling(fr).kind === 'log' && TD.sampling(Array.from({ length: 50 }, (_, k) => 1e6 + k * 1e6)).kind === 'linear');

section('Sprung- und Impulsantwort');
{
  const r = TD.responses(TD.resample(fr, line, { points: 4096 }), { window: 'hann' }), e = TD.edge(r.step, r.dt, r.t0);
  check('Leitung: Sprung auf 0,8 mit 50 % bei 0,4 ns', Math.abs(e.final - 0.8) < 2e-3 && Math.abs(e.t50 - 0.4e-9) < 2e-12, 'Endwert ' + e.final.toFixed(4) + ', t50 ' + ps(e.t50));
  let sum = 0; for (const v of r.h) sum += v;
  check('Impulsantwort: Fläche = H(0) = 0,8', Math.abs(sum - 0.8) < 1e-9, sum.toFixed(6));
  check('Vor t = 0 liegt ein Achtel des Fensters (bandbegrenzter Sprung klappt nicht um)', Math.abs(r.t0 + r.span / 8) < r.dt * 4 && Math.abs(r.step[0]) < 1e-3);
}
const tau = 100e-12, fl = Array.from({ length: 2001 }, (_, k) => k * 25e6 + 1e6), rcH = f => { const w = 2 * Math.PI * f * tau; return [1 / (1 + w * w), -w / (1 + w * w)]; };
const rc = TD.responses(TD.resample(fl, fl.map(rcH), { points: 8192 }), { window: 'rect' });
{
  let err = 0; for (let n = 0; n < rc.step.length / 2; n++) { const t = rc.t0 + n * rc.dt; if (t > 50e-12 && t < 2e-9) err = Math.max(err, Math.abs(rc.step[n] - (1 - Math.exp(-t / tau)))); }
  check('RC-Tiefpass τ = 100 ps: Sprungantwort = 1 − e^(−t/τ) (ab 50 ps)', err < 2e-3, 'max. Abweichung ' + err.toExponential(1));
}
{
  const fi = Array.from({ length: 1001 }, (_, k) => k * 50e6 + 1e6), r = TD.responses(TD.resample(fi, fi.map(() => [1, 0]), { points: 8192 }), { window: 'rect', rise: 35e-12 }), e = TD.edge(r.step, r.dt, r.t0);
  check('Gauß-Flanke 35 ps (10–90 %) am idealen Durchgang', Math.abs(e.rise - 35e-12) < 0.5e-12, ps(e.rise));
  const t = TD.responses(TD.resample(fi, fi.map(() => [0.2, 0]), { points: 4096 }), { window: 'hann' }), z = TD.impedance(t.step, 50)[Math.round((1e-9 - t.t0) / t.dt)];
  check('TDR: Γ = 0,2 an 50 Ω ergibt 75 Ω', Math.abs(z - 75) < 0.01, z.toFixed(3) + ' Ω');
  const short = TD.responses(TD.resample(fi, fi.map(() => [-1, 0]), { points: 4096 }), { window: 'hann' }), zs = TD.impedance(short.step, 50)[Math.round((1e-9 - short.t0) / short.dt)];
  check('TDR: Kurzschluss (Γ = −1) ergibt 0 Ω', Math.abs(zs) < 0.01, zs.toFixed(4) + ' Ω');
}
{
  // DC sign from the extrapolated phase: an inverting thru (S21 = −0.5, short delay) settles at −0.5
  const fi = logf(1e6, 1e10, 201), inv = fi.map(f => { const p = Math.PI - 2 * Math.PI * f * 50e-12; return [0.5 * Math.cos(p), 0.5 * Math.sin(p)]; });
  const r = TD.responses(TD.resample(fi, inv, { points: 4096 }), { window: 'hann' }), e = TD.edge(r.step, r.dt, r.t0);
  check('Gleichanteil mit Vorzeichen: invertierender Durchgang endet bei −0,5', Math.abs(e.final + 0.5) < 2e-3, e.final.toFixed(4));
}

section('Augendiagramm');
{
  const fi = Array.from({ length: 1001 }, (_, k) => k * 50e6 + 1e6), r = TD.responses(TD.resample(fi, fi.map(() => [1, 0]), { points: 8192 }), { window: 'rect', rise: 10e-12 });
  const e = TD.eye(r.step, r.dt, { ui: 100e-12, amp: 0.5, order: 7 });
  check('Idealer Kanal, 10 Gbit/s, ±0,5 V: Augenhöhe 1 V, Breite ≈ 1 UI', Math.abs(e.best.height - 1) < 0.01 && e.width > 0.9, e.best.height.toFixed(4) + ' V, ' + e.width.toFixed(2) + ' UI');
  const half = TD.eye(TD.responses(TD.resample(fr, line, { points: 4096 }), { window: 'hann' }).step, TD.responses(TD.resample(fr, line, { points: 4096 }), { window: 'hann' }).dt, { ui: 500e-12, amp: 0.5, order: 7 });
  check('Leitung |S21| = 0,8 bei 2 Gbit/s: Augenhöhe 0,8 V', Math.abs(half.best.height - 0.8) < 0.01, half.best.height.toFixed(4) + ' V');
}
const ui = 100e-12;
{
  const e7 = TD.eye(rc.step, rc.dt, { ui, amp: 0.5, order: 7 }), e11 = TD.eye(rc.step, rc.dt, { ui, amp: 0.5, order: 11, s: 128 });
  check('RC: PRBS7-Auge ≥ Peak-Distortion (Pulsantwort länger als 7 UI)', e7.best.height >= e7.pda - 1e-9, e7.best.height.toFixed(5) + ' ≥ ' + e7.pda.toFixed(5) + ' V');
  check('RC: PRBS11-Auge = Peak-Distortion (alle 11-Bit-Muster, Rest < 2e-5)', Math.abs(e11.best.height - e11.pda) < 2e-4, e11.best.height.toFixed(5) + ' / ' + e11.pda.toFixed(5) + ' V');
}
{
  const fmax = 800e9, n = 4001, f8 = Array.from({ length: n }, (_, k) => (k + 0.02) * fmax / (n - 1));
  const r8 = TD.responses(TD.resample(f8, f8.map(rcH), { points: 8192 }), { window: 'rect', oversample: 2 }), e8 = TD.eye(r8.step, r8.dt, { ui, amp: 0.5, order: 11, s: 256 });
  const exact = 1 - 2 * Math.exp(-ui / tau);
  check('RC bis 800 GHz: Augenhöhe analytisch 2A·(1 − 2e^(−T/τ))', Math.abs(e8.best.height - exact) < 0.002, 'analytisch ' + exact.toFixed(4) + ' V, berechnet ' + e8.best.height.toFixed(4) + ' V');
}
for (const order of [7, 9, 11]) {
  const p = TD.prbs(order), N = p.length, words = new Set();
  for (let i = 0; i < N; i++) { let w = 0; for (let k = 0; k < order; k++) w = w * 2 + p[(i + k) % N]; words.add(w); }
  check('PRBS' + order + ': alle ' + N + ' Wörter ≠ 0 genau einmal', words.size === N && !words.has(0));
}
{
  const t0 = performance.now(), fi = logf(1e6, 20e9, 401), v = fi.map(f => [Math.cos(-2 * Math.PI * f * 1e-9), Math.sin(-2 * Math.PI * f * 1e-9)]);
  const r = TD.responses(TD.resample(fi, v, { points: 4096 }), { window: 'hann' }); TD.eye(r.step, r.dt, { ui: 1e-10, amp: 0.5, order: 9 });
  const ms = performance.now() - t0;
  check('Leistung: 401 Punkte → Zeitbereich + PRBS9-Auge < 1,5 s', ms < 1500, ms.toFixed(0) + ' ms');
}
void RF;
console.log((fail ? 'FAIL' : 'PASS') + ' · Zeitbereich · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
