// Multiport (phase 2), three-conductor modes (phase 3), port-map files and channel check. Synthetic data from
// tests/connector-fixture.mjs (own circuit solver); expected values are computed here, independently of the app.
import { load } from './load.mjs';
import { connectorCircuit, sMatrix, touchstone, logf, RJ45_POSITIONS } from './connector-fixture.mjs';

const { RF, Connector } = load();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
const section = name => console.log(name);
const parse = (text, name) => RF.parseTouchstone(text, name);
const c = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }, abs: a => Math.hypot(a[0], a[1]) };
const sidecar = (ports, pairs, extra = {}) => ({ schema: 'simonlation.synthetic-portmap.v1', model: 'test', synthetic: true, number_of_ports: ports.length, ports, differential_pairs: pairs, ...extra });

// ---------- three-conductor modes ----------
section('Dreileitergruppen 0/α/β');
{
  // 3-phase CMC: three windings L with mutual M = k·L between all; ports IN1..3 = nodes 0..2, OUT1..3 = nodes 3..5.
  const L = 850e-6, k = 0.985, R = 0.05, circuit = { nodes: 6, branches: [0, 1, 2].map(u => ({ a: u, b: u + 3, r: R, l: L })), L: [[0, 1, k * L], [0, 2, k * L], [1, 2, k * L]], C: [] };
  const freq = logf(1e2, 1e7, 51), ds = parse(touchstone(circuit, freq, [0, 1, 2, 3, 4, 5]), 'cmc3.s6p');
  const config = { loads: Array.from({ length: 6 }, () => ({ type: 'active' })), pairs: [], triples: [{ a: 0, b: 1, c: 2, id: 1 }, { a: 3, b: 4, c: 5, id: 2 }], ref: null };
  const layout = RF.prepareNetwork(ds, config);
  check('Moden in der Reihenfolge 0, α, β je Gruppe', layout.mmModes.map(m => m.key).join(' ') === 'Z1 Z2 A1 A2 B1 B2');
  check('Bezugsimpedanz jeder Mode = Portreferenz (orthonormale Transformation)', layout.mmModes.every(m => m.ref === 50));
  let e0 = 0, eab = 0, conv = 0;
  for (let i = 0; i < freq.length; i++) {
    const [, mm] = RF.processPoint(ds, config, layout, i), w = 2 * Math.PI * freq[i];
    // series impedance per conductor in the mode: zero sequence R + jω(L + 2M), line modes R + jω(L − M); S21 = 2·50/(2·50 + Z)
    const s21 = z => c.div([100, 0], c.add([100, 0], z)), z0 = [R, w * L * (1 + 2 * k)], zl = [R, w * L * (1 - k)];
    const g = (r, col) => RF.get(mm, 6, r, col);
    e0 = Math.max(e0, c.abs(c.sub(g(1, 0), s21(z0))));
    eab = Math.max(eab, c.abs(c.sub(g(3, 2), s21(zl))), c.abs(c.sub(g(5, 4), s21(zl))));
    for (const [r, col] of [[3, 0], [5, 0], [1, 2], [1, 4], [5, 2], [3, 4]]) conv = Math.max(conv, c.abs(g(r, col)));
  }
  check('Nullsystem: S00·21 = 2Z₀/(2Z₀ + R + jω(L + 2M)) (analytisch)', e0 < 1e-9, 'max. Abweichung ' + e0.toExponential(1));
  check('α und β: Sαα·21 = Sββ·21 = 2Z₀/(2Z₀ + R + jω(L − M))', eab < 1e-9, 'max. Abweichung ' + eab.toExponential(1));
  check('Symmetrische Drossel: keine Konversion zwischen 0, α und β', conv < 1e-12, conv.toExponential(1));
  // round trip with a known modal matrix: S = Mᵀ·Sm·M, the app must return Sm
  const r3 = 1 / Math.sqrt(3), r6 = 1 / Math.sqrt(6), r2 = Math.SQRT1_2, T = [[r3, r3, r3], [2 * r6, -r6, -r6], [0, r2, -r2]];
  const Sm = [[0.1, 0.02], [0.3, -0.4], [0.05, 0.6]];   // modal reflection per mode (one-port groups), arbitrary complex
  const S = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => [0, 1].map(q => T.reduce((acc, row, m) => acc + row[i] * Sm[m][q] * row[j], 0))));
  const text = '# HZ S RI R 50\n1e6 ' + S.flat().map(v => v[0] + ' ' + v[1]).join(' ') + '\n2e6 ' + S.flat().map(v => v[0] + ' ' + v[1]).join(' ') + '\n';
  const d3 = parse(text, 'm.s3p'), cfg3 = { loads: [0, 1, 2].map(() => ({ type: 'active' })), pairs: [], triples: [{ a: 0, b: 1, c: 2, id: 1 }], ref: null };
  const [, m3] = RF.processPoint(d3, cfg3, RF.prepareNetwork(d3, cfg3), 0);
  let err = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const v = RF.get(m3, 3, a, b), want = a === b ? Sm[a] : [0, 0]; err = Math.max(err, Math.hypot(v[0] - want[0], v[1] - want[1])); }
  check('Rücktransformation: bekannte Modalmatrix wird exakt wiedergefunden', err < 1e-12, err.toExponential(1));
  let threw = ''; try { RF.prepareNetwork(d3, { ...cfg3, pairs: [{ p: 0, q: 1, id: 1 }] }); } catch (e) { threw = e.message; }
  check('Port in Paar und Gruppe zugleich wird abgelehnt', /Dreileitergruppen/.test(threw));
  const net = { layout: RF.prepareNetwork(d3, cfg3), se: [m3], mm: [m3] };
  let exp = ''; try { RF.exportTouchstone(d3, net, 'mm'); } catch (e) { exp = e.message; }
  check('Touchstone-Export der 0/α/β-Basis wird mit Begründung abgelehnt', /keine 0\/α\/β-Moden/.test(exp));
  // unequal port references: renormalised to the geometric mean first
  const d3r = { ...d3, refs: [50, 50, 75] }, lr = RF.prepareNetwork(d3r, cfg3);
  check('Ungleiche Portreferenzen: gemeinsame Referenz = geometrisches Mittel, Hinweis', Math.abs(lr.mmModes[0].ref - Math.cbrt(50 * 50 * 75)) < 1e-9 && lr.notices.some(n => n.id === 'T1'));
}

