// Connector intelligence (block connector-core): profiles, mapping, automatic estimation with uncertainty, templates.
// Synthetic data from tests/connector-fixture.mjs (own circuit solver, not the app's RF core).
import { load } from './load.mjs';
import { connectorCircuit, magneticsCircuit, sMatrix, touchstone, logf, USB_POSITIONS, USB_IDS, RJ45_POSITIONS, shuffled } from './connector-fixture.mjs';

const { RF, Connector } = load();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
const section = name => console.log(name);
const parse = (text, name) => RF.parseTouchstone(text, name);
const truthUsb = order => order.map(node => USB_IDS[node % 24] + '@' + (node < 24 ? 1 : 2));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

section('Profile');
for (const p of Connector.PROFILES) {
  const v = Connector.validateProfile(p);
  check('Profil ' + p.id + ' vollständig und widerspruchsfrei', v.ok, v.errors.join('; '));
}
const usb = Connector.profile('usb-c-receptacle-thru');
const byId = Object.fromEntries(usb.contacts.map(c => [c.id, c.normative]));
check('USB-C: Kontaktbelegung nach USB-IF R2.4 (Stichproben A2, A3, A10, A11, B2, B3, B10, B11, A5, B5, A6, B7)',
  byId.A2 === 'SSTXp1' && byId.A3 === 'SSTXn1' && byId.A10 === 'SSRXn2' && byId.A11 === 'SSRXp2' && byId.B2 === 'SSTXp2' && byId.B3 === 'SSTXn2' && byId.B10 === 'SSRXn1' && byId.B11 === 'SSRXp1' &&
  byId.A5 === 'CC1' && byId.B5 === 'CC2' && byId.A6 === 'Dp1' && byId.B7 === 'Dn2');
check('USB-C: GND A1/A12/B1/B12, VBUS A4/A9/B4/B9', ['A1', 'A12', 'B1', 'B12'].every(c => byId[c] === 'GND') && ['A4', 'A9', 'B4', 'B9'].every(c => byId[c] === 'VBUS'));
check('USB-C: Drehung bildet TX1 auf TX2 und RX1 auf RX2 ab', (() => { const f = usb.symmetries.find(s => s.id === 'flip').map; return byId[f.A2] === 'SSTXp2' && byId[f.B11] === 'SSRXp2'; })());
check('USB-C: Gen 1×1 nutzt eine Lane, Gen 2×2 beide', usb.configurations.find(c => c.id === 'gen1x1').pairs.length === 2 && usb.configurations.find(c => c.id === 'gen2x2').pairs.length === 4);
const rj = Connector.profile('rj45-8p8c-thru');
check('RJ45: Paare 1/2, 3/6, 4/5, 7/8 (IEEE 802.3, 40.8)', rj.pairs.map(p => p.plus + '/' + p.minus).join(' ') === '1/2 3/6 4/5 7/8');
check('Messports je Profil: USB-C 48, RJ45 16, Magnetics 4/6/12', [usb, rj, ...['4p', '6p', '12p'].map(k => Connector.profile('lan-magnetics-' + k))].map(Connector.portCount).join() === '48,16,4,6,12');

