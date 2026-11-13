'use strict';
// Prüft den Rechenkern gegen die unabhängige Referenz aus tests/reference.py.
//   node tests/run-tests.js
const fs = require('fs');
const path = require('path');
const RF = require('../sim/rf-core.js');
const SIM = require('../sim/sim-core.js');
const SPE = require('../sim/limits.js');
const TEMPLATES = require('../sim/templates.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const template = id => TEMPLATES.find(t => t.id === id).text;
let failed = 0;

// Größte Abweichung: komplex absolut und in dB (nur wo |S| > −80 dB, darunter zählt die absolute Abweichung).
function compare(label, matrices, expected, tolDb = 0.1, tolAbs = 1e-4) {
  let worstAbs = 0, worstDb = 0;
  matrices.forEach((m, i) => {
    if (!m) throw new Error(label + ': Punkt ' + i + ' fehlt');
    for (let k = 0; k < m.length / 2; k++) {
      const re = expected.re[i][k], im = expected.im[i][k];
      const d = Math.hypot(m[2 * k] - re, m[2 * k + 1] - im);
      worstAbs = Math.max(worstAbs, d);
      const a = Math.hypot(m[2 * k], m[2 * k + 1]), b = Math.hypot(re, im);
      if (b > 1e-4) worstDb = Math.max(worstDb, Math.abs(20 * Math.log10(a / b)));
    }
  });
  const ok = worstDb <= tolDb && worstAbs <= tolAbs;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FEHL ') + label.padEnd(46) + ' max ' + worstDb.toExponential(2) + ' dB, |Δ| ' + worstAbs.toExponential(2));
}
function check(label, condition, detail = '') {
  if (!condition) failed++;
  console.log((condition ? 'ok   ' : 'FEHL ') + label + (detail ? '  ' + detail : ''));
}
const sameFreq = (a, b) => a.length === b.length && a.every((f, i) => Math.abs(f - b[i]) <= 1e-9 * b[i]);

// A: RLC-Tiefpass
let out = SIM.simulate(SIM.parseNetlist(template('rlc')));
check('A Frequenzraster', sameFreq(Array.from(out.freq), ref.A.freq));
compare('A RLC-Tiefpass gegen ABCD', out.samples, ref.A);

// B: Übertrager aus gekoppelten Spulen
out = SIM.simulate(SIM.parseNetlist(`
.sweep log 10k 100Meg 201
C1 in a 100n esr=0.02
Cp a 0 15p
Lp a 0 350u rs=0.4
Ls b 0 350u rs=0.5
K1 Lp Ls 0.998
Cs b 0 22p
Rs b 0 10k
C2 b out 100n esr=0.02
P1 in 0 50
P2 out 0 50`));
check('B Frequenzraster', sameFreq(Array.from(out.freq), ref.B.freq));
compare('B Übertrager + Koppel-C gegen Z-Matrix/ABCD', out.samples, ref.B);

// C: Kaskade zweier Touchstone-Dateien
const files = new Map();
for (const name of ['stufe1.s2p', 'stufe2.s2p']) {
  files.set(name, RF.parseTouchstone(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'), name));
}
const cascade = sweep => SIM.simulate(SIM.parseNetlist(`
${sweep}
S1 in mid file=stufe1.s2p
S2 mid out ref=0 file=stufe2.s2p
P1 in 0 50
P2 out 0 50`), files);
out = cascade('.sweep lin 100k 200Meg 58');
check('C Frequenzraster (Stützstellen)', sameFreq(Array.from(out.freq), ref.C_dense.freq));
compare('C Kaskade 2 × .s2p gegen scikit-rf (Stützstellen)', out.samples, ref.C_dense);
out = cascade('.sweep log 200k 150Meg 151');
compare('C Kaskade gegen scikit-rf (interpoliert)', out.samples, ref.C, 0.1, 2e-3);
out = cascade('.sweep log 10k 150Meg 31');
check('C außerhalb des Messbereichs: nicht extrapoliert', out.samples[0] === null && out.samples.at(-1) !== null && out.warnings.length === 2, out.warnings[0] || '');

// D: 10BASE-T1L-Vorlagen im Mixed Mode
for (const [key, id] of [['D_sym', 't1l-mdi'], ['D_unsym', 't1l-mdi-unsym'], ['D_powered', 't1l-mdi-podl']]) {
  const net = SIM.parseNetlist(template(id));
  const result = SIM.simulate(net);
  const mixed = SIM.mixedMode(result, net.pairs);
  check(key + ' Moden', mixed.modes.map(m => m.key + '@' + m.ref).join(' ') === 'D1@100 C1@25');
  compare(key + ' Mixed Mode gegen Handrechnung + scikit-rf', mixed.mm, ref[key], 0.1, 1e-4);
}

// E: idealer Übertrager
out = SIM.simulate(SIM.parseNetlist(`
.sweep log 100k 10Meg 3
R1 in a 10
T1 a 0 out 0 2
P1 in 0 50
P2 out 0 50`));
compare('E idealer Übertrager gegen Formel', out.samples, ref.E);

// F: Block ohne Y-Matrix (ideale Durchverbindung S = [[0,1],[1,0]]) muss lösbar sein
const thru = RF.parseTouchstone('# Hz S RI R 50\n1e5 0 0 1 0 1 0 0 0\n1e8 0 0 1 0 1 0 0 0\n', 'thru.s2p');
out = SIM.simulate(SIM.parseNetlist('.sweep log 100k 100Meg 5\nS1 a b file=thru.s2p\nR1 b 0 25\nP1 a 0 50'), new Map([['thru.s2p', thru]]));
check('F ideale Durchverbindung als Block', out.samples.every(s => s && Math.abs(s[0] + 1 / 3) < 1e-9 && Math.abs(s[1]) < 1e-9));

// G: Werte und Grenzwerte
const values = { '100n': 1e-7, '4.7u': 4.7e-6, '1Meg': 1e6, '85uH': 85e-6, '30pF': 3e-11, '20MHz': 2e7, '1m': 1e-3, '50Ohm': 50, '10k': 1e4, '80nH': 8e-8 };
check('G Wertangaben', Object.entries(values).every(([t, v]) => Math.abs(SIM.parseValue(t) - v) <= 1e-12 * v));
const rl = SPE.limits.find(l => l.id === '10BASE-T1L/RL');
const points = [[0.1, 20 - 18 * Math.log10(2)], [0.2, 20], [1, 20], [10, 3.3], [20, 3.3 - 7.6 * Math.log10(2)]];
check('G Grenzkurve 10BASE-T1L RL an den Eckpunkten', points.every(([f, v]) => Math.abs(SPE.value(rl, f) - v) < 1e-9) && SPE.value(rl, 25) === null);

// H: der Simulationsdatensatz lässt sich als Touchstone exportieren und wieder einlesen
{
  const net = SIM.parseNetlist(template('t1l-mdi'));
  const result = SIM.simulate(net);
  const mixed = SIM.mixedMode(result, net.pairs);
  const text = RF.exportTouchstone(result, { layout: mixed.layout, se: mixed.se, mm: mixed.mm }, 'se');
  const again = RF.parseTouchstone(text, 'export.s2p');
  let worst = 0;
  again.samples.forEach((s, i) => s.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - result.samples[i][k])); }));
  check('H Export als Touchstone und Wiedereinlesen', again.n === 2 && again.freq.length === result.freq.length && worst < 1e-9, 'max |Δ| ' + worst.toExponential(1));
}

