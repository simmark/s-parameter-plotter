// Prüfung an echten Herstellerdaten gegen das Datenblatt. Die Dateien liegen NICHT im Repository (Nutzungsrechte):
//   SPA_PRIVATE_DATA=/pfad node tests/real.data.mjs
// Erwartet im Ordner (fehlende werden übersprungen):
//   S-Parameter_744823601*.s4p   WE-CMB 744823601: 1 mH ±30 % @ 10 kHz, Wicklungen 1–4 / 2–3 (Messports P1–P2 / P3–P4)
//   S-Parameter_7490140122B*.s6p WE-LAN 7490140122B: L ≥ 350 µH @ 100 kHz, n = 1:1 ±2 %, RDC ≤ 1,3 Ω, Punkte an Pin 1 und 12
// Unabhängig von der Oberfläche: Parser, RF-Kern, Bauteil-Erkennung und Vierpol-Fit direkt.
import fs from 'node:fs';
import path from 'node:path';
import { load, read, DATA } from './load.mjs';
const { RF, Magnetic, Connector } = load(process.argv[2]);
let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : '')); cond ? pass++ : fail++; };
const find = re => DATA && fs.existsSync(DATA) ? fs.readdirSync(DATA).filter(f => re.test(f)).map(f => path.join(DATA, f))[0] : null;
const at = (ds, f) => ds.freq.reduce((best, x, i) => Math.abs(Math.log(x / f)) < Math.abs(Math.log(ds.freq[best] / f)) ? i : best, 1);
const C = { sub: (a, b) => [a[0] - b[0], a[1] - b[1]], add: (a, b) => [a[0] + b[0], a[1] + b[1]] };
const fmt = (v, unit, d = 3) => (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e4 ? v.toPrecision(d) : v.toExponential(d - 1)) + ' ' + unit;

const cmcFile = find(/744823601.*\.s4p$/i);
if (!cmcFile) console.log('SKIP WE-CMB 744823601 (Datei fehlt)');
else {
  const ds = read(RF, cmcFile), r = Magnetic.analyze(ds);
  ok(JSON.stringify(r.windings?.pairs) === '[[0,1],[2,3]]' && r.windings.confidence === 'sicher', 'CMC: Wicklungen P1–P2 / P3–P4 sicher erkannt (Datenblatt 1–4 / 2–3)', JSON.stringify(r.windings?.pairs) + ' ' + r.windings?.confidence);
  ok(r.verdict?.category === 'cmc', 'CMC: Klasse CMC', r.verdict?.category + ' (' + r.verdict?.level + ')');
  const ok4 = (r.manufacturer?.part === '744823601');
  ok(ok4, 'CMC: Artikelnummer aus dem Dateikopf');
  // natural modes, lines IN = P1/P3, OUT = P2/P4
  const map = [0, 2, 1, 3], meas = { y: Array.from(ds.freq, (f, i) => RF.cmcNatural(RF.submatrix(ds.samples[i], 4, map), [50, 50, 50, 50], f)?.y ?? null), ref: 50 };
  const i10 = at(ds, 1e4), w = 2 * Math.PI * ds.freq[i10], n = RF.cmcNatural(RF.submatrix(ds.samples[i10], 4, map), [50, 50, 50, 50], ds.freq[i10]);
  const zh = RF.div([2, 0], n.h), zd = RF.div([2, 0], n.d), L = (zh[1] / w + zd[1] / w) / 2;   // L = (L+M + L−M)/2 per winding
  ok(L > 0.7e-3 && L < 1.3e-3, 'CMC: L je Wicklung bei 10 kHz im Datenblattfenster 1 mH ±30 %', fmt(L * 1e6, 'µH'));
  const start = { type: 'cmc', m: 835e-6, ls: 2.04e-6, rls: 2.75e3, rw: 0.5, rfe: 5.4e3, ct: 0.27e-12, cw: 2.1e-12, cx: 2.18e-12, cg: 0.66e-12 };
  const fit = RF.fitMultiHeld(ds.freq, meas, start, { band: [1e3, 135e6] });
  ok(fit && fit.err < 1.3 && fit.parts.d.err < 0.5, 'CMC: Modell mit R_σ trifft die Messung (gesamt < 1,3 dB, Gegentakt < 0,5 dB)', fit ? fit.err.toFixed(2) + ' dB, D ' + fit.parts.d.err.toFixed(2) + ' dB' : 'kein Fit');
  ok(fit && fit.model.rw > 0.1, 'CMC: Serienwiderstand der Messung weit über R_DC (≤ 13 mΩ) – Rest der Messanordnung, dokumentiert', fit ? fmt(fit.model.rw, 'Ω') : '');
}