section('USB-C · 48 Ports');
const circuit = connectorCircuit(USB_POSITIONS), freq = logf(1e6, 20e9, 61);
const inter = Array.from({ length: 48 }, (_, p) => (p % 2 ? 24 : 0) + Math.floor(p / 2));
const cases = [
  ['Ports 1–24 Seite 1, 25–48 Seite 2', [...Array(48).keys()], null, 'block', 'likely'],
  ['abwechselnd Seite 1/2', inter, null, 'interleaved', 'likely'],
  ['zufällige Reihenfolge, keine Namen', shuffled(48, 11), null, 'data', 'several'],
  ['zufällige Reihenfolge mit Portnamen', shuffled(48, 21), 'names', 'names', 'certain']
];
for (const [label, order, named, expectId, expectCat] of cases) {
  const names = named ? order.map(node => USB_IDS[node % 24] + '_S' + (node < 24 ? 1 : 2)) : null;
  const ds = parse(touchstone(circuit, freq, order, names), 'usb.s48p');
  const t0 = performance.now(), r = Connector.detect(ds, usb), ms = performance.now() - t0, best = r.candidates[0];
  check(label + ': bester Kandidat ' + expectId + ', Kategorie ' + Connector.CATEGORY[expectCat], best.id === expectId && best.category === expectCat, best.id + ' · ' + best.category);
  const truth = { ports: truthUsb(order) };
  const images = [null, ...usb.symmetries].flatMap(sym => [false, true].map(sw => { let m = sym ? Connector.applySymmetry(truth, sym) : truth; return sw ? Connector.swapSides(m) : m; }));
  const exact = same(best.mapping.ports, truth.ports), image = images.some(m => same(best.mapping.ports, m.ports));
  check(label + ': ' + (expectCat === 'several' ? 'Zuordnung ist ein physikalisch gleichwertiges Bild der Wahrheit' : 'Zuordnung stimmt exakt'), expectCat === 'several' ? image : exact);
  check(label + ': Drehung, Spiegelung und Seitentausch als aus den Daten gleichwertig gemeldet', ['flip', 'mirror', 'sides'].every(id => best.alternatives.find(a => a.id === id)?.equivalent));
  check(label + ': Zuordnung in < 500 ms', ms < 500, ms.toFixed(0) + ' ms');
}
{
  const order = shuffled(48, 3), names = order.map(node => { let id = USB_IDS[node % 24]; if (id === 'A2') id = 'A3'; else if (id === 'A3') id = 'A2'; return id + '_S' + (node < 24 ? 1 : 2); });
  const r = Connector.detect(parse(touchstone(circuit, freq, order, names), 'x.s48p'), usb), named = r.candidates.find(c => c.id === 'names');
  check('Vertauschte Plus/Minus-Namen (TX1): nie „eindeutig“, Widerspruch wird benannt', named.category !== 'certain' && !!named.conflict && r.status !== 'certain', named.category);
}
{
  // a conductor that does not pass (open contact): its thru path is missing → mapping not certain
  const broken = connectorCircuit(USB_POSITIONS); broken.branches[5].r = 1e7;
  const r = Connector.detect(parse(touchstone(broken, freq, [...Array(48).keys()]), 'x.s48p'), usb);
  check('Ein unterbrochener Kontakt (A6): nicht „eindeutig“, Durchgänge < 100 %, A6 als unbestätigt benannt', r.status !== 'certain' && r.candidates[0].score.thru < 1 && /A6/.test(r.candidates[0].conflict || ''), r.status + ' · ' + r.candidates[0].conflict);
}
{
  const r = Connector.detect(parse(touchstone(connectorCircuit(RJ45_POSITIONS), logf(1e6, 3e9, 41), [...Array(16).keys()]), 'x.s16p'), rj);
  check('Falsches Profil für die Portzahl: klare Ablehnung', Connector.detect(parse(touchstone(connectorCircuit(RJ45_POSITIONS), logf(1e6, 3e9, 11), [...Array(16).keys()]), 'x.s16p'), usb).status === 'mismatch');
  check('RJ45 · 16 Ports in Kontaktreihenfolge: wahrscheinlich, Spiegelung gleichwertig', r.status === 'likely' && r.candidates[0].alternatives.find(a => a.id === 'mirror').equivalent);
}

section('Zuordnung → Analysekonfiguration');
{
  const order = [...Array(48).keys()], ds = parse(touchstone(circuit, freq, order), 'usb.s48p');
  const best = Connector.detect(ds, usb).candidates[0];
  const { config, channels } = Connector.toConfig(usb, best.mapping, 48, { pairs: ['TX1', 'RX1', 'TX2', 'RX2'] });
  check('Gen 2×2: 8 Mixed-Mode-Paare (4 Lanes × 2 Seiten), 16 aktive Ports, Rest angepasst', config.pairs.length === 8 && config.loads.filter(l => l.type === 'active').length === 16 && config.loads.filter(l => l.type === 'match').length === 32);
  const tx1 = channels.filter(c => c.pair === 'TX1');
  check('TX1 Seite 1 = (A2, A3) = Ports 2/3, Seite 2 = Ports 26/27', tx1[0].plus === 1 && tx1[0].minus === 2 && tx1[1].plus === 25 && tx1[1].minus === 26);
  // independent check: SDD21 of TX1 from the fixture's own S-matrix (matched terminations = port reference → plain submatrix)
  const layout = RF.prepareNetwork(ds, config), fi = 30, [, mm] = RF.processPoint(ds, config, layout, fi);
  const n = layout.mmModes.length, iIn = layout.mmModes.findIndex(m => m.key === 'D' + tx1[0].id), iOut = layout.mmModes.findIndex(m => m.key === 'D' + tx1[1].id);
  const app = [mm[2 * (iOut * n + iIn)], mm[2 * (iOut * n + iIn) + 1]];
  const S = sMatrix(circuit, ds.freq[fi]), a = 1, b = 2, c = 25, d = 26;
  const ref = [(S[c][a][0] - S[c][b][0] - S[d][a][0] + S[d][b][0]) / 2, (S[c][a][1] - S[c][b][1] - S[d][a][1] + S[d][b][1]) / 2];
  check('SDD21 von TX1 aus der Analyse = unabhängige Rechnung aus der Rohmatrix', Math.hypot(app[0] - ref[0], app[1] - ref[1]) < 1e-6, 'App ' + app.map(v => v.toFixed(6)).join(' ') + ' · Referenz ' + ref.map(v => v.toFixed(6)).join(' '));
  const bad = { ...best.mapping, ports: best.mapping.ports.slice() }; bad.ports[5] = bad.ports[1];
  const v = Connector.validateMapping(usb, bad);
  check('Doppelte Belegung wird als Fehler gemeldet', !v.ok && v.issues.some(i => i.level === 'error' && /doppelt/.test(i.text)));
  const half = { ...best.mapping, ports: best.mapping.ports.slice() }; half.ports[2] = null;
  check('Halb zugeordnetes Paar wird gemeldet und nicht übernommen', Connector.validateMapping(usb, half).issues.some(i => /halb/.test(i.text)) && !Connector.mappedPairs(usb, half).some(x => x.pair === 'TX1' && x.side === 1));
}