// I: Vorlagen mit den Messdateien von Würth Elektronik (sim/data/)
{
  const lib = new Map(TEMPLATES.LIBRARY.map(name => [name, RF.parseTouchstone(fs.readFileSync(path.join(__dirname, '..', 'sim', 'data', name), 'latin1'), name)]));
  const solve = id => {
    const net = SIM.parseNetlist(template(id));
    const result = SIM.simulate(net, lib);
    const mixed = SIM.mixedMode(result, net.pairs);
    const n = mixed.modes.length;
    return { result, db: (i, j) => SIM.magnitudeDb(mixed.mm, n, i, j) };
  };
  const within = (result, db, lo, hi, test) => Array.from(result.freq).every((f, i) => f < lo || f > hi || test(db[i]));
  let r = solve('we-cmc-thru');
  check('I WE 744235251: Gegentakt geht durch, Gleichtakt gesperrt (1–100 MHz)',
    within(r.result, r.db(1, 0), 1e6, 1e8, v => v > -1.5) && within(r.result, r.db(3, 2), 1e6, 1e8, v => v < -25));
  for (const id of ['t1l-we-con', 't1l-we-phy']) {
    r = solve(id);
    check('I ' + id + ': unter 300 kHz nicht gerechnet, darüber Sdd11 besser als −19 dB',
      r.result.samples[0] === null && r.result.warnings.length === 1 && within(r.result, r.db(0, 0), 3.01e5, 2e7, v => v < -19));
  }
}

console.log(failed ? '\n' + failed + ' Prüfung(en) fehlgeschlagen' : '\nAlle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