// ---------- port-map files (sidecar) and channel check ----------
section('Port-Map-Datei und Kanalprüfung');
const rjFreq = logf(1e6, 3e9, 41), rjCircuit = connectorCircuit(RJ45_POSITIONS), order = [...Array(16).keys()];
const rjText = touchstone(rjCircuit, rjFreq, order), rj = parse(rjText, 'rj.s16p');
const rjPorts = order.map(i => ({ port: i + 1, node: (i < 8 ? 'L' : 'R') + (i % 8 + 1), pin: String(i % 8 + 1), signal: ['P1+', 'P1-', 'P2+', 'P3+', 'P3-', 'P2-', 'P4+', 'P4-'][i % 8], side: i < 8 ? 'LEFT' : 'RIGHT', role: 'signal' }));
const rjPairs = ['LEFT', 'RIGHT'].flatMap((side, s) => [[1, 2, 'P1'], [3, 6, 'P2'], [4, 5, 'P3'], [7, 8, 'P4']].map(([p, q, name]) => ({ side, pair: name, positive_port: p + 8 * s, negative_port: q + 8 * s })));
{
  const { profile: p, mapping } = Connector.fromSidecar(sidecar(rjPorts, rjPairs), 16);
  check('Port-Map wird zu einem Profil je Anschluss (16 Anschlüsse, 8 Paare)', p.contacts.length === 16 && p.pairs.length === 8 && Connector.validateProfile(p).ok);
  check('… Belegung aus der Datei, Quelle „file“, keine Messdaten-Annahme', mapping.ports[0] === '1·1' && mapping.ports[15] === '2·8' && mapping.source.every(x => x === 'file'));
  Connector.register(p);
  const ch = Connector.checkChannels(p, mapping, rj);
  check('Kanalprüfung: 4 Kanäle mit Durchgang; ohne Phasenbezug bleibt die Polarität offen', ch.length === 4 && ch.every(x => x.polarity === 'open' && x.maxDb > -1), ch.map(x => x.channel + ':' + x.polarity).join(' '));
  // A polarity reference bounds the delay, so the phase at a low frequency proves the sign (lumped test circuit: well below 1 ns).
  const REF = { source: 'Synthetische Testschaltung, konzentriert', maxDelaySeconds: 1e-9, maxFrequencyHz: 3e9, response: 'noninverting-baseband' };
  const withRef = Connector.fromSidecar(sidecar(rjPorts, rjPairs, { model: 'test-ref', polarityReference: REF }), 16);
  const chr = Connector.checkChannels(withRef.profile, withRef.mapping, rj);
  check('Mit Phasenbezug: alle 4 Kanäle richtig gepolt, Bezug wird genannt', chr.length === 4 && chr.every(x => x.polarity === 'ok' && x.reference === REF.source), chr.map(x => x.channel + ':' + x.polarity).join(' '));
  let e0 = ''; try { Connector.fromSidecar(sidecar(rjPorts, rjPairs, { model: 'test-ref-bad', polarityReference: { ...REF, response: 'irgendwas' } }), 16); } catch (e) { e0 = e.message; }
  check('Unvollständiger Phasenbezug wird abgelehnt', /Polaritätsreferenz/.test(e0), e0);
  // swap + and − of P2 on the right side → that channel must be reported inverted
  const bad = rjPairs.map(x => x.side === 'RIGHT' && x.pair === 'P2' ? { ...x, positive_port: x.negative_port, negative_port: x.positive_port } : x);
  const r2 = Connector.fromSidecar({ ...sidecar(rjPorts, bad), model: 'test-bad', polarityReference: REF }, 16);
  const ch2 = Connector.checkChannels(r2.profile, r2.mapping, rj);
  check('Mit Phasenbezug: vertauschtes + / − an einem Ende wird als „vertauscht“ erkannt', ch2.find(x => x.channel === 'P2').polarity === 'inverted' && ch2.filter(x => x.polarity === 'ok').length === 3);
  // a pair mapped to the wrong contacts on one side → no transmission
  const wrong = rjPairs.map(x => x.side === 'RIGHT' && x.pair === 'P4' ? { ...x, positive_port: 9, negative_port: 10 } : x.side === 'RIGHT' && x.pair === 'P1' ? { ...x, positive_port: 15, negative_port: 16 } : x);
  const r3 = Connector.fromSidecar({ ...sidecar(rjPorts, wrong), model: 'test-wrong' }, 16), ch3 = Connector.checkChannels(r3.profile, r3.mapping, rj);
  check('Paar auf falschen Kontakten: kein Durchgang', ch3.find(x => x.channel === 'P4').polarity === 'none' && ch3.find(x => x.channel === 'P1').polarity === 'none');
  // fan-out / transformer style: pairs with different names are linked by the measurement
  const linked = rjPairs.map(x => x.side === 'RIGHT' ? { ...x, pair: x.pair + '_OUT' } : x);
  const r4 = Connector.fromSidecar({ ...sidecar(rjPorts, linked), model: 'test-link', polarityReference: REF }, 16), ch4 = Connector.checkChannels(r4.profile, r4.mapping, rj);
  check('Paare ohne gemeinsamen Namen werden über die Messung verknüpft (P1 → P1_OUT …)', ch4.length === 4 && ch4.every(x => x.fromData && x.channel === x.from.split('·')[0] + ' → ' + x.from.split('·')[0] + '_OUT' && x.polarity === 'ok'), ch4.map(x => x.channel).join(', '));
  let e1 = ''; try { Connector.fromSidecar(sidecar(rjPorts, rjPairs), 12); } catch (e) { e1 = e.message; }
  check('Port-Map mit falscher Portzahl wird abgelehnt', /gilt für 16 Ports/.test(e1));
  let e2 = ''; try { Connector.fromSidecar({ ...sidecar(rjPorts, rjPairs), schema: 'x' }); } catch (e) { e2 = e.message; }
  check('Fremdes Schema wird abgelehnt', /Keine Port-Map-Datei/.test(e2));
  let e3 = ''; try { Connector.register({ ...p, id: 'usb-c-receptacle-thru' }); } catch (e) { e3 = e.message; }
  check('Eingebautes Profil lässt sich nicht überschreiben', /eingebauten Profil/.test(e3));
  const html = sidecar(rjPorts.map((x, i) => i === 0 ? { ...x, signal: '<img src=x onerror=alert(1)>' } : x), rjPairs);
  check('Texte aus der Datei werden von Markup-Zeichen befreit', !/[<>]/.test(Connector.fromSidecar({ ...html, model: 'test-x' }, 16).profile.contacts[0].label));
}

