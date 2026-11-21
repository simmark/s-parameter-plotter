'use strict';
// Physics-based recognition for two-winding magnetics (CMC, coupled inductor, transformer) and two-pole elements
// (inductor, coreless coil, ferrite bead, capacitor, resistor). It reads only the complex S-matrix of the dataset,
// runs offline, never mutates its input and returns candidates with evidence. Scores are evidence sums, not
// calibrated probabilities; manufacturer metadata from the file header is reported separately from measured physics.
const Magnetic = (() => {
  const VERSION = '1.0.0';
  const TAU = 2 * Math.PI;
  const { abs, add, sub, mul, scale, div, get } = RF;

  const LABEL = {
    cmc: 'Stromkompensierte Drossel (CMC)', coupled: 'Gekoppelte Doppeldrossel', transformer: 'Übertrager', 'two-elements': 'Zwei getrennte Zweipole',
    inductor: 'Induktivität', 'coreless': 'Luft- oder Keramikkernspule', 'ferrite-inductor': 'Ferritkern-Induktivität', bead: 'Ferrit-Perle (Bead)',
    capacitor: 'Kondensator', resistor: 'Widerstand', other: 'Sonstiges Netzwerk'
  };
  const SHORT = { cmc: 'CMC', coupled: 'Doppeldrossel', transformer: 'Übertrager', 'two-elements': 'Zwei Zweipole', inductor: 'Induktivität', coreless: 'Luftspule',
    'ferrite-inductor': 'Ferritspule', bead: 'Ferrit-Perle', capacitor: 'Kondensator', resistor: 'Widerstand', other: 'Sonstiges' };
  const LABEL_EN = {
    cmc: 'Common-mode choke (CMC)', coupled: 'Coupled dual inductor', transformer: 'Transformer', 'two-elements': 'Two separate two-poles',
    inductor: 'Inductor', coreless: 'Air- or ceramic-core coil', 'ferrite-inductor': 'Ferrite-core inductor', bead: 'Ferrite bead',
    capacitor: 'Capacitor', resistor: 'Resistor', other: 'Other network'
  };
  const SHORT_EN = { cmc: 'CMC', coupled: 'coupled inductor', transformer: 'transformer', 'two-elements': 'two two-poles', inductor: 'inductor', coreless: 'air coil',
    'ferrite-inductor': 'ferrite inductor', bead: 'ferrite bead', capacitor: 'capacitor', resistor: 'resistor', other: 'other' };
  const label = (cat, lang = 'de', short = false) => (lang === 'en' ? (short ? SHORT_EN : LABEL_EN) : (short ? SHORT : LABEL))[cat] || cat;
  const MAGNETIC = ['cmc', 'coupled', 'transformer'];

  // Manufacturer family → device class (public product-line names; metadata only, never derived from the measurement).
  const FAMILY = [
    [/^WE-(CMB|CMBH|CMBNC|ExB|FCL?P?|LF|LPCC|TFC|CNSA|CNSW|SCC|SLM?\d?|UCF|CMDC|CCMF|TPB)\b/i, 'cmc'],
    [/^WE-(DD|MCRI|TDC|DPC|DCT|CFWI|EHPI|MTCI)\b/i, 'coupled'],
    [/^(WE-(LAN|STST|PoE\+?|PoEH|GDTI?|AGDT|FLEX\+?|FB|UNIT|UOST|PPTI|LLCR|CST)|MID-CST)\b/i, 'transformer'],
    [/^WE-(CAIR|AC)\b/i, 'coreless'],
    [/^WE-(CBF|CBA|MPSA|MPSB|TMSB|PBF|UKW|SUKW|PF|MLS|CMS)\b/i, 'bead'],
    [/^WCAP-/i, 'capacitor'],
    [/^WE-(PD\w*|LQ\w*|TPC|HC\w*|XHM\w|MAPI|MAIA|LHM\w|SPC|TIS?|TI_HV|SI|SD|RCI\w|PFC|FAMI|HIDA|PMC?I|RFI|KI|GFH?|ASI|MK|MCI|TCI|CHSA\w*|HCF\w*|SD)\b/i, 'inductor']
  ];
  function familyClass(family) {
    for (const [re, cls] of FAMILY) if (re.test(family || '')) return cls;
    return null;
  }

  const median = values => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const quantile = (values, q) => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))] : NaN;
  };
  const db = v => 20 * Math.log10(Math.max(abs(v), 1e-12));
  const round = (v, digits = 4) => Number.isFinite(v) ? +v.toPrecision(digits) : null;
  // Bilingual texts: German is the app's source language, English is chosen at render time.
  const T = (de, en) => ({ de, en });
  const fd = (v, d) => v.toFixed(d).replace('.', ','), fe = (v, d) => v.toFixed(d);
  const dB2 = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

  // ---------- data quality ----------
  function positiveIndices(dataset) {
    const out = [];
    const { freq, samples } = dataset;
    for (let i = 0; i < freq.length; i++) {
      const s = samples[i];
      if (freq[i] > 0 && s && s.every(Number.isFinite)) out.push(i);
    }
    // A lone near-DC point (e.g. 1 Hz before a 300 kHz sweep) is a synthetic extrapolation, not a measurement.
    while (out.length > 2 && freq[out[1]] / freq[out[0]] > 30) out.shift();
    return out;
  }

  function quality(dataset, idx) {
    const n = dataset.n, refs = dataset.refs || [];
    let recip = [], active = 0;
    for (const i of idx) {
      const s = dataset.samples[i];
      let worst = 0;
      for (let r = 0; r < n; r++) {
        for (let c = r + 1; c < n; c++) {
          const a = get(s, n, r, c), b = get(s, n, c, r), scaleBy = Math.max(abs(a), abs(b), 0.01);
          worst = Math.max(worst, abs(sub(a, b)) / scaleBy);
        }
      }
      recip.push(worst);
      for (let c = 0; c < n; c++) {
        let power = 0;
        for (let r = 0; r < n; r++) power += abs(get(s, n, r, c)) ** 2;
        if (power > 1.05) { active++; break; }
      }
    }
    const refsUniform = refs.every(r => r === refs[0]);
    const refsValid = refs.length === n && refs.every(r => Number.isFinite(r) && r > 0);
    return {
      points: idx.length, total: dataset.freq.length,
      fMin: idx.length ? dataset.freq[idx[0]] : NaN, fMax: idx.length ? dataset.freq[idx.at(-1)] : NaN,
      reciprocity: round(median(recip), 3), activePoints: active, refsUniform, refsValid, ref: refs[0]
    };
  }

  // ---------- two-winding extraction from the Y-matrix ----------
  const PAIRINGS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

  function yMatrix(dataset, i) { return RF.toZY(dataset.samples[i], dataset.refs, 'Y'); }

  // Two floating branches a→b and c→d: every port current pair (a,b) and (c,d) must sum to zero.
  function residual(Y, [[a, b], [c, d]]) {
    let res = 0, total = 0;
    for (let j = 0; j < 4; j++) {
      res += abs(add(get(Y, 4, a, j), get(Y, 4, b, j))) + abs(add(get(Y, 4, c, j), get(Y, 4, d, j)));
      total += abs(get(Y, 4, a, j)) + abs(get(Y, 4, b, j)) + abs(get(Y, 4, c, j)) + abs(get(Y, 4, d, j));
    }
    return total > 0 ? res / total : NaN;
  }

  function branchZ(Y, [[a, b], [c, d]]) {
    const g = (i, j) => get(Y, 4, i, j);
    const avg = (w, x, y, z) => scale(add(sub(sub(w, x), y), z), 0.25);
    const y11 = avg(g(a, a), g(a, b), g(b, a), g(b, b)), y22 = avg(g(c, c), g(c, d), g(d, c), g(d, d));
    const y12 = avg(g(a, c), g(a, d), g(b, c), g(b, d)), y21 = avg(g(c, a), g(c, b), g(d, a), g(d, b));
    const det = sub(mul(y11, y22), mul(y12, y21));
    const z11 = div(y22, det), z22 = div(y11, det), z12 = div(scale(y12, -1), det), z21 = div(scale(y21, -1), det);
    if (!z11 || !z22 || !z12 || !z21) return null;
    return { z11, z22, z12: scale(add(z12, z21), 0.5) };
  }

  function windings(dataset, idx) {
    const f0 = dataset.freq[idx[0]];
    const low = idx.filter(i => dataset.freq[i] <= f0 * 30).slice(0, Math.max(5, Math.ceil(idx.length * 0.15)));
    const use = low.length >= 3 ? low : idx.slice(0, 5);
    const scores = PAIRINGS.map(pairs => {
      const values = [];
      for (const i of use) {
        const Y = yMatrix(dataset, i);
        if (Y) values.push(residual(Y, pairs));
      }
      return { pairs, residual: median(values), points: values.length };
    }).sort((x, y) => (x.residual ?? 9) - (y.residual ?? 9));
    const [best, second] = scores;
    const ratio = second.residual / Math.max(best.residual, 1e-6);
    let confidence = 'unklar';
    if (best.residual <= 0.01 && (second.residual >= 0.03 || ratio >= 8)) confidence = 'sicher';
    else if (best.residual <= 0.05 && ratio >= 3) confidence = 'wahrscheinlich';
    return { pairs: best.pairs, residual: round(best.residual, 3), second: round(second.residual, 3), confidence, alternatives: scores.slice(1).map(s => ({ pairs: s.pairs, residual: round(s.residual, 3) })), band: [dataset.freq[use[0]], dataset.freq[use.at(-1)]] };
  }

  function coupling(dataset, idx, pairs) {
    const rows = [];
    for (const i of idx) {
      const Y = yMatrix(dataset, i);
      const z = Y && branchZ(Y, pairs);
      if (!z) continue;
      const w = TAU * dataset.freq[i];
      const L1 = z.z11[1] / w, L2 = z.z22[1] / w, M = z.z12[1] / w;
      rows.push({ i, f: dataset.freq[i], w, L1, L2, M, R1: z.z11[0], R2: z.z22[0], k: L1 > 0 && L2 > 0 ? M / Math.sqrt(L1 * L2) : NaN });
    }
    if (rows.length < 3) return null;
    // Self-resonance of the open windings: first point where a winding stops being inductive after it was.
    let srf = NaN;
    for (let j = 1; j < rows.length; j++) {
      const was = rows[j - 1].L1 > 0 && rows[j - 1].L2 > 0, now = rows[j].L1 > 0 && rows[j].L2 > 0;
      if (was && !now) { srf = rows[j].f; break; }
    }
    const top = Number.isFinite(srf) ? srf : Infinity;
    const rDc = Math.max(1e-6, Math.min(...rows.slice(0, 3).map(r => Math.min(r.R1, r.R2)).filter(v => v > 0)));
    // Valid band for k: below 0.2·SRF, leakage reactance measurable in a 50 Ω system, windings inductive.
    const leak = r => r.w * r.L1 * (1 - Math.min(r.k * r.k, 1));
    let band = rows.filter(r => r.f <= 0.2 * top && r.L1 > 0 && r.L2 > 0 && Number.isFinite(r.k) && leak(r) >= 1 && r.w * r.L1 <= 5e4);
    let kQuality = 'gut';
    if (band.length < 3) {
      band = rows.filter(r => r.f <= 0.2 * top && r.L1 > 0 && r.L2 > 0 && Number.isFinite(r.k) && leak(r) >= 0.2 && r.w * r.L1 <= 5e4);
      kQuality = 'eingeschränkt';
    }
    if (band.length < 3) {
      band = rows.filter(r => r.f <= 0.5 * top && r.L1 > 0 && r.L2 > 0 && Number.isFinite(r.k));
      kQuality = 'unsicher';
    }
    if (!band.length) return { rows, srf, valid: false };
    const ks = band.map(r => r.k);
    // Inductances are read low in the band (first measurable points), where shunt core loss and winding capacitance distort least.
    const low = rows.filter(r => r.f <= 0.2 * top && r.L1 > 0 && r.L2 > 0 && r.w * Math.min(r.L1, r.L2) >= 1).slice(0, 3);
    const lowRows = low.length ? low : band.slice(0, 3);
    const L1 = median(lowRows.map(r => r.L1)), L2 = median(lowRows.map(r => r.L2)), M = median(lowRows.map(r => r.M));
    // Core loss: excess series resistance over the DC-like resistance, relative to the reactance, below half the SRF.
    const lossBand = rows.filter(r => r.f <= 0.5 * top && r.L1 > 0 && r.w * r.L1 >= 1);
    const tan = lossBand.map(r => Math.max(0, (Math.min(r.R1, r.R2) - rDc)) / (r.w * Math.min(r.L1, r.L2)));
    const qs = lossBand.map(r => r.w * r.L1 / Math.max(r.R1, 1e-9));
    const flat = lossBand.length >= 2 ? lossBand.at(-1).L1 / median(band.map(r => r.L1)) : NaN;
    return {
      valid: true, rows, srf, band: [band[0].f, band.at(-1).f], points: band.length, kQuality,
      L1, L2, M, k: median(ks), kSpread: round((quantile(ks, 0.9) - quantile(ks, 0.1)) / 2, 3),
      R1: median(band.map(r => r.R1)), R2: median(band.map(r => r.R2)), rDc,
      n: Math.sqrt(Math.max(L1, L2) / Math.min(L1, L2)), tanMax: tan.length ? Math.max(...tan) : NaN,
      tanAt: tan.length ? lossBand[tan.indexOf(Math.max(...tan))].f : NaN, qMax: qs.length ? Math.max(...qs) : NaN, qMin: qs.length ? Math.min(...qs) : NaN, flat
    };
  }

  // Mixed-mode quantities for the line-filter reading: pair 1 = (a, c), pair 2 = (b, d), dotted ends first.
  function modes(dataset, i, inPair, outPair) {
    const s = dataset.samples[i], r = Math.SQRT1_2;
    const vec = (p, q, sign) => { const v = [0, 0, 0, 0]; v[p] = r; v[q] = sign * r; return v; };
    const D1 = vec(inPair[0], inPair[1], -1), D2 = vec(outPair[0], outPair[1], -1), C1 = vec(inPair[0], inPair[1], 1), C2 = vec(outPair[0], outPair[1], 1);
    const form = (u, v) => {
      let acc = [0, 0];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (u[a] && v[b]) acc = add(acc, scale(get(s, 4, a, b), u[a] * v[b]));
      return acc;
    };
    return { sdd21: form(D2, D1), scc21: form(C2, C1), sdc21: form(D2, C1), scd21: form(C2, D1), sdd11: form(D1, D1), scc11: form(C1, C1) };
  }

  const DECADES = [1e4, 1e5, 1e6, 1e7, 1e8];
  function nearest(dataset, idx, f) {
    let best = -1, err = Infinity;
    for (const i of idx) {
      const e = Math.abs(Math.log(dataset.freq[i] / f));
      if (e < err) { err = e; best = i; }
    }
    return err <= Math.log(1.6) ? best : -1;
  }

  // ---------- classification of two-winding parts ----------
  function evidence(c, w, q) {
    const items = [];
    const add = (code, text, scores, weight = 1) => items.push({ code, text: text.de, en: text.en, scores, weight });
    const k = Math.abs(c.k);
    if (c.kQuality === 'unsicher') add('k_uncertain', T('Kopplung nur unsicher bestimmbar (Streureaktanz im 50-Ω-Messsystem sehr klein); k wird nicht gewertet.', 'Coupling only uncertain (leakage reactance very small in the 50 Ω system); k is not scored.'), {}, 0);
    else if (k < 0.3) add('k_none', T('Wicklungen praktisch ungekoppelt (|k| < 0,3).', 'Windings practically uncoupled (|k| < 0.3).'), { 'two-elements': 4, cmc: -4, coupled: -2, transformer: -4 });
    else if (k < 0.9) add('k_verylow', T('Streuanteil über 19 % (|k| < 0,9): für eine CMC praktisch ausgeschlossen, typisch für gekoppelte Speicherdrosseln.', 'Leakage above 19 % (|k| < 0.9): practically ruled out for a CMC, typical of coupled storage inductors.'), { coupled: 2.5, cmc: -2.5, transformer: -2.5 });
    else if (k < 0.95) add('k_low', T('Streuanteil über 10 % (|k| < 0,95): für CMC und Übertrager untypisch, typisch für gekoppelte Leistungsdrosseln.', 'Leakage above 10 % (|k| < 0.95): unusual for CMCs and transformers, typical of coupled power inductors.'), { coupled: 1.5, cmc: -1, transformer: -2 });
    else if (k < 0.99) add('k_mid', T('Kopplung 0,95 … 0,99: bei Doppeldrosseln üblich, bei CMCs eher selten.', 'Coupling 0.95 … 0.99: common for coupled inductors, rather rare for CMCs.'), { coupled: 1, transformer: -1 });
    else if (k < 0.999) add('k_high', T('Sehr feste Kopplung (|k| ≥ 0,99): passt zu CMC und Übertrager, kommt aber auch bei Doppeldrosseln vor.', 'Very tight coupling (|k| ≥ 0.99): fits CMCs and transformers, but also occurs in coupled inductors.'), { cmc: 0.5, transformer: 0.5 });
    else add('k_very_high', T('Extrem feste Kopplung (|k| ≥ 0,999): typisch für bifilar gewickelte Übertrager und Signal-CMCs.', 'Extremely tight coupling (|k| ≥ 0.999): typical of bifilar transformers and signal CMCs.'), { transformer: 1.5, cmc: 1, coupled: -1 });
    if (k >= 0.999 && c.n < 1.15) add('same_build', T('Ein 1:1-Übertrager ist wie eine CMC aufgebaut (zwei gleiche, fest gekoppelte Wicklungen); die S-Parameter allein trennen beide kaum.', 'A 1:1 transformer is built like a CMC (two equal, tightly coupled windings); S-parameters alone hardly separate them.'), { transformer: 1 }, 0.5);

    if (c.n >= 1.15) add('ratio', T('Windungsverhältnis ≈ 1:' + fd(c.n, 2) + ' – unsymmetrische Wicklungen sprechen für einen Übertrager.', 'Turns ratio ≈ 1:' + fe(c.n, 2) + ' – unequal windings indicate a transformer.'), { transformer: 4, cmc: -3, coupled: -2 });
    else add('symmetric', T('Beide Wicklungen nahezu gleich (L₁ ≈ L₂).', 'Both windings nearly equal (L₁ ≈ L₂).'), { cmc: 0.5, coupled: 0.5 }, 0.5);

    if (Number.isFinite(c.tanMax)) {
      if (c.tanMax >= 0.25) add('core_lossy', T('Hohe Kernverluste unterhalb der Eigenresonanz (tan δ bis ' + fd(c.tanMax, 2) + '): hochpermeabler Ferrit, typisch für CMCs.', 'High core loss below self-resonance (tan δ up to ' + fe(c.tanMax, 2) + '): high-permeability ferrite, typical of CMCs.'), { cmc: 3, transformer: 0.5, coupled: -2 });
      else if (c.tanMax <= 0.15) add('core_lowloss', T('Geringe Kernverluste (tan δ ≤ ' + fd(c.tanMax, 2) + '): verlustarmer, meist gescherter Kern wie bei Speicherdrosseln.', 'Low core loss (tan δ ≤ ' + fe(c.tanMax, 2) + '): low-loss, usually gapped core as in storage inductors.'), { coupled: 2, cmc: -1.5 });
      else add('core_mid', T('Mittlere Kernverluste (tan δ ' + fd(c.tanMax, 2) + ').', 'Moderate core loss (tan δ ' + fe(c.tanMax, 2) + ').'), {}, 0);
    }
    const L = Math.sqrt(c.L1 * c.L2);
    if (L >= 1e-3) add('l_large', T('Wicklungsinduktivität im mH-Bereich: bei Netz-CMCs üblich, bei Leistungs-Doppeldrosseln selten.', 'Winding inductance in the mH range: common for mains CMCs, rare for coupled power inductors.'), { cmc: 2.5, coupled: -1.5 });
    else if (L <= 20e-6 && Math.abs(c.k) < 0.995) add('l_small', T('Kleine Induktivität (≤ 20 µH) bei merklicher Streuung: typisch für Leistungs-Doppeldrosseln.', 'Small inductance (≤ 20 µH) with noticeable leakage: typical of coupled power inductors.'), { coupled: 0.5 });
    if (w.confidence !== 'sicher') add('paths_unclear', T('Wicklungspfade nicht eindeutig aus der Matrix ablesbar.', 'Winding paths cannot be read unambiguously from the matrix.'), {}, 0);
    if (q.reciprocity > 0.05) add('nonreciprocal', T('Die Matrix ist nicht reziprok (Abweichung ' + Math.round(q.reciprocity * 100) + ' %); Ergebnis mit Vorsicht lesen.', 'The matrix is not reciprocal (deviation ' + Math.round(q.reciprocity * 100) + ' %); read the result with care.'), {}, 0);
    return items;
  }

  function decide(items, classes) {
    const score = Object.fromEntries(classes.map(c => [c, 0]));
    for (const e of items) for (const [cls, v] of Object.entries(e.scores)) if (cls in score) score[cls] += v;
    const ranked = classes.map(c => ({ category: c, score: Math.round(score[c] * 10) / 10 })).sort((a, b) => b.score - a.score);
    const [top, second] = ranked;
    const gap = top.score - second.score;
    const level = top.score >= 3 && gap >= 2.5 ? 'wahrscheinlich' : top.score >= 2 && gap >= 1.5 ? 'möglich' : 'unklar';
    return { ranked, level, category: level === 'unklar' ? null : top.category };
  }

  function analyzeFour(dataset, idx, q) {
    const w = windings(dataset, idx);
    if (w.confidence === 'unklar') {
      return { status: 'candidate', kind: 'four-port', windings: w, verdict: { category: 'other', level: 'unklar', ranked: [] },
        evidence: [{ code: 'no_windings', text: 'Keine zwei getrennten Wicklungspfade gefunden (Restfehler ' + fd(w.residual, 3) + '); kein Zweiwicklungs-Bauteil oder Massebezug vorhanden.', en: 'No two separate winding paths found (residual ' + fe(w.residual, 3) + '); not a two-winding part, or a ground connection is present.', scores: {}, weight: 0 }], warnings: [] };
    }
    const c = coupling(dataset, idx, w.pairs);
    if (!c || !c.valid) return { status: 'insufficient-data', kind: 'four-port', windings: w, reason: 'Die Wicklungsinduktivitäten lassen sich im Messband nicht bestimmen.', reasonEn: 'The winding inductances cannot be determined within the measured band.' };
    const [[a, b], [cc, d]] = w.pairs;
    const dotted = c.k >= 0 ? [cc, d] : [d, cc];
    const items = evidence(c, w, q);
    const verdict = items.some(e => e.code === 'k_none') ? { category: 'two-elements', level: 'wahrscheinlich', ranked: [{ category: 'two-elements', score: 4 }] } : decide(items, MAGNETIC);
    // Line reading (CMC / coupled inductor) and winding reading (transformer); both with the dotted ends as plus.
    const mappings = [
      { kind: 'line', pairs: [[a, dotted[0]], [b, dotted[1]]], text: 'Leitungen: Eingang P' + (a + 1) + '/P' + (dotted[0] + 1) + ', Ausgang P' + (b + 1) + '/P' + (dotted[1] + 1), en: 'Lines: input P' + (a + 1) + '/P' + (dotted[0] + 1) + ', output P' + (b + 1) + '/P' + (dotted[1] + 1) },
      { kind: 'winding', pairs: [[a, b], [dotted[0], dotted[1]]], text: 'Wicklungen: P' + (a + 1) + '–P' + (b + 1) + ' und P' + (dotted[0] + 1) + '–P' + (dotted[1] + 1) , en: 'Windings: P' + (a + 1) + '–P' + (b + 1) + ' and P' + (dotted[0] + 1) + '–P' + (dotted[1] + 1) }
    ];
    const recommended = verdict.category === 'transformer' ? 'winding' : 'line';
    const points = DECADES.map(f => nearest(dataset, idx, f)).filter(i => i >= 0);
    const table = points.map(i => {
      const m = modes(dataset, i, mappings[0].pairs[0], mappings[0].pairs[1]);
      return { f: dataset.freq[i], sdd21: dB2(db(m.sdd21)), scc21: dB2(db(m.scc21)), sdc21: dB2(db(m.sdc21)), scd21: dB2(db(m.scd21)), sdd11: dB2(db(m.sdd11)) };
    });
    let sdcMax = -Infinity;
    for (const i of idx) {
      if (dataset.freq[i] > Math.min(c.srf || Infinity, 1e8)) break;
      sdcMax = Math.max(sdcMax, db(modes(dataset, i, mappings[0].pairs[0], mappings[0].pairs[1]).sdc21));
    }
    const warnings = [];
    if (c.kQuality !== 'gut') warnings.push(T('Kopplungsfaktor nur ' + c.kQuality + ' bestimmbar: die Streureaktanz ist im 50-Ω-Messsystem sehr klein.', 'Coupling factor only ' + ({ 'eingeschränkt': 'partly', unsicher: 'uncertainly' }[c.kQuality] || c.kQuality) + ' determinable: the leakage reactance is very small in the 50 Ω system.'));
    if (!Number.isFinite(c.srf)) warnings.push(T('Keine Eigenresonanz im Messband; Kernverlust nur bis ' + fmtHz(q.fMax) + ' bewertet.', 'No self-resonance in the band; core loss assessed only up to ' + fmtHz(q.fMax, 'en') + '.'));
    return {
      status: 'candidate', kind: 'four-port', windings: w, verdict, evidence: items, mappings, recommended, warnings,
      features: {
        L1: round(c.L1), L2: round(c.L2), M: round(c.M), k: round(c.k, 5), kQuality: c.kQuality, kSpread: c.kSpread, kBand: c.band.map(v => round(v, 3)), kPoints: c.points,
        n: round(c.n, 4), R1: round(c.R1, 3), R2: round(c.R2, 3), rDc: round(c.rDc, 3), srf: round(c.srf, 4), tanMax: round(c.tanMax, 3), tanAt: round(c.tanAt, 3),
        qMax: round(c.qMax, 3), flat: round(c.flat, 3), sdcMax: dB2(sdcMax), modes: table
      },
      curves: c.rows.filter((_, j) => j % Math.max(1, Math.floor(c.rows.length / 120)) === 0).map(r => ({ f: r.f, L1: round(r.L1), L2: round(r.L2), k: round(r.k, 5), R1: round(r.R1) }))
    };
  }

  // ---------- two-pole elements (one-port, series or shunt two-port) ----------
  function elementImpedance(dataset, idx) {
    const n = dataset.n, z0 = dataset.refs[0];
    if (n === 1) return { topology: 'one-port', fit: 0, z: idx.map(i => { const s = get(dataset.samples[i], 1, 0, 0); return scale(div(add([1, 0], s), sub([1, 0], s)) || [NaN, NaN], z0); }) };
    let eSeries = [], eShunt = [];
    for (const i of idx) {
      const s = dataset.samples[i];
      const s11 = get(s, 2, 0, 0), s22 = get(s, 2, 1, 1), s21 = scale(add(get(s, 2, 1, 0), get(s, 2, 0, 1)), 0.5);
      eSeries.push((abs(sub(s11, sub([1, 0], s21))) + abs(sub(s22, sub([1, 0], s21)))) / 2);
      eShunt.push((abs(sub(s11, sub(s21, [1, 0]))) + abs(sub(s22, sub(s21, [1, 0])))) / 2);
    }
    const series = median(eSeries), shunt = median(eShunt);
    const topology = series <= 0.1 && series * 2 <= shunt ? 'series' : shunt <= 0.1 && shunt * 2 <= series ? 'shunt' : null;
    if (!topology) return { topology: null, fit: Math.min(series, shunt) };
    const z = idx.map(i => {
      const s = dataset.samples[i], s21 = scale(add(get(s, 2, 1, 0), get(s, 2, 0, 1)), 0.5);
      const zz = topology === 'series' ? div(scale(sub([1, 0], s21), 2 * z0), s21) : div(scale(s21, z0 / 2), sub([1, 0], s21));
      return zz || [NaN, NaN];
    });
    return { topology, fit: Math.min(series, shunt), z };
  }

  function analyzeTwo(dataset, idx, q) {
    const el = elementImpedance(dataset, idx);
    if (!el.topology) {
      return { status: 'candidate', kind: 'two-pole', topology: null, verdict: { category: 'other', level: 'unklar', ranked: [] },
        evidence: [{ code: 'no_element', text: 'Weder als Serien- noch als Querelement darstellbar (Restfehler ' + fd(el.fit, 2) + '); vermutlich Filter oder Leitung.', en: 'Neither a series nor a shunt element (residual ' + fe(el.fit, 2) + '); probably a filter or a line.', scores: {}, weight: 0 }], warnings: [] };
    }
    const f = idx.map(i => dataset.freq[i]);
    // Measurable impedance window of the fixture: series |Z| 0.1 Ω … 100 kΩ, shunt 0.025 Ω … 25 kΩ.
    const [lo, hi] = el.topology === 'shunt' ? [0.025, 2.5e4] : [0.1, 1e5];
    const pts = el.z.map((z, j) => ({ f: f[j], w: TAU * f[j], R: z[0], X: z[1], m: Math.hypot(z[0], z[1]) })).filter(p => Number.isFinite(p.m));
    const ok = pts.filter(p => p.m >= lo && p.m <= hi);
    if (ok.length < 5) return { status: 'insufficient-data', kind: 'two-pole', topology: el.topology, reason: 'Die Impedanz liegt fast überall außerhalb des messbaren Bereichs.', reasonEn: 'The impedance is outside the measurable range almost everywhere.' };
    const first = ok.slice(0, Math.max(5, Math.ceil(ok.length * 0.15)));
    // The element type is the reactance that first dominates the resistance; a part that stays resistive for two decades is a resistor.
    const cross = ok.findIndex((p, j) => Math.abs(p.X) > Math.abs(p.R) && ok.slice(j, j + 3).every(x => Math.sign(x.X) === Math.sign(p.X) && Math.abs(x.X) > Math.abs(x.R)));
    // A reactive element lets its reactance clearly dominate somewhere (|X| ≥ 3·|R|); a resistor's parasitic L or C only creeps in late.
    let dominant = false;
    if (cross >= 0) for (let j = cross; j < ok.length && Math.sign(ok[j].X) === Math.sign(ok[cross].X); j++) if (Math.abs(ok[j].X) >= 3 * Math.abs(ok[j].R)) { dominant = true; break; }
    const sign = cross >= 0 && (dominant || ok[cross].f <= 100 * ok[0].f) ? Math.sign(ok[cross].X) : 0;
    let srf = NaN;
    if (sign) for (let j = 1; j < pts.length; j++) if (Math.sign(pts[j - 1].X) === sign && Math.sign(pts[j].X) === -sign && pts[j].f > first[0].f) { srf = pts[j].f; break; }
    // Without a phase crossing, a lossy resonance still shows up as the reactance maximum; else the band end bounds the analysis.
    let top = srf;
    if (!Number.isFinite(top) && sign === 1) {
      const peak = pts.reduce((m, p) => p.X > m.X ? p : m, pts[0]);
      top = peak !== pts.at(-1) ? peak.f : pts.at(-1).f * 3;
    }
    if (!Number.isFinite(top)) top = pts.at(-1).f * 3;
    const items = [], features = { topology: el.topology, srf: round(srf, 4) };
    const addE = (code, text, scores, weight = 1) => items.push({ code, text: text.de, en: text.en, scores, weight });
    let classes;
    if (sign === 1) {
      const band = ok.filter(p => p.f <= 0.2 * top && p.X > 0);
      const L = median((band.length >= 3 ? band : ok.filter(p => p.X > 0).slice(0, 5)).map(p => p.X / p.w));
      const rDc = Math.max(1e-6, Math.min(...ok.slice(0, 3).map(p => p.R).filter(v => v > 0), Infinity));
      const below = ok.filter(p => p.f <= 0.5 * top && p.X > 0);
      // Güte only where the resistance is resolved (positive and above 1 % of |Z|); negative R at tiny |Z| is VNA noise.
      const qs = below.filter(p => p.R > 0.01 * p.m && p.m >= 1).map(p => p.X / p.R);
      const qMax = qs.length ? Math.max(...qs) : NaN;
      const tan = below.filter(p => p.X >= 1 && p.R > 0).map(p => Math.max(0, p.R - rDc) / p.X);
      const tanMax = tan.length ? Math.max(...tan) : NaN;
      const upper = below.filter(p => p.f <= 0.3 * top);
      const flat = upper.length >= 2 ? (upper.at(-1).X / upper.at(-1).w) / L : NaN;
      // Ferrite beads turn resistive well before their |Z| maximum; inductors stay reactive until close to the resonance.
      const inductiveFrom = ok.findIndex(p => p.X > p.R);
      const rx = inductiveFrom >= 0 ? ok.slice(inductiveFrom).find(p => p.f < top && p.R > p.X) : null;
      const resistiveSpan = rx ? top / rx.f : 1;
      Object.assign(features, { L: round(L), rDc: round(rDc, 3), qMax: round(qMax, 3), tanMax: round(tanMax, 3), flat: round(flat, 3), resistiveSpan: round(resistiveSpan, 3) });
      classes = ['coreless', 'ferrite-inductor', 'bead'];
      addE('inductive', T('Induktives Verhalten (+90°, |Z| steigt mit 20 dB/Dekade) bis ' + (Number.isFinite(srf) ? fmtHz(srf) : 'zum Bandende') + '.', 'Inductive behaviour (+90°, |Z| rises by 20 dB/decade) up to ' + (Number.isFinite(srf) ? fmtHz(srf, 'en') : 'the end of the band') + '.'), {}, 0);
      if (qMax < 3 || resistiveSpan >= 2) addE('lossy', T('Der Wirkanteil überwiegt ab ' + (rx ? fmtHz(rx.f) : '–') + ', deutlich unterhalb der Resonanz: Absorber-Verhalten wie bei Ferrit-Perlen.', 'Resistance dominates from ' + (rx ? fmtHz(rx.f, 'en') : '–') + ', well below resonance: absorber behaviour as in ferrite beads.'), { bead: 4, 'ferrite-inductor': -1, coreless: -3 });
      // A core shows up as falling L (permeability dispersion) or excess loss; a rising apparent L is only the winding capacitance.
      else if (qMax >= 30 && Number.isFinite(flat) && flat >= 0.95 && !(tanMax > 0.05)) addE('coreless', T('Kein Permeabilitätsabfall und kaum Zusatzverluste bis 0,3·SRF bei hoher Güte (Q bis ' + qMax.toFixed(0) + '): Luft- oder Keramikkern möglich.', 'No permeability roll-off and hardly any excess loss up to 0.3·SRF at high Q (up to ' + qMax.toFixed(0) + '): air or ceramic core possible.'), { coreless: 2.5, 'ferrite-inductor': -1, bead: -2 });
      else if (Number.isFinite(flat) && flat < 0.95) addE('core', T('Induktivität fällt bis 0,3·SRF um ' + Math.round((1 - flat) * 100) + ' %: Permeabilitätsabfall eines Kernmaterials.', 'Inductance falls by ' + Math.round((1 - flat) * 100) + ' % up to 0.3·SRF: permeability roll-off of a core material.'), { 'ferrite-inductor': 2, coreless: -1.5, bead: -0.5 });
      else addE('core', T('Frequenzabhängige Zusatzverluste (tan δ bis ' + (Number.isFinite(tanMax) ? fd(tanMax, 2) : '–') + '): Kernmaterial wahrscheinlich.', 'Frequency-dependent excess loss (tan δ up to ' + (Number.isFinite(tanMax) ? fe(tanMax, 2) : '–') + '): core material likely.'), { 'ferrite-inductor': 2, coreless: -1, bead: -0.5 });
      if (L > 10e-6) addE('l_large', T('Induktivität über 10 µH: ohne Kern kaum baubar.', 'Inductance above 10 µH: hardly feasible without a core.'), { 'ferrite-inductor': 1.5, coreless: -2.5 });
    } else if (sign === -1) {
      const band = ok.filter(p => p.f <= 0.2 * top && p.X < 0);
      const C = median((band.length >= 3 ? band : ok.filter(p => p.X < 0).slice(0, 5)).map(p => -1 / (p.w * p.X)));
      const near = pts.filter(p => p.f >= 0.5 * top && p.f <= 2 * top);
      const esr = near.length ? Math.min(...near.map(p => Math.abs(p.R))) : NaN;
      const above = pts.filter(p => p.f >= 3 * top && p.X > 0);
      const esl = above.length ? median(above.map(p => p.X / p.w)) : NaN;
      Object.assign(features, { C: round(C), esr: round(esr, 3), esl: round(esl, 3) });
      classes = ['capacitor'];
      addE('capacitive', T('Kapazitives Verhalten (−90°, |Z| fällt mit 20 dB/Dekade)' + (Number.isFinite(srf) ? ', Serienresonanz bei ' + fmtHz(srf) + ' (ESL)' : '') + '.', 'Capacitive behaviour (−90°, |Z| falls by 20 dB/decade)' + (Number.isFinite(srf) ? ', series resonance at ' + fmtHz(srf, 'en') + ' (ESL)' : '') + '.'), { capacitor: 4 });
    } else {
      const R = median(first.map(p => p.R));
      Object.assign(features, { R: round(R, 4) });
      classes = ['resistor'];
      addE('resistive', T('Phase nahe 0° über das untere Band: ohmsches Verhalten.', 'Phase near 0° across the lower band: resistive behaviour.'), { resistor: 4 });
    }
    const verdict = decide(items, classes.length > 1 ? classes : [classes[0], 'other']);
    if (classes.length === 1) Object.assign(verdict, { category: classes[0], level: 'wahrscheinlich' });
    // Inductive behaviour itself is certain even when the core type is not: report a plain inductor then.
    if (sign === 1 && verdict.level === 'unklar') {
      Object.assign(verdict, { category: 'inductor', level: 'wahrscheinlich' });
      addE('core_unknown', T('Kernart aus der Messung nicht bestimmbar (kein deutlicher Permeabilitätsabfall, keine eindeutigen Kernverluste).', 'Core type cannot be determined from the measurement (no clear permeability roll-off, no clear core loss).'), {}, 0);
    }
    return { status: 'candidate', kind: 'two-pole', topology: el.topology, fit: round(el.fit, 3), verdict, evidence: items, features, warnings: [] };
  }

  function fmtHz(f, lang = 'de') {
    if (!Number.isFinite(f)) return '–';
    const [d, u] = f >= 1e9 ? [1e9, 'GHz'] : f >= 1e6 ? [1e6, 'MHz'] : f >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz'];
    const text = String(+(f / d).toPrecision(3));
    return (lang === 'en' ? text : text.replace('.', ',')) + ' ' + u;
  }

  // ---------- public entry ----------
  function analyze(dataset, { metadata } = {}) {
    const vendor = metadata || dataset.vendor || null;
    const manufacturer = vendor ? { family: vendor.family || null, part: vendor.part || null, category: familyClass(vendor.family) } : null;
    const base = { version: VERSION, method: 'Y-Matrix-Zweigfit (komplex), Topologieprüfung', ports: dataset.n, manufacturer,
      provenance: dataset.version === 'SPICE' ? 'simulation' : 'measured' };
    if (![1, 2, 4].includes(dataset.n)) return { ...base, status: 'not-applicable', reason: 'Nur 1-, 2- und 4-Port-Dateien werden physikalisch klassifiziert.', reasonEn: 'Only 1-, 2- and 4-port files are classified physically.' };
    const idx = positiveIndices(dataset);
    const q = quality(dataset, idx);
    if (!q.refsValid) return { ...base, quality: q, status: 'insufficient-data', reason: 'Ungültige Bezugsimpedanzen.', reasonEn: 'Invalid reference impedances.' };
    if (idx.length < 12) return { ...base, quality: q, status: 'insufficient-data', reason: 'Zu wenige gültige Frequenzpunkte (' + idx.length + ').', reasonEn: 'Too few valid frequency points (' + idx.length + ').' };
    if (q.fMax / q.fMin < 30) return { ...base, quality: q, status: 'insufficient-data', reason: 'Das Frequenzband ist zu schmal (weniger als 1,5 Dekaden).', reasonEn: 'The frequency band is too narrow (less than 1.5 decades).' };
    const result = dataset.n === 4 ? analyzeFour(dataset, idx, q) : analyzeTwo(dataset, idx, q);
    const out = { ...base, quality: q, ...result };
    if (q.activePoints > q.points * 0.05) (out.warnings ||= []).push(T('An ' + q.activePoints + ' Frequenzpunkten ist die Matrix nicht passiv; Messfehler oder falsche Bezugsimpedanz möglich.', 'At ' + q.activePoints + ' frequency points the matrix is not passive; measurement error or wrong reference impedance possible.'));
    if (manufacturer?.category && out.verdict?.category && out.status === 'candidate') {
      const physical = out.verdict.category;
      const fits = physical === manufacturer.category || (manufacturer.category === 'inductor' && ['ferrite-inductor', 'coreless', 'inductor'].includes(physical));
      out.agreement = out.verdict.level === 'unklar' ? 'offen' : fits ? 'bestätigt' : 'widerspricht';
    }
    return out;
  }

  // Compact physics fingerprint for templates (numbers only, rounded).
  function fingerprint(result) {
    if (!result || result.status !== 'candidate' || !result.features) return null;
    const f = result.features;
    if (result.kind === 'four-port') {
      const at = key => DECADES.map(fr => f.modes.find(m => Math.abs(Math.log(m.f / fr)) < 0.5)?.[key] ?? null);
      return { v: 1, kind: 'm4', L1: f.L1, L2: f.L2, k: f.k, n: f.n, tan: f.tanMax, srf: f.srf, q: f.qMax, sdd21: at('sdd21'), scc21: at('scc21'), sdc21: at('sdc21'), scd21: at('scd21') };
    }
    return { v: 1, kind: 'p2', topo: result.topology, L: f.L ?? null, C: f.C ?? null, R: f.R ?? null, srf: f.srf, q: f.qMax ?? null, tan: f.tanMax ?? null };
  }

  // Distance between physics fingerprints in log space (0 = identical); null when not comparable.
  function distance(a, b) {
    if (!a || !b || a.kind !== b.kind) return null;
    const lg = (x, y, floor) => (Number.isFinite(x) && Number.isFinite(y)) ? Math.log10(Math.max(Math.abs(x), floor) / Math.max(Math.abs(y), floor)) : null;
    const parts = a.kind === 'm4'
      ? [lg(Math.sqrt(a.L1 * a.L2), Math.sqrt(b.L1 * b.L2), 1e-12), lg(1 - Math.min(Math.abs(a.k), 0.99999), 1 - Math.min(Math.abs(b.k), 0.99999), 1e-5), lg(a.tan, b.tan, 0.01), lg(a.srf, b.srf, 1), lg(a.n, b.n, 1) && 3 * lg(a.n, b.n, 1)]
      : [a.topo === b.topo ? 0 : 1, lg(a.L ?? a.C ?? a.R, b.L ?? b.C ?? b.R, 1e-15), lg(a.srf, b.srf, 1), lg(a.q, b.q, 0.1)];
    const valid = parts.filter(v => v !== null && Number.isFinite(v));
    if (valid.length < 2) return null;
    return Math.sqrt(valid.reduce((s, v) => s + v * v, 0) / valid.length);
  }

  // Device class implied by a free-text name (user label or template name); null if the name says nothing.
  function categoryFromName(name) {
    const t = String(name || '').toLowerCase();
    if (/doppeldrossel|coupled|gekoppelt|\bdd\b|we-dd|mcri|dual.?(power)?choke/.test(t)) return 'coupled';
    if (/\blan\b|übertrager|uebertrager|transformer|trafo/.test(t)) return 'transformer';
    if (/cmc|cmb|cnsw|common|gleichtakt|stromkomp/.test(t)) return 'cmc';
    if (/perle|bead/.test(t)) return 'bead';
    if (/luftspule|air.?coil|cair/.test(t)) return 'coreless';
    if (/kondensator|capacitor|mlcc|wcap/.test(t)) return 'capacitor';
    if (/widerstand|resistor/.test(t)) return 'resistor';
    if (/induktivit|inductor|spule|drossel|choke/.test(t)) return 'inductor';
    return null;
  }

  return { VERSION, LABEL, SHORT, LABEL_EN, SHORT_EN, label, MAGNETIC, analyze, fingerprint, distance, categoryFromName, familyClass, fmtHz };
})();
