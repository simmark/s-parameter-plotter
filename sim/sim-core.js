'use strict';

// Rechenkern des SPE-Schaltungssimulators: Netzliste -> S-Matrix je Frequenzpunkt.
// Lineare Kleinsignalanalyse im Frequenzbereich (modifizierte Knotenanalyse).
// Entwickelt von Simon Mark · info.simonlation@gmail.com
//
// Das Ergebnis hat dieselbe Form wie ein mit RF.parseTouchstone gelesener Datensatz
// ({ n, refs, freq, samples, ... }) und kann deshalb mit allen RF-Funktionen
// (Mixed Mode, Export als Touchstone, Ersatzschaltbilder) weiterverarbeitet werden.

const SIM = (() => {
  const core = typeof RF !== 'undefined' ? RF : require('./rf-core.js');
  const TAU = 2 * Math.PI;
  const GROUND = new Set(['0', 'gnd', 'masse']);
  const GMIN = 1e-12; // Leitwert jedes Knotens gegen Masse, hält schwebende Knoten lösbar
  const SUFFIX = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9, t: 1e12 };
  const VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[fpnuµμmkgt])?(hz|h|f|ohm|Ω|s)?$/i;

  // Werte wie in SPICE: 100n, 4.7u, 1Meg, 85uH, 30pF, 50Ohm. "m" ist Milli, "Meg" ist Mega.
  // Ausnahme für Frequenzen: "MHz" ist Megahertz.
  function parseValue(text) {
    if (typeof text === 'number') return text;
    const raw = String(text).trim().replace(',', '.');
    const m = raw.match(VALUE);
    if (!m) return NaN;
    let factor = 1;
    if (m[2]) {
      const key = m[2].toLowerCase();
      // "100f" bleibt Femto; "100pF" hat Suffix p und Einheit F.
      factor = key === 'm' && m[3] && m[3].toLowerCase() === 'hz' ? 1e6 : SUFFIX[key];
    }
    return Number(m[1]) * factor;
  }

  const fail = (line, message) => { throw new Error('Zeile ' + line + ': ' + message); };

  // Textnetzliste -> Netzlisten-Objekt (JSON-fähig). Schreibweise siehe README.md, Abschnitt „Simulator“.
  function parseNetlist(text) {
    const net = {
      title: '', standard: null, powered: false,
      sweep: { scale: 'log', start: 1e5, stop: 1e8, points: 401 },
      elements: [], couplings: [], ports: [], pairs: []
    };
    const names = new Set();
    String(text).split(/\r?\n/).forEach((source, at) => {
      const lineNo = at + 1;
      const line = source.replace(/[;!].*$/, '').trim();
      if (!line || line.startsWith('*') || line.startsWith('#')) return;
      const tokens = line.split(/\s+/);
      const head = tokens[0];
      const params = {}, plain = [];
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf('=');
        if (eq > 0) params[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
        else plain.push(token);
      }
      const value = (raw, what) => {
        const v = parseValue(raw);
        if (!Number.isFinite(v)) fail(lineNo, 'Ungültiger Wert für ' + what + ': ' + raw);
        return v;
      };
      const optional = key => Object.hasOwn(params, key) ? value(params[key], key) : 0;

      if (head.startsWith('.')) {
        const directive = head.toLowerCase();
        if (directive === '.title') net.title = line.slice(head.length).trim();
        else if (directive === '.standard') {
          net.standard = plain[0] || null;
          net.powered = plain.slice(1).some(word => /^(powered|speisung|podl|spoe)$/i.test(word));
        } else if (directive === '.sweep') {
          if (plain.length !== 4 || !/^(log|lin)$/i.test(plain[0])) fail(lineNo, '.sweep log|lin <Start> <Stopp> <Punkte>');
          const sweep = { scale: plain[0].toLowerCase(), start: value(plain[1], 'Start'), stop: value(plain[2], 'Stopp'), points: Math.round(value(plain[3], 'Punkte')) };
          if (!(sweep.start > 0 && sweep.stop > sweep.start && sweep.points >= 2 && sweep.points <= 20001)) fail(lineNo, 'Sweep braucht 0 < Start < Stopp und 2 bis 20001 Punkte.');
          net.sweep = sweep;
        } else if (directive === '.pair') {
          if (plain.length !== 2) fail(lineNo, '.pair <Port+> <Port−>');
          net.pairs.push({ id: net.pairs.length + 1, p: Number(plain[0]), q: Number(plain[1]) });
        } else if (directive !== '.end') fail(lineNo, 'Unbekannte Anweisung ' + head);
        return;
      }

      const key = head.toLowerCase();
      if (names.has(key)) fail(lineNo, 'Name doppelt vergeben: ' + head);
      names.add(key);
      const nodes = count => {
        if (plain.length < count) fail(lineNo, head + ' braucht ' + count + ' Knoten.');
        return plain.slice(0, count).map(n => n.toLowerCase());
      };
      const kind = head[0].toUpperCase();
      if (kind === 'R') {
        if (plain.length !== 3) fail(lineNo, 'R<Name> <Knoten+> <Knoten−> <Wert>');
        const r = value(plain[2], 'R');
        if (!(r > 0)) fail(lineNo, 'R muss größer als 0 sein.');
        net.elements.push({ kind, name: head, nodes: nodes(2), value: r });
      } else if (kind === 'C') {
        if (plain.length !== 3) fail(lineNo, 'C<Name> <Knoten+> <Knoten−> <Wert> [esr=] [esl=]');
        const c = value(plain[2], 'C');
        if (!(c > 0)) fail(lineNo, 'C muss größer als 0 sein.');
        net.elements.push({ kind, name: head, nodes: nodes(2), value: c, esr: optional('esr'), esl: optional('esl') });
      } else if (kind === 'L') {
        if (plain.length !== 3) fail(lineNo, 'L<Name> <Knoten+> <Knoten−> <Wert> [rs=] [cp=] [rp=]');
        const l = value(plain[2], 'L');
        if (!(l > 0)) fail(lineNo, 'L muss größer als 0 sein.');
        net.elements.push({ kind, name: head, nodes: nodes(2), value: l, rs: optional('rs'), cp: optional('cp'), rp: optional('rp') });
      } else if (kind === 'K') {
        if (plain.length !== 3) fail(lineNo, 'K<Name> <L1> <L2> <k>');
        const k = value(plain[2], 'k');
        if (!(Math.abs(k) <= 1)) fail(lineNo, 'Der Koppelfaktor muss zwischen −1 und 1 liegen.');
        net.couplings.push({ name: head, a: plain[0].toLowerCase(), b: plain[1].toLowerCase(), k, line: lineNo });
      } else if (kind === 'T') {
        if (plain.length !== 5) fail(lineNo, 'T<Name> <P+> <P−> <S+> <S−> <ü>  (ü = Up/Us)');
        const ratio = value(plain[4], 'ü');
        if (!ratio) fail(lineNo, 'Das Übersetzungsverhältnis darf nicht 0 sein.');
        net.elements.push({ kind, name: head, nodes: nodes(4), value: ratio });
      } else if (kind === 'S') {
        if (!params.file) fail(lineNo, 'S<Name> <Knoten 1> … <Knoten N> [ref=<Knoten>] file=<Datei>');
        if (!plain.length) fail(lineNo, head + ' braucht mindestens einen Knoten.');
        net.elements.push({ kind, name: head, nodes: plain.map(n => n.toLowerCase()), ref: (params.ref || '0').toLowerCase(), file: params.file });
      } else if (kind === 'P') {
        if (plain.length < 2 || plain.length > 3) fail(lineNo, 'P<Nummer> <Knoten+> <Knoten−> [Z0]');
        const id = Number(head.slice(1));
        if (!Number.isInteger(id) || id < 1) fail(lineNo, 'Ports heißen P1, P2, …');
        const z0 = plain[2] ? value(plain[2], 'Z0') : (params.z0 ? value(params.z0, 'Z0') : 50);
        if (!(z0 > 0)) fail(lineNo, 'Z0 muss größer als 0 sein.');
        net.ports.push({ id, nodes: nodes(2), z0, label: params.name || '' });
      } else fail(lineNo, 'Unbekanntes Bauteil ' + head + ' (erlaubt: R, L, C, K, T, S, P).');
    });

    net.ports.sort((a, b) => a.id - b.id);
    net.ports.forEach((port, i) => {
      if (port.id !== i + 1) throw new Error('Ports müssen lückenlos ab P1 nummeriert sein.');
    });
    if (!net.ports.length) throw new Error('Die Netzliste enthält keinen Port (P1 <Knoten+> <Knoten−> 50).');
    const inPair = new Set();
    for (const pair of net.pairs) {
      for (const id of [pair.p, pair.q]) {
        if (!Number.isInteger(id) || id < 1 || id > net.ports.length) throw new Error('.pair verweist auf einen Port, den es nicht gibt.');
        if (inPair.has(id)) throw new Error('Port P' + id + ' steckt in mehr als einem Paar.');
        inPair.add(id);
      }
    }
    return net;
  }

  function frequencies({ scale, start, stop, points }) {
    const out = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      out[i] = scale === 'log' ? start * (stop / start) ** t : start + (stop - start) * t;
    }
    out[points - 1] = stop;
    return out;
  }

  // S-Matrix eines Touchstone-Blocks auf der Simulationsfrequenz. Linear in Real- und Imaginärteil,
  // außerhalb des gemessenen Bereichs null: es wird nicht extrapoliert.
  function interpolate(data, f) {
    const freq = data.freq, last = freq.length - 1;
    if (f < freq[0] * (1 - 1e-9) || f > freq[last] * (1 + 1e-9)) return null;
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (freq[mid] <= f) lo = mid; else hi = mid;
    }
    const a = data.samples[lo], b = data.samples[hi];
    if (!a || !b) return null;
    const span = freq[hi] - freq[lo];
    const t = span > 0 ? Math.min(1, Math.max(0, (f - freq[lo]) / span)) : 0;
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
    return out;
  }

  // Netzliste -> Datensatz mit S-Matrix der Gesamtschaltung an den Ports P1…PN.
  // files: Map Dateiname (klein geschrieben) -> Datensatz aus RF.parseTouchstone.
  function simulate(net, files = new Map()) {
    const warnings = [];
    const nodeIndex = new Map();
    const node = name => {
      if (GROUND.has(name)) return -1;
      if (!nodeIndex.has(name)) nodeIndex.set(name, nodeIndex.size);
      return nodeIndex.get(name);
    };

    const shunts = [], inductors = [], transformers = [], blocks = [];
    const byName = new Map();
    let branches = 0;
    for (const el of net.elements) {
      if (el.kind === 'R' || el.kind === 'C') {
        shunts.push({ el, a: node(el.nodes[0]), b: node(el.nodes[1]) });
      } else if (el.kind === 'L') {
        const item = { el, a: node(el.nodes[0]), b: node(el.nodes[1]), branch: branches++ };
        inductors.push(item);
        byName.set(el.name.toLowerCase(), item);
      } else if (el.kind === 'T') {
        transformers.push({ el, n: el.nodes.map(node), branch: branches++ });
      } else if (el.kind === 'S') {
        const data = files.get(el.file.toLowerCase());
        if (!data) throw new Error(el.name + ': Die Datei „' + el.file + '“ ist nicht geladen.');
        if (data.n !== el.nodes.length) {
          throw new Error(el.name + ': „' + el.file + '“ hat ' + data.n + ' Ports, die Netzliste nennt ' + el.nodes.length + ' Knoten.');
        }
        blocks.push({ el, data, n: el.nodes.map(node), ref: node(el.ref), branch: branches, missed: 0 });
        branches += data.n;
      }
    }
    const couplings = net.couplings.map(c => {
      const a = byName.get(c.a), b = byName.get(c.b);
      if (!a || !b || a === b) throw new Error(c.name + ': Die Kopplung braucht zwei verschiedene Induktivitäten (' + c.a + ', ' + c.b + ').');
      return { a: a.branch, b: b.branch, m: c.k * Math.sqrt(a.el.value * b.el.value) };
    });
    const ports = net.ports.map(p => ({ ...p, a: node(p.nodes[0]), b: node(p.nodes[1]), root: Math.sqrt(p.z0) }));
    for (const p of ports) if (p.a === p.b) throw new Error('P' + p.id + ': Beide Anschlüsse liegen auf demselben Knoten.');

    const nodeCount = nodeIndex.size, size = nodeCount + branches, P = ports.length;
    const freq = frequencies(net.sweep);
    let singular = 0;

    const samples = Array.from(freq, f => {
      const omega = TAU * f;
      const A = new Float64Array(2 * size * size);
      const B = new Float64Array(2 * size * P);
      const acc = (r, c, re, im) => {
        if (r < 0 || c < 0) return;
        const at = 2 * (r * size + c);
        A[at] += re; A[at + 1] += im;
      };
      const admittance = (a, b, re, im) => {
        acc(a, a, re, im); acc(b, b, re, im); acc(a, b, -re, -im); acc(b, a, -re, -im);
      };
      // Strom I fließt im Bauteil von Knoten a nach Knoten b (Unbekannte in Spalte col).
      const current = (a, b, col, weight = 1) => { acc(a, col, weight, 0); acc(b, col, -weight, 0); };

      for (let i = 0; i < nodeCount; i++) acc(i, i, GMIN, 0);

      for (const { el, a, b } of shunts) {
        if (el.kind === 'R') admittance(a, b, 1 / el.value, 0);
        else {
          // Y = 1 / (ESR + j(ωESL − 1/ωC))
          const x = omega * el.esl - 1 / (omega * el.value);
          const norm = el.esr * el.esr + x * x;
          admittance(a, b, el.esr / norm, -x / norm);
        }
      }

      for (const { el, a, b, branch } of inductors) {
        const col = nodeCount + branch;
        current(a, b, col);
        acc(col, a, 1, 0); acc(col, b, -1, 0);         // Ua − Ub − (Rs + jωL)·I − Σ jωM·Ik = 0
        acc(col, col, -el.rs, -omega * el.value);
        if (el.cp) admittance(a, b, 0, omega * el.cp);
        if (el.rp) admittance(a, b, 1 / el.rp, 0);
      }
      for (const { a, b, m } of couplings) {
        acc(nodeCount + a, nodeCount + b, 0, -omega * m);
        acc(nodeCount + b, nodeCount + a, 0, -omega * m);
      }

      for (const { el, n, branch } of transformers) {
        // Idealer Übertrager: Up = ü·Us, Is = −ü·Ip
        const col = nodeCount + branch, ratio = el.value;
        current(n[0], n[1], col);
        current(n[2], n[3], col, -ratio);
        acc(col, n[0], 1, 0); acc(col, n[1], -1, 0);
        acc(col, n[2], -ratio, 0); acc(col, n[3], ratio, 0);
      }

      let usable = true;
      for (const block of blocks) {
        const s = interpolate(block.data, f);
        if (!s) { block.missed++; usable = false; continue; }
        const count = block.data.n, refs = block.data.refs;
        for (let i = 0; i < count; i++) {
          // Ii fließt vom Knoten in den Block und über den Bezugsknoten zurück.
          const row = nodeCount + block.branch + i;
          current(block.n[i], block.ref, row);
          const ri = Math.sqrt(refs[i]);
          // (Ui − Zi·Ii)/√Zi = Σ Sij·(Uj + Zj·Ij)/√Zj
          for (let j = 0; j < count; j++) {
            const rj = Math.sqrt(refs[j]);
            const at = 2 * (i * count + j);
            const vr = (i === j ? 1 / ri : 0) - s[at] / rj, vi = -s[at + 1] / rj;
            acc(row, block.n[j], vr, vi);
            acc(row, block.ref, -vr, -vi);
            acc(row, nodeCount + block.branch + j, (i === j ? -ri : 0) - s[at] * rj, -s[at + 1] * rj);
          }
        }
      }
      if (!usable) return null;

      ports.forEach((p, j) => {
        admittance(p.a, p.b, 1 / p.z0, 0);
        // Einfallende Welle a = 1 an Port j: Stromquelle 2/√Z0 parallel zu Z0.
        if (p.a >= 0) B[2 * (p.a * P + j)] += 2 / p.root;
        if (p.b >= 0) B[2 * (p.b * P + j)] -= 2 / p.root;
      });

      const x = core.solve(A, B, size, P);
      if (!x) { singular++; return null; }
      const s = new Float64Array(2 * P * P);
      ports.forEach((p, i) => {
        for (let j = 0; j < P; j++) {
          let re = 0, im = 0;
          if (p.a >= 0) { re += x[2 * (p.a * P + j)]; im += x[2 * (p.a * P + j) + 1]; }
          if (p.b >= 0) { re -= x[2 * (p.b * P + j)]; im -= x[2 * (p.b * P + j) + 1]; }
          s[2 * (i * P + j)] = re / p.root - (i === j ? 1 : 0);
          s[2 * (i * P + j) + 1] = im / p.root;
        }
      });
      return s;
    });

    for (const block of blocks) {
      if (block.missed) {
        const lo = block.data.freq[0], hi = block.data.freq[block.data.freq.length - 1];
        warnings.push(block.el.name + ': „' + block.el.file + '“ deckt nur ' + formatFreq(lo) + ' bis ' + formatFreq(hi) +
          ' ab. ' + block.missed + ' Frequenzpunkte außerhalb wurden nicht berechnet (keine Extrapolation).');
      }
    }
    if (singular) warnings.push(singular + ' Frequenzpunkte waren nicht lösbar (singuläre Matrix). Prüfe Kurzschlüsse und ideale Bauteile.');
    if (!samples.some(Boolean)) throw new Error('Kein Frequenzpunkt war berechenbar. ' + warnings.join(' '));

    return {
      n: P, name: (net.title || 'Simulation') + '.s' + P + 'p',
      refs: ports.map(p => p.z0), freq, samples,
      format: 'RI', sourceKind: 'S', version: '2.1', noiseCount: 0, warnings,
      portNames: ports.map(p => p.label || (p.nodes[0] + (GROUND.has(p.nodes[1]) ? '' : ' / ' + p.nodes[1]))),
      sourcePairs: net.pairs.map(pair => ({ p: pair.p - 1, q: pair.q - 1 })),
      demo: false, simulated: true,
      stats: { nodes: nodeCount, unknowns: size, points: freq.length }
    };
  }

  function formatFreq(f) {
    if (f >= 1e9) return +(f / 1e9).toPrecision(4) + ' GHz';
    if (f >= 1e6) return +(f / 1e6).toPrecision(4) + ' MHz';
    if (f >= 1e3) return +(f / 1e3).toPrecision(4) + ' kHz';
    return +f.toPrecision(4) + ' Hz';
  }

  // Mixed-Mode-Auswertung über den vorhandenen RF-Kern. Paare wie in der Netzliste (Portnummern ab 1).
  // Ergebnis: modes = [{ key: 'D1' | 'C1' | 'P3', ref }], mm[i] = Matrix in dieser Modenreihenfolge.
  function mixedMode(dataset, pairs) {
    const config = {
      loads: Array.from({ length: dataset.n }, () => ({ type: 'active' })),
      pairs: pairs.map(pair => ({ id: pair.id, p: pair.p - 1, q: pair.q - 1 })),
      ref: null
    };
    const layout = core.prepareNetwork(dataset, config);
    const se = [], mm = [];
    dataset.samples.forEach((sample, i) => {
      if (!sample) { se.push(null); mm.push(null); return; }
      const [a, b] = core.processPoint(dataset, config, layout, i);
      se.push(a); mm.push(b);
    });
    return { layout, modes: layout.hasMixed ? layout.mmModes : layout.seModes, se, mm, config };
  }

  // |S(row, col)| in dB über der Frequenz; NaN, wo kein Punkt berechnet wurde.
  function magnitudeDb(matrices, n, row, col) {
    return Float64Array.from(matrices, m => {
      if (!m) return NaN;
      const at = 2 * (row * n + col);
      return 20 * Math.log10(Math.hypot(m[at], m[at + 1]));
    });
  }

  return { parseValue, parseNetlist, simulate, mixedMode, magnitudeDb, frequencies, interpolate, formatFreq };
})();

if (typeof module === 'object' && module.exports) module.exports = SIM;