section('Portnamen mit Seitenfeld (LEFT | A1 | …)');
{
  const names = order.map(i => (i < 8 ? 'LEFT' : 'RIGHT') + ' | ' + (i % 8 + 1) + ' | sig | signal');
  const ds = parse(touchstone(rjCircuit, rjFreq, order, names), 'rjn.s16p');
  const r = Connector.detect(ds, 'rj45-8p8c-thru'), best = r.candidates[0];
  check('Seiten aus dem ersten Feld (zwei Werte, je die Hälfte der Ports) → „Eindeutig“', r.status === 'certain' && best.id === 'names' && best.mapping.ports.every((x, i) => x === (i % 8 + 1) + '@' + (i < 8 ? 1 : 2)), r.status);
}

section('Seitenkonsistenz ohne Annahme NEXT > FEXT');
{
  // purely capacitive coupling, stronger at side 2: far-end coupling exceeds near-end coupling; the thru order is still unique
  const K = 8, cc = { nodes: 16, branches: Array.from({ length: K }, (_, u) => ({ a: u, b: K + u, r: 0.02, l: 2e-9 })), L: [], C: [] };
  for (let u = 0; u < K; u++) { cc.C.push([u, -1, 0.2e-12], [K + u, -1, 0.2e-12]); if (u < K - 1) cc.C.push([u, u + 1, 0.01e-12], [K + u, K + u + 1, 0.06e-12]); }
  const names = order.map(i => (i < 8 ? 'LEFT' : 'RIGHT') + ' | ' + (i % 8 + 1) + ' | x | signal'), ds = parse(touchstone(cc, rjFreq, order, names), 'cap.s16p');
  const r = Connector.detect(ds, 'rj45-8p8c-thru'), named = r.candidates.find(x => x.id === 'names');
  check('Richtige Belegung bleibt strukturell konsistent (Seiten 100 %)', named.score.sides === 1, 'Seiten ' + named.score.sides + ', NEXT stärker: ' + named.score.nearStronger);
  check('… und die Kategorie ist „Eindeutig“ (FEXT > NEXT ist kein Widerspruch)', r.status === 'certain', r.status);
}

