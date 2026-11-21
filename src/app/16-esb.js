  // ---------- ESB tab: automatic choice between CMC, transformer and single component ----------
  const ESB_MODELS = [
    ['auto', 'Automatisch'], ['cmc', 'CMC · zwei Wicklungen'], ['transformer', 'Übertrager · T-Modell'],
    ['series', 'Bauteil · induktiv (L, Ferrit, Perle)'], ['shunt', 'Bauteil · kapazitiv (C, ESR, ESL)']
  ];
  // How the impedance of a two-pole is obtained (fixture) is a separate question from what the part is (L or C model).
  const ESB_FIXTURES = [['auto', 'Automatisch'], ['series', 'Serie · 2Z₀(1/S₂₁ − 1)'], ['shunt', 'Shunt · (Z₀/2)·S₂₁/(1 − S₂₁)'], ['reflection', 'Eintor · Z₀(1 + S₁₁)/(1 − S₁₁)']];
  const FIXTURE_NAME = { series: 'Serie', shunt: 'Shunt', reflection: 'Eintor' };
  const LEVEL_NAME = { sicher: 'sicher erkannt', wahrscheinlich: 'wahrscheinlich', unklar: 'nicht eindeutig' };
  const TRANSFORMER_FORMATS = [
    ['ocl', 'Hauptinduktivität L₁₁ · L₂₂'], ['leak', 'Streuinduktivität Lσ'], ['cap', 'Kapazität Cww · Cg'],
    ['r', 'Wicklungswiderstand'], ['z', '|Z₁₁| Leerlauf']
  ];
  const SERIES_FORMATS = [['z', '|Z| · R · Modell'], ['l', 'Induktivität L(f)'], ['c', 'Parallelkapazität C_p(f)']];
  const SHUNT_FORMATS = [['z', '|Z| · ESR'], ['c', 'Kapazität C(f)'], ['l', 'ESL L(f)']];
  const modelName = model => ESB_MODELS.find(([key]) => key === model)?.[1] ?? model;

  function detectModel() {
    if (!state.network) return { type: 'cmc', confidence: 0 };
    const pairs = selectedPairs();
    if (pairs) {
      return cache('classify:' + pairs.map(p => p.id).join(':'), () => {
        const view = getView('mm');
        const at = key => view.modes.findIndex(m => m.key === key);
        const [a, b] = pairs;
        const i = view.samples.findIndex(Boolean);
        if (i < 0) return { type: 'cmc', confidence: 0 };
        const s = view.samples[i], n = view.modes.length;
        const scc = RF.abs(RF.get(s, n, at('C' + b.id), at('C' + a.id)));
        const sdd = RF.abs(RF.get(s, n, at('D' + b.id), at('D' + a.id)));
        const result = RF.classify4(state.dataset.freq, scc, sdd);
        return { ...result, scc, sdd, f: state.dataset.freq[i] };
      });
    }
    // Four-port file without port pairs: the measured winding paths already say that this is a two-winding part.
    // The equivalent circuit needs the pairs, so the view offers to apply them instead of fitting a single inductor between P1 and P2.
    const four = windingPhysics();
    if (four) return { type: four.verdict.category === 'transformer' ? 'transformer' : 'cmc', confidence: 0, category: four.verdict.category, level: four.verdict.level || 'unklar', needsMapping: four };
    // One- and two-port files: the physics detection that already labels the part also picks the model,
    // so a capacitor is no longer treated as a series inductance just because that was the default.
    const physics = elementPhysics();
    if (physics) {
      const category = physics.verdict?.category, reactive = ['capacitor', 'inductor', 'coreless', 'ferrite-inductor', 'bead'].includes(category);
      return { type: category === 'capacitor' ? 'shunt' : 'series', confidence: 0, category, topology: physics.topology, level: reactive ? physics.verdict.level || 'unklar' : 'unklar' };
    }
    return { type: currentModes().length >= 1 ? 'series' : 'none', confidence: 0, level: 'unklar' };
  }

  function windingPhysics() {
    const physics = physicsOf(state.dataset);
    return physics?.kind === 'four-port' && physics.status === 'candidate' && physics.windings?.confidence === 'sicher' && physics.mappings?.length &&
      Magnetic.MAGNETIC.includes(physics.verdict?.category) ? physics : null;
  }
  function elementPhysics() {
    const physics = physicsOf(state.dataset);
    return physics?.kind === 'two-pole' && physics.status === 'candidate' ? physics : null;
  }

  function esbModel() {
    if (state.esb.model !== 'auto') return state.esb.model;
    const type = detectModel().type;
    return type === 'transformer' ? 'transformer' : type === 'none' ? 'series' : type;
  }

  // Fixture of a two-pole: chosen by the user, else taken from the measurement (S11 ≈ 1 − S21 is a series element,
  // S11 ≈ S21 − 1 a shunt element, a single port is a reflection measurement), else the classic pairing of the model.
  function esbFixture(kind) {
    if (ESB_FIXTURES.some(([key]) => key === state.esb.fixture && key !== 'auto')) return state.esb.fixture;
    if (currentModes().length < 2) return 'reflection';
    const topology = elementPhysics()?.topology;
    return topology === 'series' || topology === 'shunt' ? topology : kind;
  }

  function scaled(values, factor) {
    return Float64Array.from(values, v => Number.isFinite(v) ? v / factor : NaN);
  }

  function transformerData(pairs) {
    const view = getView('mm');
    const at = key => view.modes.findIndex(m => m.key === key);
    const [a, b] = pairs;
    const d = [at('D' + a.id), at('D' + b.id)], c = [at('C' + a.id), at('C' + b.id)];
    const n = view.modes.length;
    const refs = idx => idx.map(i => view.modes[i].ref);
    return cache('transformer:' + pairs.map(p => p.id).join(':') + ':' + state.esb.evalFreq, () => {
      const points = Array.from(state.dataset.freq, (f, i) => {
        const s = view.samples[i];
        return s ? RF.transformerPoint(RF.submatrix(s, n, d), refs(d), RF.submatrix(s, n, c), refs(c), f) : null;
      });
      const result = RF.analyzeTransformer(state.dataset.freq, points, state.esb.evalFreq);
      // Winding resistances and core loss from the differential Z matrix: Re Z11 and Re Z22 at the lowest frequencies,
      // Re Z11 at the open-circuit resonance (there the reactances cancel and the loss resistance remains).
      const fs = state.dataset.freq, zs = Array.from(fs, (f, i) => view.samples[i] ? RF.toZY(RF.submatrix(view.samples[i], n, d), refs(d), 'Z') : null);
      const valid = zs.map((z, i) => z && fs[i] > 0 ? i : -1).filter(i => i >= 0), head = valid.slice(0, Math.max(4, Math.ceil(valid.length * 0.03)));
      const low = k => RF.median(head.map(i => RF.get(zs[i], 2, k, k)[0]));
      let rfe = NaN;
      if (Number.isFinite(result.fres) && valid.length) { const at = valid.reduce((best, i) => Math.abs(fs[i] - result.fres) < Math.abs(fs[best] - result.fres) ? i : best, valid[0]); rfe = RF.get(zs[at], 2, 0, 0)[0]; }
      return { ...result, r1: low(0), r2: low(1), rfe, z: zs };
    });
  }

  function transformerView(pairs) {
    const t = transformerData(pairs), fmt = state.esb.tFormat, sr = t.series;
    const mk = (key, label, color, values, dash = null) => ({
      key: 'tr:' + key, label, color, values, dash, visible: !state.hiddenTraces.has('tr:' + key)
    });
    let traces, unit, yLabel, refLines = [], focus = null;
    const em = multiElement('transformer'), fs = state.dataset.freq;
    const mzs = em ? Array.from(fs, f => f > 0 ? RF.trafoModelZ(em.model, f) : null) : null;
    const zsc = z => RF.sub(RF.get(z, 2, 0, 0), RF.div(RF.mul(RF.get(z, 2, 0, 1), RF.get(z, 2, 1, 0)), RF.get(z, 2, 1, 1)));
    const model = (key, label, pick) => mzs ? [mk(key, label, '#c4622d', Float64Array.from(mzs, (z, i) => z ? pick(z, omega(fs[i])) : NaN), [2, 3])] : [];
    if (fmt === 'ocl') {
      traces = [mk('l11', 'L₁₁ · Sek. offen', MODE_PALETTE.dd[0], scaled(sr.l11, 1e-6)), mk('l22', 'L₂₂ · Prim. offen', MODE_PALETTE.dd[1], scaled(sr.l22, 1e-6), REFLECTION_DASH),
        ...model('ml11', 'Modell L₁₁', (z, w) => 1e6 * RF.get(z, 2, 0, 0)[1] / w), ...model('ml22', 'Modell L₂₂', (z, w) => 1e6 * RF.get(z, 2, 1, 1)[1] / w)];
      unit = 'µH'; yLabel = 'Induktivität [µH]';
      refLines = [{ value: t.ocl0 / 1e-6, color: '#c4622d', label: 'OCL₀ ' + display(t.ocl0 / 1e-6) + ' µH' }];
      focus = t.ocl0 > 0 ? [-t.ocl0 / 1e-6, 2 * t.ocl0 / 1e-6] : null;
    } else if (fmt === 'leak') {
      traces = [mk('lsc', 'Lσ · Sek. kurzgeschl.', MODE_PALETTE.dc[0], scaled(sr.lsc, 1e-9)), ...model('mlsc', 'Modell Lσ', (z, w) => 1e9 * zsc(z)[1] / w)];
      unit = 'nH'; yLabel = 'Streuinduktivität [nH]';
      refLines = [{ value: t.leak / 1e-9, color: '#c4622d', label: 'Lσ ' + display(t.leak / 1e-9) + ' nH' }];
      focus = t.leak > 0 ? [-t.leak / 1e-9, 3 * t.leak / 1e-9] : null;
    } else if (fmt === 'cap') {
      traces = [mk('cww', 'Cww · Prim.↔Sek.', MODE_PALETTE.cc[0], scaled(sr.cww, 1e-12)), mk('cpar', 'C_par(f) = 1/(ω²L) − 1/(ωX₁₁)', MODE_PALETTE.dd[0], scaled(sr.cpar, 1e-12))];
      unit = 'pF'; yLabel = 'Kapazität [pF]';
      refLines = [{ value: t.cww / 1e-12, color: '#c4622d', label: 'Cww ' + display(t.cww / 1e-12) + ' pF' },
        { value: t.cres / 1e-12, color: '#3266ce', label: 'C_res ' + display(t.cres / 1e-12) + ' pF' }];
      focus = focusAround([t.cww / 1e-12, t.cres / 1e-12], 0.5, 1.5);
    } else if (fmt === 'r') {
      traces = [mk('rsc', 'R · Sek. kurzgeschl.', MODE_PALETTE.cd[0], scaled(sr.rsc, 1)), ...model('mrsc', 'Modell R', z => zsc(z)[0])];
      unit = 'Ω'; yLabel = 'Widerstand [Ω]';
    } else {
      traces = [mk('z11', '|Z₁₁| · Sek. offen', MODE_PALETTE.dd[0], scaled(sr.z11, 1)), ...model('mz11', 'Modell |Z₁₁|', z => RF.abs(RF.get(z, 2, 0, 0)))];
      unit = 'Ω'; yLabel = '|Z| [Ω]';
    }
    const k = Math.abs(t.k);
    const details = () => '<section class="detail-card"><div class="fit-summary"><h3>Übertrager · Ersatzschaltbild</h3><small>' +
      esc('Paar ' + pairs[0].id + ' → Paar ' + pairs[1].id + ' · OCL bei ' + hz(t.fEval)) + '</small></div><div class="metric-grid">' +
      metric('OCL · L₁₁ bei ' + hz(t.fEval), t.ocl * 1e6, 'µH') + metric('OCL₀ · LC-Fit unterhalb f_res', t.ocl0 * 1e6, 'µH') +
      metric('L₂₂ · Sekundär', t.l22 * 1e6, 'µH') + metric('n · √(L₂₂/L₁₁)', t.n, '') +
      metric('|k| · M/√(L₁₁L₂₂)' + (t.k < 0 ? ' · Polarität invertiert' : ''), k, '') +
      metric('Lσ · Streuung, Sek. kurzgeschl.', t.leak * 1e9, 'nH') + metric('Cww · Wicklung↔Wicklung', t.cww * 1e12, 'pF') +
      metric('R · Prim.+Sek. bei tiefer f', t.rdc, 'Ω') +
      '<div class="metric"><strong>' + esc(Number.isFinite(t.fres) ? hz(t.fres) : '—') + '</strong><span>f_res · Leerlauf-Eigenresonanz</span></div>' +
      metric('C_par · Wicklungskapazität (Fit)', t.cpar * 1e12, 'pF') + metric('C_res · Thomson 1/((2π·f_res)²·L)', t.cres * 1e12, 'pF') + '</div>' +
      '<p class="diagnostics">' + esc('Lσ-Plateau ' + (t.leakBand ? hz(t.leakBand[0]) + ' – ' + hz(t.leakBand[1]) : '—') +
        ' · Vertrauen ' + Math.round(100 * t.leakConf) + ' % · Cww-Band ' + (t.cwwBand ? hz(t.cwwBand[0]) + ' – ' + hz(t.cwwBand[1]) : '—')) + '</p>' +
      '<p class="note">Kleinsignalwerte aus S-Parametern ohne DC-Bias. Datenblätter messen OCL oft mit Gleichstrom-Vormagnetisierung (z. B. 100 kHz, 100 mV, 8–18 mA), Abweichungen sind deshalb normal. ' +
      'Formeln: OCL = Im Z₁₁/ω · Lσ = Im(Z₁₁ − Z₁₂Z₂₁/Z₂₂)/ω · Cww = −Im Y₁₂(CC)/ω · ω/X = 1/L − ω²C. ' + help + '</p></section>' +
      transformerSchematic(pairs, em?.edited ? { ...t, leakMeasured: t.leak, leak: trafoLowLeak(em.model), ocl: em.model.lm + trafoLowLeak(em.model) / 2, lse: em.model.lse, rse: em.model.rse, n: em.model.n, r1: em.model.rpri, r2: em.model.rsec,
        rfe: em.model.rfe, cpar: em.model.cp, cp2: em.model.cp2, cres: NaN, cww: (em.model.cwa || 0) + (em.model.cwx || 0) } : t, !!em?.edited) +
      (em ? modelEditor(em) : '<section class="detail-card" id="model-missing"><div class="fit-summary"><h3>Modell-Editor</h3><small>Für das Modell fehlen positive Werte für OCL, Streuung oder Übersetzung.</small></div></section>');
    return { traces, unit, yLabel, title: 'Übertrager', caption: 'Paar ' + pairs[0].id + ' → Paar ' + pairs[1].id + ' · T-Ersatzschaltbild' + (em ? ' · Modell aus dem Editor gepunktet' : ''), native: '', positive: fmt === 'z', signed: fmt !== 'z' && fmt !== 'r', refLines, focus, details,
      fitBand: em && fmt !== 'cap' ? em.band : null };
  }

  function elementData(kind) {
    const view = getView(), settings = state.esb, fixture = esbFixture(kind);
    let a = view.modes.findIndex(m => m.key === settings.input);
    const b = view.modes.findIndex(m => m.key === settings.output);
    if (fixture === 'reflection') {
      if (a < 0) a = view.modes.length ? 0 : -1;
      if (a < 0) return null;
    } else if (a < 0 || b < 0 || a === b) return null;
    return cache('element:' + state.basis + ':' + kind + ':' + fixture + ':' + a + ':' + b, () => {
      const n = view.modes.length;
      const z = Array.from(state.dataset.freq, (_, i) => {
        const s = view.samples[i];
        if (!s) return null;
        if (fixture === 'reflection') return RF.reflection(RF.get(s, n, a, a), view.modes[a].ref);
        const two = RF.twoPort(s, view.modes, a, b);
        return two.s && RF.transmission(RF.get(two.s, 2, 1, 0), two.ref, fixture);
      });
      return { z, result: RF.analyzeElement(state.dataset.freq, z, kind), from: view.modes[a], to: fixture === 'reflection' ? view.modes[a] : view.modes[b], fixture };
    });
  }