const lanFile = find(/7490140122B.*\.s6p$/i);
if (!lanFile) console.log('SKIP WE-LAN 7490140122B (Datei fehlt)');
else {
  const ds = read(RF, lanFile), p = ds.profile;
  ok(p && JSON.stringify(p.pairs) === JSON.stringify([{ p: 0, q: 2 }, { p: 5, q: 3 }]) && JSON.stringify(p.taps) === '[1,4]', 'LAN: Profil aus der Skizze – Primär P1/P3, Sekundär P6 (Pin 12, +) / P4, Anzapfungen offen', JSON.stringify(p));
  // differential two-port with the taps open: drop P2 and P5 from Z
  const keep = [0, 2, 3, 5], a = [1, -1, 0, 0], b = [0, 0, -1, 1];
  const zd = i => {
    const z6 = RF.toZY(ds.samples[i], ds.refs, 'Z'), z = (r, c) => RF.get(z6, 6, keep[r], keep[c]);
    const q = (u, v) => { let s = [0, 0]; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (u[r] && v[c]) s = C.add(s, RF.scale(z(r, c), u[r] * v[c])); return s; };
    return [[q(a, a), q(a, b)], [q(b, a), q(b, b)]];
  };
  const i1 = at(ds, 1e5), w1 = 2 * Math.PI * ds.freq[i1], z1 = zd(i1);
  const ocl = z1[0][0][1] / w1, nn = RF.abs(z1[1][0]) / RF.abs(z1[0][0]);
  ok(ocl >= 350e-6, 'LAN: OCL bei 100 kHz ≥ 350 µH', fmt(ocl * 1e6, 'µH'));
  ok(Math.abs(nn - 1) <= 0.02, 'LAN: Übersetzung 1:1 ±2 %', nn.toFixed(4));
  ok(z1[1][0][1] > 0, 'LAN: Polarität gleichsinnig mit der Punktkonvention des Datenblatts (Pin 1 ↔ Pin 12)');
  const i0 = at(ds, 1e4), z0 = zd(i0), zk = C.sub(z0[0][0], RF.div(RF.mul(z0[0][1], z0[1][0]), z0[1][1]));
  ok(zk[0] / 2 <= 1.3, 'LAN: Wicklungswiderstand aus der Kurzschlussimpedanz (R₁ + R₂)/2 ≤ 1,3 Ω', fmt(zk[0] / 2, 'Ω'));
  // Connector Studio, profile LAN magnetics S6P: structure from the measurement alone (galvanic groups, taps, dot convention)
  const det = Connector.detect(ds, 'lan-magnetics-6p'), m = det.candidates[0]?.mapping.ports || [];
  ok(JSON.stringify(m) === JSON.stringify(['P1+', 'P1CT', 'P1−', 'S1−', 'S1CT', 'S1+']), 'LAN · Connector: Mittelanzapfungen Pin 2/11, gleichsinnig Pin 1 ↔ Pin 12 allein aus der Messung', m.join(' ') + ' · ' + det.status);
  const { config } = Connector.toConfig(Connector.profile('lan-magnetics-6p'), det.candidates[0].mapping, 6);
  ok(JSON.stringify(config.pairs.map(x => [x.p, x.q])) === JSON.stringify(p.pairs.map(x => [x.p, x.q])) && JSON.stringify(config.loads.map(l => l.type)) === JSON.stringify(['active', 'open', 'active', 'active', 'open', 'active']),
    'LAN · Connector: Analysekonfiguration identisch mit dem Profil aus dem Herstellerkopf');
}

console.log((fail ? 'FAIL' : 'PASS') + ' · Echte Daten · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