section('Übersprechen, Laufzeit und Skew (Phase 2)');
{
  // 4 pairs through the RJ45 fixture; mapping from the sidecar; expected values computed here from the fixture S-matrix
  const { profile: p, mapping } = Connector.fromSidecar({ ...sidecar(rjPorts, rjPairs), model: 'test-xt' }, 16);
  Connector.register(p);
  const { config, channels } = Connector.toConfig(p, mapping, 16, {});
  const layout = RF.prepareNetwork(rj, config), se = [], mm = [];
  for (let i = 0; i < rjFreq.length; i++) { const [a, b] = RF.processPoint(rj, config, layout, i); se.push(a); mm.push(b); }
  const res = Connector.crosstalk({ freq: rjFreq, mm, se, modes: layout.mmModes, active: layout.active, channels });
  check('Ein Ergebnis je Kanal (4)', res.length === 4 && res.map(r => r.channel).join() === 'P1,P2,P3,P4');
  // independent PSNEXT at end 1 for P2 (pins 3/6) from the fixture matrix: Σ over P1, P3, P4 of |Sdd(victim@1, aggressor@1)|²
  const pairsL = { P1: [0, 1], P2: [2, 5], P3: [3, 4], P4: [6, 7] }, fi = rjFreq.length - 1, S = sMatrix(rjCircuit, rjFreq[fi]);
  const sdd = ([a, b], [c2, d]) => { const v = c.sub(c.sub(S[a][c2], S[a][d]), c.sub(S[b][c2], S[b][d])); return [v[0] / 2, v[1] / 2]; };
  const ps = ['P1', 'P3', 'P4'].reduce((acc, k) => acc + c.abs(sdd(pairsL.P2, pairsL[k])) ** 2, 0);
  const got = res.find(r => r.channel === 'P2').psnext1[fi];
  check('PSNEXT Ende 1 von P2 = 10·lg Σ|SDD|² über P1, P3, P4 (unabhängig gerechnet)', Math.abs(got - 10 * Math.log10(ps)) < 1e-6, got.toFixed(3) + ' dB / ' + (10 * Math.log10(ps)).toFixed(3) + ' dB');
  const fsum = ['P1', 'P3', 'P4'].reduce((acc, k) => acc + c.abs(sdd(pairsL.P2.map(x => x + 8), pairsL[k])) ** 2, 0);
  check('PSFEXT von P2 = Σ|SDD(P2@2, Störer@1)|²', Math.abs(res.find(r => r.channel === 'P2').psfext[fi] - 10 * Math.log10(fsum)) < 1e-6);
  check('Stärkster Störer von P2 ist ein Nachbarpaar (P1 oder P3)', ['P1', 'P3'].includes(res.find(r => r.channel === 'P2').worstNext.aggressor), res.find(r => r.channel === 'P2').worstNext.aggressor);
  check('Lane-Abweichungen summieren sich zu null', Math.abs(res.reduce((a, r) => a + r.laneSkew, 0)) < 1e-18);
}
{
  // skew: two identical lines, the minus conductor 20 % longer (more L and C) → τ(+) − τ(−) < 0, symmetric pair → 0
  const mk = scale => ({ nodes: 4, branches: [{ a: 0, b: 2, r: 0.01, l: 5e-9 }, { a: 1, b: 3, r: 0.01, l: 5e-9 * scale }], L: [], C: [[0, -1, 1e-12], [2, -1, 1e-12], [1, -1, 1e-12 * scale], [3, -1, 1e-12 * scale]] });
  const f = logf(1e6, 2e9, 201), names = ['L | 1 | a+ | s', 'L | 2 | a- | s', 'R | 1 | a+ | s', 'R | 2 | a- | s'];
  const ports = [0, 1, 2, 3].map(i => ({ port: i + 1, pin: String(i % 2 + 1), signal: i % 2 ? 'a-' : 'a+', side: i < 2 ? 'L' : 'R', role: 'signal' }));
  const pairs = [{ side: 'L', pair: 'A', positive_port: 1, negative_port: 2 }, { side: 'R', pair: 'A', positive_port: 3, negative_port: 4 }];
  const run = (scale, model) => {
    const ds = parse(touchstone(mk(scale), f, [0, 1, 2, 3], names), model + '.s4p'), { profile: p, mapping } = Connector.fromSidecar({ ...sidecar(ports, pairs), model }, 4);
    const { config, channels } = Connector.toConfig(p, mapping, 4, {}), layout = RF.prepareNetwork(ds, config), se = [], mm = [];
    for (let i = 0; i < f.length; i++) { const [a, b] = RF.processPoint(ds, config, layout, i); se.push(a); mm.push(b); }
    return Connector.crosstalk({ freq: f, mm, se, modes: layout.mmModes, active: layout.active, channels })[0];
  };
  const sym = run(1, 'skew-sym'), asym = run(1.2, 'skew-asym');
  // LC ladder delay ≈ √(L·C_total) with C split at both ends: τ ≈ √(5 nH · 2 pF)
  const tPlus = Math.sqrt(5e-9 * 2e-12), tMinus = Math.sqrt(5e-9 * 1.2 * 2e-12 * 1.2);
  check('Symmetrisches Paar: Skew 0', Math.abs(sym.skew) < 1e-15, (sym.skew * 1e12).toFixed(4) + ' ps');
  check('Minusleiter 20 % länger: Skew negativ, Größenordnung √(LC)-Differenz', asym.skew < 0 && Math.abs(asym.skew - (tPlus - tMinus)) < 0.35 * Math.abs(tPlus - tMinus), (asym.skew * 1e12).toFixed(2) + ' ps, Abschätzung ' + ((tPlus - tMinus) * 1e12).toFixed(2) + ' ps');
  check('Laufzeit des symmetrischen Paars ≈ √(L·C)', Math.abs(sym.delay - tPlus) < 0.2 * tPlus, (sym.delay * 1e12).toFixed(1) + ' ps / ' + (tPlus * 1e12).toFixed(1) + ' ps');
}

console.log((fail ? 'FAIL' : 'PASS') + ' · Multiport · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