section('LAN-Magnetics · S4P, S6P, S12P');
const mfreq = logf(1e4, 1e9, 81);
const mcases = [
  ['S4P', 'lan-magnetics-4p', magneticsCircuit(1, { taps: false }), [0, 1, 2, 3], ['P1+', 'P1−', 'S1+', 'S1−']],
  ['S6P', 'lan-magnetics-6p', magneticsCircuit(1), [0, 1, 2, 3, 4, 5], ['P1+', 'P1CT', 'P1−', 'S1+', 'S1CT', 'S1−']],
  // ports mixed, secondary wound the other way: P− is port 1 (so it is called "+" by convention), the same-sense end is S+
  ['S6P gemischt, Sekundärwicklung gedreht', 'lan-magnetics-6p', magneticsCircuit(1, { invert: [0] }), [2, 4, 0, 5, 1, 3], ['P1+', 'S1CT', 'P1−', 'S1−', 'P1CT', 'S1+']],
  ['S12P verschachtelt, Kanal 2 gedreht', 'lan-magnetics-12p', magneticsCircuit(2, { invert: [1] }), [6, 0, 7, 1, 2, 8, 3, 9, 4, 10, 5, 11],
    ['P1+', 'P2+', 'P1CT', 'P2CT', 'P2−', 'P1−', 'S2+', 'S1−', 'S2CT', 'S1CT', 'S2−', 'S1+']]
];
for (const [label, id, circ, order, expect] of mcases) {
  const r = Connector.detect(parse(touchstone(circ, mfreq, order), 'x.s' + order.length + 'p'), id), best = r.candidates[0];
  check(label + ': Gruppen, Mittelanzapfungen, Kanäle und Polarität richtig; Kategorie „wahrscheinlich“', best && same(best.mapping.ports, expect) && best.category === 'likely', best ? best.mapping.ports.join(' ') : r.notes.join(' '));
}
{
  const r = Connector.detect(parse(touchstone(magneticsCircuit(2), mfreq, [...Array(12).keys()]), 'x.s12p'), 'lan-magnetics-6p');
  check('S12P mit S6P-Profil: Ablehnung wegen Portzahl', r.status === 'mismatch');
  const r2 = Connector.detect(parse(touchstone(magneticsCircuit(1, { taps: false }), mfreq, [0, 1, 2, 3]).replace(/^/, ''), 'x.s4p'), 'lan-magnetics-4p');
  check('S4P ohne Anzapfung wird nicht als S6P gedeutet', r2.candidates[0]?.mapping.ports.every(x => !/CT/.test(x)));
}

section('Vorlagen (Port-Maps)');
{
  const m = Connector.emptyMapping(usb, 48); m.ports = truthUsb([...Array(48).keys()]);
  const json = JSON.stringify(Connector.exportMap(usb, m, { name: 'Test' })), back = Connector.importMap(json);
  check('Export/Import einer Zuordnung verlustfrei', same(back.mapping.ports, m.ports) && back.profile.id === usb.id && back.name === 'Test');
  const evil = JSON.parse(json); evil.map[0] = '../../etc'; evil.map[1] = 'Z99@1';
  let rejected = ''; try { Connector.importMap(evil); } catch (e) { rejected = e.message; }
  check('Eine Vorlage mit unbekannten Knoten wird ganz abgelehnt, nichts wird teilweise übernommen', /unbekannten Knoten/.test(rejected), rejected);
  let threw = ''; try { Connector.importMap({ schema: 'x' }); } catch (e) { threw = e.message; }
  check('Fremdes JSON wird abgelehnt', /SIMONLATION/.test(threw), threw);
  let threw2 = ''; try { Connector.importMap({ ...JSON.parse(json), profile: { id: 'hdmi-x' } }); } catch (e) { threw2 = e.message; }
  check('Unbekanntes Profil wird abgelehnt', /Unbekanntes Connector-Profil/.test(threw2));
}

section('Leistung');
{
  const ds = parse(touchstone(circuit, logf(1e6, 20e9, 401), shuffled(48, 9)), 'big.s48p');
  const t0 = performance.now(); const r = Connector.detect(ds, usb); const ms = performance.now() - t0;
  check('48 Ports × 401 Punkte: Zuordnung < 1 s', ms < 1000 && r.status === 'several', ms.toFixed(0) + ' ms');
}

console.log((fail ? 'FAIL' : 'PASS') + ' · Connector · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
