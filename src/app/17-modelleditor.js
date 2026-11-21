  // ---- Model editor: the automatic fit is the start. Values can be typed, dragged, fixed, taken from a marker and
  // re-optimised inside a fit window. The measurement itself is never changed; only the model moves. ----
  const MODEL_LABELS = {
    r0: ['R₀ · Serienwiderstand', 'Ω'], l1: ['L₁ · Hauptinduktivität', 'H'], c1: ['C₁ · Parallelkapazität', 'F'], r1: ['R₁ · Verluste der 1. Resonanz', 'Ω'],
    l2: ['L₂ · zweiter Kreis', 'H'], c2: ['C₂ · zweiter Kreis', 'F'], r2: ['R₂ · Verluste der 2. Resonanz', 'Ω'],
    c: ['C · Kapazität', 'F'], esr: ['ESR · Serienwiderstand', 'Ω'], esl: ['ESL · Serieninduktivität', 'H'], rp: ['R_p · Isolationswiderstand', 'Ω'],
    m: ['M · Gegeninduktivität', 'H'], ls: ['Lσ · Streuung je Wicklung', 'H'], rls: ['R_σ · Verluste der Streuung, parallel zu Lσ', 'Ω'], m2: ['M₂ · Kernglied 2', 'H'], rfe2: ['R_Fe2 · Verluste Kernglied 2', 'Ω'], m3: ['M₃ · Kernglied 3', 'H'], rfe3: ['R_Fe3 · Verluste Kernglied 3', 'Ω'], rw: ['R_w · Serienwiderstand je Wicklung', 'Ω'], rfe: ['R_Fe · Kernverluste', 'Ω'],
    ct: ['Ct · über jeder Wicklung', 'F'], cw: ['Cw · zwischen den Wicklungen je Seite', 'F'], cx: ['Cx · diagonal, Eingang + zu Ausgang −', 'F'], cg: ['Cg · je Anschluss gegen Masse', 'F'],
    lm: ['L_m · Hauptinduktivität', 'H'], lst: ['Lσ · Streuung, primärbezogen', 'H'], lse: ['Lσ_e · Streuanteil, den Wirbelströme bei hoher Frequenz verdrängen', 'H'], rse: ['R_e · Wirbelstromverluste, parallel zu Lσ_e', 'Ω'], n: ['n · Übersetzung 1 : n', ''], rpri: ['R₁ · Primärwicklung', 'Ω'], rsec: ['R₂ · Sekundärwicklung', 'Ω'],
    cp: ['C_p · über der Primärwicklung', 'F'], cp2: ['C_p2 · über der Sekundärwicklung', 'F'], cwa: ['Cwa · Wicklung zu Wicklung, gleichnamige Anschlüsse', 'F'], cwx: ['Cwx · Wicklung zu Wicklung, über Kreuz', 'F']
  };
  const modelText = (value, unit) => unit ? si(value, unit) : display(value);
  function parseSI(text) {
    const m = String(text ?? '').trim().replace(',', '.').replace(/\s+/g, '').match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(f|p|n|µ|μ|u|m|k|K|M|G)?(?:H|F|Ω|Ohm|ohm|R)?$/);
    if (!m) return NaN;
    return Number(m[1]) * ({ f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, 'μ': 1e-6, u: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1);
  }
  const blankEdit = () => ({ values: null, fixed: [], band: null });
  function esbEdit(kind) {
    if (!state.esb.edit || typeof state.esb.edit !== 'object') state.esb.edit = {};
    const edit = state.esb.edit[kind];
    if (!edit || typeof edit !== 'object' || !Array.isArray(edit.fixed)) state.esb.edit[kind] = blankEdit();
    return state.esb.edit[kind];
  }
  const trafoLowLeak = model => model.lst + (model.lse > 0 && model.rse > 0 ? model.lse : 0);
  const modelStructure = model => model.type === 'cmc' ? 'je Wicklung R_w + ' + (Number.isFinite(model.rls) && model.rls > 0 ? '(Lσ ∥ R_σ)' : 'Lσ') + ' + ' + (RF.coreSections(model).length > 1 ? RF.coreSections(model).length + ' Kernglieder (M_k ∥ R_Fe,k)' : '(M ∥ R_Fe)') + ' · Ct · Cw · Cx · Cg'
    : model.type === 'trafo' ? 'C_p ∥ [R₁ + ' + (model.lse > 0 && model.rse > 0 ? '(Lσ + Lσ_e ∥ R_e)/2' : 'Lσ/2') + ' + (L_m ∥ R_Fe) · 1 : n · n²(…) + R₂] ∥ C_p2 · Cwa · Cwx'
    : model.type === 'rlc' ? 'ESR + ESL + C' + (Number.isFinite(model.rp) && model.rp > 0 ? ' ∥ R_p' : '')
    : 'R₀ + (L₁ ∥ C₁ ∥ R₁)' + (model.tanks[1] ? model.tanks[1].c > 0 ? ' + (L₂ ∥ C₂ ∥ R₂)' : ' + L₂' : '');

  function elementModel(kind, data) {
    const freq = state.dataset.freq;
    if (!('auto' in data)) {
      data.auto = kind === 'series' ? (data.result.model ? { type: 'tanks', ...data.result.model } : null) : RF.fitCapacitor(freq, data.z);
      const valid = Array.from(freq, (f, i) => f > 0 && data.z[i] && Number.isFinite(data.z[i][0]) && Number.isFinite(data.z[i][1]) ? f : NaN).filter(Number.isFinite);
      data.span = [valid[0], valid.at(-1)];
    }
    const auto = data.auto;
    if (!auto) return null;
    const edit = esbEdit(kind);
    const model = edit.values ? RF.modelWith(auto, edit.values) : auto;
    const natural = [data.span[0], Math.min(data.span[1], auto.fMax ?? data.span[1])];
    const band = Array.isArray(edit.band) && edit.band[1] > edit.band[0] ? edit.band : natural;
    return { kind, auto, model, band, natural, quality: RF.modelQuality(freq, data.z, model, band), edit, edited: !!edit.values, data };
  }
  // CMC and transformer: the start values are the ones the analysis above already shows, so the editor begins with the
  // circuit drawn in the schematic. A value the analysis cannot give (not positive) starts as a small placeholder and is named.
  // Start values of the CMC model, taken where each element shows itself and independent of the fit band above:
  // 2M + Lσ and Lσ from the plateaus of the modal inductances well below each mode's first resonance (a high-permeability
  // core loses inductance towards its resonance, so a wide LC fit is no good guide); the modal capacitances from the
  // common mode well above its resonance, from the differential resonance and from the two purely capacitive modes.
  // The four modal capacitances then give C_g, C_w, C_t and C_x without any of them having to turn negative.
  function cmcStart(pairs, loss, need) {
    const fs = state.dataset.freq, natural = naturalData(pairs), ok = v => Number.isFinite(v) && v > 0;
    const fcm = selfResonance(natural, 'h'), fdm = selfResonance(natural, 'd'), last = fs.at(-1);
    const within = (lo, hi, pick) => RF.median(Array.from(fs, (f, i) => f >= lo && f <= hi && natural[i] ? pick(natural[i], omega(f)) : NaN));
    const perWinding = y => RF.div([2, 0], y);
    const topCm = ok(fcm) ? fcm / 5 : last / 30, topDm = ok(fdm) ? fdm / 5 : last / 30;
    const lcm = within(topCm / 30, topCm, (n, w) => perWinding(n.h)[1] / w), ls = within(topDm / 30, topDm, (n, w) => perWinding(n.d)[1] / w);
    if (!ok(lcm) || !ok(ls) || !(lcm > ls)) return null;
    const capLo = ok(fcm) ? 10 * fcm : last / 100, capHi = ok(fdm) ? Math.max(fdm / 2, 2 * capLo) : last;
    const cg = within(capLo, capHi, n => n.cg), line = within(capLo, capHi, n => n.cw);           // line = C_w + C_x
    const across = (within(capLo, capHi, (n, w) => n.h[1] / w) - cg) / 2;                          // C_t + C_x
    const turn = ok(fdm) ? (2 / (omega(fdm) ** 2 * ls) - cg) / 2 : NaN;                            // C_t + C_w
    let cw = (line + turn - across) / 2, cx = (line + across - turn) / 2, ct = (across + turn - line) / 2;
    if (![cw, cx, ct].every(ok)) { cx = NaN; cw = line; ct = [across, turn - line].find(ok) ?? NaN; }
    // Series resistance from the differential mode far below its resonance (where ωLσ is small), R_σ from the rise of the
    // differential resistance above that: R_D − R_w = (ωLσ)²/R_σ. Without a rise R_σ starts high (≈ 30·ωLσ at the resonance).
    const rd = (n, w) => perWinding(n.d)[0];
    const rw = [within(topDm / 3000, topDm / 30, rd), loss.rw].find(ok);
    const rls = ok(rw) ? within(topDm / 10, topDm, (n, w) => { const extra = rd(n, w) - rw; return extra > 0.2 * rw ? (w * ls) ** 2 / extra : NaN; }) : NaN;
    return { type: 'cmc', m: (lcm - ls) / 2, ls, rls: ok(rls) ? rls : ok(fdm) ? 30 * omega(fdm) * ls : NaN, rw: need('rw', rw, 0.01), rfe: ok(loss.rfe) ? loss.rfe : NaN,
      ct: need('ct', ct, 1e-13), cw: need('cw', cw, 1e-13), cx, cg: need('cg', cg, 1e-13) };
  }
  function multiData(kind, pairs) {
    const freq = state.dataset.freq, id = pairs.map(p => p.id).join(':');
    if (kind === 'cmc') {
      const band = state.cmc.band;
      return cache('multi:cmc:' + id + ':' + band.join(':'), () => {
        const [cmB, dmB] = modalCispr(pairs).blocks, guessed = [];
        const nat = naturalData(pairs), active = state.layout.active, view = getView('se');
        const refs = pairs.flatMap(pair => [pair.p, pair.q]).map(port => view.modes[active.indexOf(port)]?.ref).filter(Number.isFinite);
        const meas = { y: nat.map(n => n?.y ?? null), ref: refs.length ? refs.reduce((a, b) => a + b, 0) / refs.length : 50,
          cm: cmB.map(b => b?.z ?? null), dm: dmB.map(b => b?.z ?? null), refCm: cmB.find(Boolean)?.ref ?? 25, refDm: dmB.find(Boolean)?.ref ?? 100 };
        const fit = cache('fit:' + id + ':' + band.join(':'), () => RF.fitCMC(freq, naturalData(pairs), ...band)), loss = cmcLoss(pairs);
        const need = (key, value, fallback) => { if (value > 0 && Number.isFinite(value)) return value; guessed.push(key); return fallback; };
        const auto = cmcStart(pairs, loss, need);
        const valid = Array.from(freq, (f, i) => f > 0 && meas.y[i] ? f : NaN).filter(Number.isFinite);
        // The lumped model holds up to somewhat above the differential-mode resonance; above it further resonances follow.
        const fdm = selfResonance(nat, 'd'), top = Number.isFinite(fdm) ? 2 * fdm : Infinity;
        return { meas, auto, guessed, prior: {}, span: [valid[0], valid.at(-1)], natural: [Math.max(band[0], valid[0] ?? band[0]), Math.min(band[1], valid.at(-1) ?? band[1], top)] };
      });
    }
    const t = transformerData(pairs);
    return cache('multi:trafo:' + id + ':' + state.esb.evalFreq, () => {
      const guessed = [], need = (key, value, fallback) => { if (value > 0 && Number.isFinite(value)) return value; guessed.push(key); return fallback; };
      const cp = t.cpar > 0 ? t.cpar : t.cres;
      let auto = t.ocl > 0 && t.leak > 0 && t.n > 0 && t.ocl > t.leak / 2 ? { type: 'trafo', lm: t.ocl - t.leak / 2, lst: t.leak, n: t.n, rpri: need('rpri', t.r1, 0.01), rsec: need('rsec', t.r2, 0.01),
        rfe: t.rfe > 0 ? t.rfe : NaN, cp: cp > 0 ? cp : NaN, cp2: NaN, cwa: t.cww > 0 ? t.cww / 2 : NaN, cwx: t.cww > 0 ? t.cww / 2 : NaN, flip: t.k < 0 } : null;
      const valid = Array.from(freq, (f, i) => f > 0 && t.z[i] ? f : NaN).filter(Number.isFinite);
      // Natural modes in the basis of the start values (fixed for every fit, see RF.trafoBasis). Mode σ (leakage) stays inductive
      // up to its own resonance, far above the open-circuit one; that resonance is where C_wa shows, so the fit window reaches past
      // it (1.2 × f_σ). Without it found (above the data): up to 10 × the open-circuit resonance – mode M is a clean capacitance
      // well above its resonance, and mode σ approaching its own resonance already carries the capacitances.
      const basis = auto ? RF.trafoBasis(auto.n, auto.flip) : null;
      const modes = basis ? Array.from(freq, (f, i) => f > 0 && t.z[i] ? RF.trafoCurves(t.z[i], basis) : null) : [];
      const at = (lo, hi, fn) => RF.median(modes.map((m, i) => m && freq[i] >= lo && freq[i] <= hi ? fn(m, omega(freq[i]), freq[i]) : NaN).filter(Number.isFinite));
      let fLeak = NaN;
      if (Number.isFinite(t.fres)) for (let i = 1; i < freq.length; i++) {
        const a = modes[i - 1]?.[1], b = modes[i]?.[1];
        if (a && b && freq[i] > 2 * t.fres && a[1] > 0 && b[1] <= 0) { fLeak = freq[i]; break; }
      }
      // Start capacitances from the modes: C_aa and C_ab above the open-circuit resonance (where mode M is a capacitance),
      // C_bb from the leakage resonance and the leakage inductance of mode σ below it, C_ww from the common mode. The projection
      // back gives C₁₁ = C_p + C_ww/4, C₂₂ = C_p2 + C_ww/4, C₁₂ = (C_wx − C_wa)/4.
      let cbb = NaN;
      if (auto && Number.isFinite(fLeak) && t.cww > 0) {
        const lo = 3 * t.fres, hi = fLeak / 3, caa = at(lo, hi, (m, w) => RF.div([1, 0], m[0])[1] / w), cab = at(lo, hi, (m, w) => RF.div([1, 0], m[2])[1] / w);
        const lb = at(fLeak / 8, fLeak / 4, (m, w, f) => m[1][1] / w * (1 - (f / fLeak) ** 2));
        cbb = lb > 0 ? 1 / (omega(fLeak) ** 2 * lb) : NaN;
        if ([caa, cab, cbb].every(Number.isFinite)) {
          // the mode capacitances are the forms xᵀCy of the basis vectors: C = P⁻ᵀ·[[C_aa, C_ab], [C_ab, C_bb]]·P⁻¹ with P = [a b]
          const { a, b } = basis, det = a[0] * b[1] - b[0] * a[1], Q = [[b[1] / det, -b[0] / det], [-a[1] / det, a[0] / det]]; // Q = P⁻¹
          const Mx = [[caa, cab], [cab, cbb]], c = (i, j) => Q[0][i] * (Mx[0][0] * Q[0][j] + Mx[0][1] * Q[1][j]) + Q[1][i] * (Mx[1][0] * Q[0][j] + Mx[1][1] * Q[1][j]), own = t.cww / 4;
          const start = { cp: c(0, 0) - own, cp2: c(1, 1) - own, cwx: (t.cww + 4 * c(0, 1)) / 2, cwa: (t.cww - 4 * c(0, 1)) / 2 };
          const floor = 0.02 * t.cww;
          auto = { ...auto, ...Object.fromEntries(Object.entries(start).map(([key, v]) => [key, v > floor ? v : floor])) };
        }
      }
      if (auto && !(auto.cp2 > 0)) auto.cp2 = auto.cp > 0 ? auto.cp / 10 : NaN;
      // Eddy-current part of the leakage: the inductance of mode σ (C_bb removed) falls from its value far below the leakage
      // resonance (f_σ/3000 … f_σ/1000) to a lower one near it (f_σ/4 … f_σ/2.5). Their ratio ρ splits the measured leakage into
      // Lσ_∞ = ρ·Lσ and Lσ_e = (1 − ρ)·Lσ; R_e = 2π·f_c·Lσ_e with f_c where the inductance is halfway. Below 5 % fall: no rung.
      if (auto && Number.isFinite(fLeak) && cbb > 0) {
        const lOf = (m, w) => { const y = RF.sub(RF.div([1, 0], m[1]), [0, w * cbb]); return RF.div([1, 0], y)[1] / w; };
        const low = at(fLeak / 3000, fLeak / 1000, lOf), high = at(fLeak / 4, fLeak / 2.5, lOf), rho = high / low;
        if (low > 0 && high > 0 && rho < 0.95) {
          const half = (low + high) / 2;
          let fc = NaN;
          for (let i = 0; i < freq.length && !Number.isFinite(fc); i++) if (modes[i] && freq[i] > fLeak / 1000 && lOf(modes[i], omega(freq[i])) < half) fc = freq[i];
          if (Number.isFinite(fc)) auto = { ...auto, lst: rho * auto.lst, lse: (1 - rho) * auto.lst, rse: RF.TAU * fc * (1 - rho) * auto.lst };
        }
      }
      const top = Number.isFinite(fLeak) ? Math.min(valid.at(-1), 1.2 * fLeak) : Number.isFinite(t.fres) ? Math.min(valid.at(-1), 10 * t.fres) : valid.at(-1);
      return { meas: { z: t.z, basis }, auto, guessed, prior: {}, priorSum: { keys: ['cwa', 'cwx'], value: t.cww }, span: [valid[0], valid.at(-1)], natural: [valid[0], top], fLeak };
    });
  }
  function multiElement(kind) {
    const pairs = selectedPairs();
    if (!pairs) return null;
    const data = multiData(kind, pairs);
    if (!data.auto) return null;
    // The number of core sections is part of the structure: the edited values are laid onto a model with that many sections.
    const edit = esbEdit(kind), sections = kind === 'cmc' && [2, 3].includes(edit.sections) ? edit.sections : 1;
    const base = sections > 1 ? RF.cmcSections(data.auto, sections) : data.auto, model = edit.values ? RF.modelWith(base, edit.values) : base;
    const band = Array.isArray(edit.band) && edit.band[1] > edit.band[0] ? edit.band : data.natural;
    return { kind, multi: true, auto: data.auto, model, band, natural: data.natural, quality: RF.multiQuality(state.dataset.freq, data.meas, model, band), edit, edited: !!edit.values, data, pairs };
  }
  const currentElement = () => {
    const kind = esbModel();
    if (kind === 'cmc' || kind === 'transformer') return state.cmc.format === 'zfit' && kind === 'cmc' ? null : multiElement(kind);
    if (kind !== 'series' && kind !== 'shunt') return null;
    const data = elementData(kind);
    return data ? elementModel(kind, data) : null;
  };
  const PART_NAMES = { g: 'Mode G', v: 'Mode V', h: 'Mode H', d: 'Mode D', m: 'Mode M', s: 'Mode σ', x: 'Mode M–σ' };
  const modelSummary = em => 'Gültig von ' + hz(em.quality.band[0]) + ' bis ' + hz(em.quality.band[1]) + ' · Abweichung ' + display(em.quality.err) + ' dB und ' + display(em.quality.phase) + '° RMS · ' +
    em.quality.points + ' Punkte' + (em.multi ? ' · ' + Object.entries(em.quality.parts).map(([key, part]) => PART_NAMES[key] + ' ' + display(part.err) + ' dB').join(' · ') : '') +
    (em.edited ? ' · von Hand geändert' : em.model.type === 'cmc' ? ' · Startwerte aus Plateaus und Resonanzen' : em.multi ? ' · Werte aus der Auswertung oben' : ' · automatischer Fit');

  // How firmly the measurement fixes each free parameter of a four-terminal model (RF.multiSpread, scaled by the present residual).
  const SPREAD_TEXT = { good: 'gut bestimmt', weak: 'schwach bestimmt', none: 'nicht bestimmt', fixed: 'fest' };
  function modelSpread(em) {
    if (!em.multi) return null;
    const values = RF.modelParams(em.model).map(p => p.key + '=' + p.value.toPrecision(6)).join(',');
    return cache('spread:' + em.kind + ':' + values + ':' + em.edit.fixed.join(',') + ':' + em.band.join(':'), () => RF.multiSpread(state.dataset.freq, em.data.meas, em.model, { fixed: em.edit.fixed, band: em.band }));
  }
  const RW_NOTE = ' ist der gesamte Serienwiderstand, den die Messung zeigt. Liegt er weit über dem Gleichstromwiderstand aus dem Datenblatt, stammt der Rest aus der Messanordnung (Kontakte, Reste der Fixture), nicht aus der Wicklung. Für ein Bauteilmodell den Datenblattwert eintragen und „fest“ setzen; die Abweichung im Gegentakt steigt dann.';
  // Result of "Anzahl prüfen": deviation per number of core sections and the number the measurement carries.
  function sectionReport(em) {
    const report = em.edit.sectionReport;
    if (!report || !Array.isArray(report.fits)) return '';
    return '<p class="note" id="model-sections-report" data-best="' + report.best + '"><span>Prüfung der Kernglieder im Fitfenster:</span> ' +
      report.fits.map(f => '<span>' + esc(f.count + (f.count === 1 ? ' Glied: ' : ' Glieder: ') + display(f.err) + ' dB' + (f.distinct ? '' : ' (nicht getrennt)')) + '</span>').join(' · ') +
      '. <span>' + esc('Die Messung trägt ' + report.best + (report.best === 1 ? ' Kernglied.' : ' Kernglieder.')) + '</span> <span>Ein weiteres Glied zählt nur, wenn es die gewichtete Abweichung um mindestens 10 % senkt und eine eigene Zeitkonstante behält (mindestens Faktor 2 Abstand); sonst teilt der Fit nur eine Relaxation auf, die die Messung nicht unterscheiden kann.</span></p>';
  }
  function spreadNote(em, spread) {
    const none = Object.entries(spread || {}).filter(([, s]) => RF.spreadClass(s) === 'none').map(([key]) => MODEL_LABELS[key][0].split(' · ')[0]);
    const rw = em.model.type === 'cmc' && spread && RF.spreadClass(spread.rw) !== 'none' && em.model.rw > 0.1;
    return '<p class="note" id="model-spread-note"><span>Die Spalte rechts zeigt, wie fest die Messung im Fitfenster jeden freien Wert legt: schlicht = gut bestimmt (≤ ± 10 %), farbig umrandet = schwach (≤ ± 100 %), farbig hinterlegt = nicht bestimmt.</span>' +
      (none.length ? ' <span id="model-spread-none">Nicht bestimmt: ' + esc(none.join(', ')) + '.</span>' : '') + (rw ? ' <span id="model-rw-note">' + esc('R_w = ' + si(em.model.rw, 'Ω') + RW_NOTE) + '</span>' : '') + '</p>';
  }
  function spreadBadge(spread, key) {
    const s = spread[key], kind = RF.spreadClass(s);
    const text = kind === 'fixed' ? 'fest' : Number.isFinite(s) ? '± ' + (s >= 9.995 ? '>999' : display(Number((100 * s).toPrecision(2)))) + ' %' : '± ∞';
    return '<span class="model-spread spread-' + kind + '" data-spread="' + kind + '" title="' + esc(SPREAD_TEXT[kind] + (kind === 'fixed' ? '' : ': so weit kann sich der Wert ändern, während die übrigen ausgleichen. Richtwert, kein Vertrauensintervall.')) + '">' + esc(text) + '</span>';
  }
  function modelEditor(em) {
    const base = Object.fromEntries(RF.modelParams(em.auto).map(p => [p.key, p.value])), spread = modelSpread(em);
    const rows = RF.modelParams(em.model).map(({ key, value }) => {
      const [label, unit] = MODEL_LABELS[key];
      const pos = Math.max(-100, Math.min(100, Math.round(100 * Math.log10(value / (base[key] ?? value)))));
      return '<div class="model-row' + (em.multi ? ' no-marker' : '') + '" data-key="' + key + '"><label for="model-' + key + '">' + esc(label) + '</label>' +
        '<input class="field-input mono" id="model-' + key + '" name="' + key + '" value="' + esc(modelText(value, unit)) + '" autocomplete="off" spellcheck="false" data-unit="' + unit + '">' +
        '<input type="range" class="model-slider" min="-100" max="100" step="1" value="' + pos + '" data-key="' + key + '" data-base="' + (base[key] ?? value) + '" aria-label="' + esc(label) + ' verstellen" title="Eine Dekade nach unten und oben um den automatischen Wert">' +
        '<label class="model-fix" title="Beim Optimieren festhalten"><input type="checkbox" name="fix-' + key + '"' + checked(em.edit.fixed.includes(key)) + '><span>fest</span></label>' +
        (em.multi ? spreadBadge(spread || {}, key) : actionButton('M', 'model-marker', key, 'quiet-button', '', ' title="Startwert am aktiven Marker aus der Messkurve übernehmen" aria-label="' + esc(label) + ' am aktiven Marker übernehmen"')) + '</div>';
    }).join('');
    const guessed = em.multi && em.data.guessed.length && !em.edited ? '<p class="inline-notice" id="model-guessed">Für ' + esc(em.data.guessed.map(key => MODEL_LABELS[key][0].split(' · ')[0]).join(', ')) +
      ' liefert die Auswertung keinen positiven Wert. Der Editor beginnt dort mit einem kleinen Platzhalter.' + (em.data.guessed.some(key => ['rw', 'rpri', 'rsec'].includes(key)) ? ' Wicklungswiderstände von wenigen Milliohm löst eine 50-Ω-Messung nicht auf: Trage den Gleichstromwiderstand aus dem Datenblatt ein und setze ihn auf „fest“, bevor du optimierst.' : ' „Optimieren“ bestimmt den Wert aus den Kurven.') + '</p>' : '';
    const hint = em.multi && !em.edited && em.quality.err > 1 ? '<p class="note" id="model-hint">Die Startwerte stammen aus Einzelauswertungen (Plateaus, Resonanzen) und treffen die Kurven als Ganzes noch nicht. „Optimieren“ passt sie an Betrag und Phase aller Kurven an.</p>' : '';
    const derived = em.model.type === 'cmc' ? '<p class="diagnostics" id="model-derived">' + esc('L = M + Lσ = ' + si(em.model.m + em.model.ls, 'H') + ' · k = M/L = ' + display(em.model.m / (em.model.m + em.model.ls)) +
        ' · L+M = ' + si(2 * em.model.m + em.model.ls, 'H')) + '</p>'
      : em.model.type === 'trafo' ? '<p class="diagnostics" id="model-derived">' + esc('L₁₁ = L_m + Lσ/2 = ' + si(em.model.lm + trafoLowLeak(em.model) / 2, 'H') + ' · L₂₂ = n²·L₁₁ = ' + si(em.model.n ** 2 * (em.model.lm + trafoLowLeak(em.model) / 2), 'H') +
        (em.model.lse > 0 && em.model.rse > 0 ? ' · Lσ bei tiefer Frequenz = Lσ + Lσ_e = ' + si(trafoLowLeak(em.model), 'H') + ', Eckfrequenz R_e/(2π·Lσ_e) = ' + hz(em.model.rse / (RF.TAU * em.model.lse)) : '') +
        ' · Cww = Cwa + Cwx = ' + si((em.model.cwa || 0) + (em.model.cwx || 0), 'F') + ' · Polarität ' + (em.model.flip ? 'invertiert' : 'gleichsinnig')) + '</p>' : '';
    return '<section class="detail-card model-editor" id="model-editor"><div class="fit-summary"><h3>Modell-Editor</h3><small>' + esc(modelStructure(em.model)) + '</small></div>' +
      '<p class="diagnostics" id="model-summary" data-err="' + em.quality.err + '" data-phase="' + em.quality.phase + '" data-edited="' + (em.edited ? '1' : '0') + '">' + esc(modelSummary(em)) + '</p>' +
      (em.multi ? guessed + hint + derived + spreadNote(em, spread) : elementSchematic(em.model)) +
      '<form id="model-form" class="model-form">' + rows +
      '<div class="model-window"><label class="control"><span class="field-label">Fitfenster von</span><input class="field-input mono" name="from" value="' + esc(freqInput(em.band[0])) + '" autocomplete="off"></label>' +
      '<label class="control"><span class="field-label">bis</span><input class="field-input mono" name="to" value="' + esc(freqInput(em.band[1])) + '" autocomplete="off"></label>' +
      actionButton('Fenster = M1 … M2', 'model-window', 'markers', 'quiet-button', '', ' title="Die Marker M1 und M2 begrenzen das Fitfenster"') +
      actionButton('Ganzer Bereich', 'model-window', 'all', 'quiet-button') + '</div>' +
      (em.model.type === 'cmc' ? '<div class="model-window" id="model-sections-row">' + selectField('Kernglieder', 'model-sections', [['1', '1'], ['2', '2'], ['3', '3']], String(RF.coreSections(em.model).length), true) +
        actionButton('Anzahl prüfen', 'model-sections-check', '', 'quiet-button', '', ' title="Fittet 1, 2 und 3 Kernglieder und übernimmt die kleinste Anzahl, die die Messung trägt"') + '</div>' + sectionReport(em) : '') +
      (em.multi ? '<label class="model-auto"><input type="checkbox" name="auto-hold"' + checked(em.edit.autoHold !== false) + '><span>Nicht bestimmbare Werte beim Optimieren automatisch festhalten</span></label>' : '') +
      '<div class="preset-row"><button class="button" type="submit">Werte übernehmen</button>' +
      actionButton('Optimieren', 'model-fit', '', 'button primary', '', ' title="Freie Parameter im Fitfenster an Betrag und Phase anpassen; „fest“ markierte bleiben stehen"') +
      actionButton('Automatik', 'model-reset', '', 'button', '', ' title="Zurück zum automatischen Fit"' + disabled(!em.edited && !em.edit.band && !em.edit.fixed.length)) +
      actionButton('Als SPICE-Modell öffnen', 'esb-spice', 'open', 'button', 'plus') + actionButton('SPICE .lib speichern', 'esb-spice', 'save', 'button', 'file') + '</div></form>' +
      '<p class="note">Eingaben wie 10 µH, 4,7n oder 1e-6. Der Regler verstellt um eine Dekade nach unten und oben. ' + (em.model.type === 'cmc'
        ? 'Optimiert werden Betrag und Phase der vier natürlichen Moden des Vierpols: G (alle Anschlüsse gegen Masse, zeigt Cg), V (Wicklung gegen Wicklung, Cw + Cx), H (Gleichtakt durch die Wicklungen) und D (Gegentakt durch die Wicklungen), nur mit den Messpunkten im Fitfenster (im Diagramm grün hinterlegt). Z CM und Z DM nach CISPR 17 sind dafür ungeeignet: Sie sind die reine Reihenimpedanz der Modenzweitore, Cw und Cg fallen darin exakt heraus. Jeder Punkt zählt nach seiner Auflösbarkeit (angenommene Messunsicherheit 0,03 dB); was die Messung nicht auflöst, lenkt den Fit nicht. Die Startwerte hängen nicht vom Fit-Band oben ab: M und Lσ stammen aus den Plateaus der Modeninduktivitäten unterhalb der jeweiligen Resonanz, die vier Kapazitäten aus den vier natürlichen Moden. Cx (diagonal, Eingang + zu Ausgang −) vervollständigt das Kapazitätsnetz; ohne Cx müsste Ct bei realen Drosseln negativ werden. R_σ parallel zu Lσ beschreibt die Verluste im Gegentaktpfad (Streufluss im Ferrit, Näheffekt): Der Gegentaktwiderstand realer Drosseln steigt etwa mit (ωLσ)²/R_σ, ein konstanter R_w allein trifft das nicht. Das Modell ist symmetrisch (beide Wicklungen gleich). Jedes Kernglied M ∥ R_Fe ist eine Relaxation mit einer Zeitkonstante 2M/R_Fe; ein Kern mit mehreren Dispersionsbereichen braucht mehrere Glieder, „Anzahl prüfen“ ermittelt, wie viele die Messung trägt. Schaltbild und SPICE-Export zeigen genau diese Schaltung. '
        : em.model.type === 'trafo' ? 'Optimiert werden Betrag und Phase der natürlichen Moden des differentiellen Zweitors, primärbezogen: Mode M (beide Wicklungen gleichsinnig, nur die Magnetisierung: L_m, R_Fe, oberhalb ihrer Resonanz eine Kapazität), Mode σ (die Amperewindungen heben sich auf, nur die Streuung: Lσ, R₁, R₂, bei ihrer eigenen, viel höheren Resonanz die Wicklungskapazität) und die Kopplung M–σ (Unsymmetrie beider Seiten), nur mit den Messpunkten im Fitfenster (im Diagramm grün hinterlegt). Das Fitfenster reicht bis über die Resonanz von Mode σ, denn erst dort zeigt sich Cwa. Bei 1 : 1 gilt C_M = (C_p + C_p2)/2 + Cwx/2, C_σ = (C_p + C_p2)/2 + Cwa/2 und C_M–σ = (C_p − C_p2)/2; mit Cww = Cwa + Cwx aus dem Gleichtakt sind alle vier Kapazitäten festgelegt, ihre Startwerte kommen aus diesen Moden. Lσ_e ∥ R_e (wenn die Messung es zeigt) ist der Wirbelstromanteil der Streuung: Die Streuinduktivität fällt zu hohen Frequenzen ab, ihr Widerstand steigt. Die Streuung wird je zur Hälfte auf beide Seiten gelegt; das ist eine Annahme, die die Klemmenmessung nicht prüfen kann. Schaltbild und SPICE-Export zeigen genau diese Schaltung. '
        : 'Optimiert werden Betrag und Phase der komplexen Impedanz, nur mit den Messpunkten im Fitfenster (im Diagramm grün hinterlegt). ') + 'Alle Werte bleiben positiv. Die Messdaten werden dabei nie verändert.</p></section>';
  }

  // Small circuit drawing that follows the model: every element of the formula is one symbol, with its value.
  function elementSchematic(model) {
    const parts = [];
    let x = 34;
    const wire = (a, b, y = 46) => '<path d="M' + a + ' ' + y + 'H' + b + '"/>';
    const resistor = (at, y = 46) => '<rect x="' + at + '" y="' + (y - 7) + '" width="34" height="14" rx="2"/>';
    const coil = (at, y = 46) => '<path d="M' + at + ' ' + y + 'a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0"/>';
    const cap = (at, y = 46) => '<path d="M' + (at + 14) + ' ' + (y - 9) + 'v18m6-18v18M' + at + ' ' + y + 'h14m6 0h14"/>';
    const text = (at, y, label, value, unit) => '<text x="' + at + '" y="' + y + '">' + esc(label) + '</text><text class="value" x="' + at + '" y="' + (y + 13) + '">' + esc(si(value, unit)) + '</text>';
    const labels = [];
    const series = (draw, width, label, value, unit) => { parts.push(wire(x, x + 10), draw(x + 10), wire(x + 10 + width, x + 20 + width)); labels.push(text(x + 10 + width / 2, 16, label, value, unit)); x += 20 + width; };
    if (model.type === 'rlc') {
      series(resistor, 34, 'ESR', model.esr, 'Ω');
      if (model.esl > 0) series(coil, 36, 'ESL', model.esl, 'H');
      const leak = Number.isFinite(model.rp) && model.rp > 0;
      parts.push(wire(x, x + 10), cap(x + 10), wire(x + 44, x + 54));
      labels.push(text(x + 27, 16, 'C', model.c, 'F'));
      if (leak) { parts.push('<path d="M' + (x + 4) + ' 46v40h6m34 0h6V46"/>', resistor(x + 10, 86)); labels.push(text(x + 27, 108, 'R_p', model.rp, 'Ω')); }
      x += 54;
    } else {
      series(resistor, 34, 'R₀', model.r0, 'Ω');
      model.tanks.forEach((tank, t) => {
        const n = t + 1, sub = '₁₂'[t], hasC = tank.c > 0, hasR = Number.isFinite(tank.r) && tank.r > 0;
        if (!hasC && !hasR) { series(coil, 36, 'L' + sub, tank.l, 'H'); return; }
        const a = x + 6, b = x + 62;
        parts.push(wire(x, a), wire(b, b + 6), wire(a, a + 10), coil(a + 10), wire(a + 46, b));
        labels.push(text(a + 28, 16, 'L' + sub, tank.l, 'H'));
        // every branch of the tank sits on its own row, its name and value directly above the symbol
        let y = 46;
        for (const [draw, label, value, unit] of [...(hasC ? [[cap, 'C' + sub, tank.c, 'F']] : []), ...(hasR ? [[resistor, 'R' + sub, tank.r, 'Ω']] : [])]) {
          const top = y;
          y += 52;
          parts.push('<path d="M' + a + ' ' + top + 'V' + y + 'h11m34 0h11V' + top + '"/>', draw(a + 11, y));
          labels.push(text(a + 28, y - 30, label, value, unit));
        }
        void n;
        x = b + 6;
      });
    }
    const rows = model.type === 'rlc' ? 0 : Math.max(0, ...model.tanks.map(tank => (tank.c > 0 ? 1 : 0) + (Number.isFinite(tank.r) && tank.r > 0 ? 1 : 0)));
    const width = x + 34, height = model.type === 'rlc' ? (Number.isFinite(model.rp) && model.rp > 0 ? 128 : 70) : 66 + 52 * rows;
    return '<div class="schematic-box"><svg class="model-schematic" style="width:' + Math.round(width * 1.55) + 'px" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc('Ersatzschaltbild: ' + modelStructure(model)) + '">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' + wire(14, 34) + parts.join('') + wire(x, x + 20) +
      '<circle cx="11" cy="46" r="3"/><circle cx="' + (x + 23) + '" cy="46" r="3"/></g>' +
      '<g fill="currentColor" text-anchor="middle" font-size="10.5" font-weight="650">' + labels.join('') + '</g></svg></div>';
  }

  function modelApply(form) {
    const em = currentElement();
    if (!em) return;
    const data = new FormData(form), values = {};
    for (const { key } of RF.modelParams(em.model)) {
      const value = parseSI(data.get(key));
      if (!(value > 0)) { toast(MODEL_LABELS[key][0] + ': Gib einen positiven Wert ein, z. B. ' + si(RF.modelParams(em.auto).find(p => p.key === key)?.value ?? 1, MODEL_LABELS[key][1]) + '.'); form.elements[key].focus(); return; }
      values[key] = value;
    }
    const from = parseHz(data.get('from')), to = parseHz(data.get('to'));
    if (!(from > 0) || !(to > from)) { toast('Gib ein positives, aufsteigendes Fitfenster ein.'); return; }
    const changed = RF.modelParams(em.model).some(p => Math.abs(values[p.key] / p.value - 1) > 2e-3);
    if (changed || em.edited) em.edit.values = values;
    em.edit.fixed = RF.modelParams(em.model).map(p => p.key).filter(key => data.get('fix-' + key));
    if (em.multi) em.edit.autoHold = !!data.get('auto-hold');
    em.edit.band = Math.abs(from / em.natural[0] - 1) < 1e-3 && Math.abs(to / em.natural[1] - 1) < 1e-3 ? null : [from, to];
    renderAnalysis();
  }
  const modelValues = model => Object.fromEntries(RF.modelParams(model).map(p => [p.key, p.value]));
  // Marks the editor as busy while a worker fit runs; the result is only taken if the editor still shows the same model.
  function modelBusy(button, text) {
    const box = $('model-editor');
    if (box) box.dataset.busy = '1';
    if (button) { button.disabled = true; button.textContent = text; }
  }
  const sameJob = (em, values) => { const now = currentElement(); return !!now && now.kind === em.kind && now.data === em.data && now.edit === em.edit && em.edit.values === values; };
  async function modelFit(_, button) {
    const form = $('model-form');
    if (form) modelApply(form); // typed values and fixed flags count, even without "Werte übernehmen"
    const em = currentElement();
    if (!em) return;
    let fit;
    if (!em.multi) fit = RF.fitModel(state.dataset.freq, em.data.z, em.model, { fixed: em.edit.fixed, band: em.band });
    else {
      // Values the measurement cannot fix go back to their value before this run and stay there (they are not marked "fest").
      const options = { fixed: em.edit.fixed, band: em.band, prior: em.data?.prior, priorSum: em.data?.priorSum }, values = em.edit.values;
      modelBusy(button, 'Optimiere …');
      try { fit = await rfJob(em.edit.autoHold !== false ? 'fitMultiHeld' : 'fitMulti', [state.dataset.freq, em.data.meas, em.model, options]); }
      catch (error) { renderAnalysis(); toast('Optimieren fehlgeschlagen: ' + error.message); return; }
      if (!sameJob(em, values)) { renderAnalysis(); return; }
    }
    if (!fit) { renderAnalysis(); toast('Im Fitfenster liegen zu wenige Messpunkte für die freien Parameter.'); return; }
    const held = fit.held ?? [];
    em.edit.values = modelValues(fit.model);
    toast('Optimiert: ' + display(fit.err) + ' dB und ' + display(fit.phase) + '° RMS über ' + fit.points + ' Punkte' + (em.edit.fixed.length ? ' · ' + em.edit.fixed.length + ' fest' : '') +
      (held.length ? ' · nicht bestimmbar, festgehalten: ' + held.map(key => MODEL_LABELS[key][0].split(' · ')[0]).join(', ') : '') +
      (fit.spared?.length ? ' · schwach bestimmt, aber nötig (Festhalten verschlechtert den Fit): ' + fit.spared.map(key => MODEL_LABELS[key][0].split(' · ')[0]).join(', ') : ''));
    renderAnalysis();
  }
  // Number of core sections: start values from the relaxation times of the measured core (RF.cmcCoreStart), not yet optimised.
  function modelSections(count) {
    const form = $('model-form');
    if (form) modelApply(form);
    const em = currentElement();
    if (!em || em.model.type !== 'cmc' || ![1, 2, 3].includes(count)) return;
    const next = RF.cmcCoreStart(state.dataset.freq, em.data.meas, em.model, count, em.band);
    em.edit.sections = count;
    em.edit.values = modelValues(next);
    em.edit.fixed = em.edit.fixed.filter(key => !/^(m|rfe)\d?$/.test(key));
    em.edit.sectionReport = null;
    renderAnalysis();
    toast((count === 1 ? '1 Kernglied' : count + ' Kernglieder') + ': Startwerte aus der Verteilung der Relaxationszeiten des Kerns. „Optimieren“ passt sie an.');
  }
  async function modelSectionsCheck(_, button) {
    const form = $('model-form');
    if (form) modelApply(form);
    const em = currentElement();
    if (!em || em.model.type !== 'cmc') return;
    const values = em.edit.values;
    modelBusy(button, 'Prüfe …');
    let result;
    try { result = await rfJob('cmcSectionOrder', [state.dataset.freq, em.data.meas, em.model, { band: em.band, fixed: em.edit.fixed, prior: em.data.prior, priorSum: em.data.priorSum }]); }
    catch (error) { renderAnalysis(); toast('Prüfung fehlgeschlagen: ' + error.message); return; }
    if (!sameJob(em, values)) { renderAnalysis(); return; }
    if (!result?.best) { renderAnalysis(); toast('Im Fitfenster liegen zu wenige Messpunkte für die freien Parameter.'); return; }
    em.edit.sections = result.best.count;
    em.edit.values = modelValues(result.best.model);
    em.edit.fixed = em.edit.fixed.filter(key => !/^(m|rfe)\d?$/.test(key));
    em.edit.sectionReport = { best: result.best.count, fits: result.fits.map(f => ({ count: f.count, err: f.err, phase: f.phase, distinct: f.distinct })) };
    renderAnalysis();
    toast('Kernglieder geprüft: Die Messung trägt ' + result.best.count + (result.best.count === 1 ? ' Kernglied' : ' Kernglieder') + ' · ' + display(result.best.err) + ' dB RMS');
  }
  function modelReset() {
    const kind = esbModel();
    if (state.esb.edit) state.esb.edit[kind] = blankEdit();
    renderAnalysis();
  }
  function modelWindow(mode) {
    const em = currentElement();
    if (!em) return;
    if (mode === 'all') em.edit.band = [em.data.span[0], em.data.span[1]];
    else {
      const fs = state.dataset.freq, picks = state.markers.filter(i => i !== null).map(i => fs[i]).filter(f => f > 0).sort((a, b) => a - b);
      if (picks.length < 2 || !(picks.at(-1) > picks[0])) { toast('Setze zwei Marker auf verschiedene Frequenzen. Sie begrenzen dann das Fitfenster.'); return; }
      em.edit.band = [picks[0], picks.at(-1)];
    }
    renderAnalysis();
  }
  // Start value from the measured curve at the active marker.
  function modelFromMarker(key) {
    const em = currentElement(), i = state.markers[state.activeMarker];
    if (!em || i === null || i === undefined) { toast('Setze zuerst einen Marker auf die Messkurve.'); return; }
    const z = em.data.z[i], f = state.dataset.freq[i], w = omega(f);
    if (!z || !(f > 0)) { toast('Am Marker gibt es keinen Messwert.'); return; }
    const now = modelValues(em.model), mag = Math.hypot(z[0], z[1]);
    let value = NaN, why = '';
    if (key === 'r0' || key === 'esr') { value = z[0]; why = 'Am Marker ist der Realteil nicht positiv.'; }
    else if (key === 'l1' || key === 'esl') { value = z[1] / w; why = 'Am Marker ist das Bauteil nicht induktiv (X ≤ 0). Setze den Marker ' + (key === 'esl' ? 'oberhalb' : 'unterhalb') + ' der Eigenresonanz.'; }
    else if (key === 'c') { value = -1 / (w * z[1]); why = 'Am Marker ist das Bauteil nicht kapazitiv (X ≥ 0). Setze den Marker unterhalb der Eigenresonanz.'; }
    else if (key === 'c1' || key === 'c2') { value = 1 / (w * w * now['l' + key[1]]); why = ''; }
    else if (key === 'l2') { value = now.c2 > 0 ? 1 / (w * w * now.c2) : Math.abs(z[1]) / w; }
    else value = mag; // r1, r2, rp: height of the resonance or the plateau at the marker
    if (!(value > 0) || !Number.isFinite(value)) { toast(why || 'Aus diesem Marker lässt sich kein positiver Wert ableiten.'); return; }
    em.edit.values = { ...now, [key]: value };
    toast(MODEL_LABELS[key][0].split(' · ')[0] + ' = ' + si(value, MODEL_LABELS[key][1]) + ' aus dem Marker bei ' + hz(f) +
      (key === 'c1' || key === 'c2' ? ' (Resonanz mit ' + MODEL_LABELS['l' + key[1]][0].split(' · ')[0] + ')' : ''));
    renderAnalysis();
  }
  // Dragging a slider moves the model curve live; the details are only rebuilt when the slider is released.
  function modelSlide(slider, done) {
    const em = currentElement();
    if (!em) return;
    const key = slider.dataset.key, value = Number(slider.dataset.base) * 10 ** (Number(slider.value) / 100);
    em.edit.values = { ...modelValues(em.model), [key]: value };
    if (done) { renderAnalysis(); return; }
    const input = $('model-' + key);
    if (input) input.value = modelText(value, input.dataset.unit);
    state.view = compareView(esbView(), esbView);
    updatePlot(true);
    const next = currentElement(), summary = $('model-summary');
    if (summary && next) { summary.textContent = modelSummary(next); summary.dataset.err = next.quality.err; summary.dataset.phase = next.quality.phase; summary.dataset.edited = '1'; }
  }

  function elementView(kind) {
    const data = elementData(kind);
    if (!data) return { empty: 'Wähle zwei verschiedene aktive Ports oder Moden als Eingang und Ausgang der Serien- bzw. Shunt-Fixture.' };
    const { z, result: r, from, to, fixture } = data, fmt = state.esb.eFormat;
    const formula = { series: 'Z = 2Z₀(1/S₂₁ − 1)', shunt: 'Z = (Z₀/2)·S₂₁/(1 − S₂₁)', reflection: 'Z = Z₀(1 + S₁₁)/(1 − S₁₁)' }[fixture];
    const detected = state.esb.model === 'auto' ? detectModel() : null;
    const detectNote = !detected ? '' : detected.level === 'unklar'
      ? '<p class="inline-notice" id="esb-unclear">Die automatische Erkennung ist für diese Datei nicht eindeutig. Wähle das Modell oben selbst: induktiv (L) oder kapazitiv (C).</p>'
      : '<p class="detect-note" id="esb-detected">' + icon('check') + esc('Automatisch erkannt: ' + Magnetic.label(detected.category, window.I18N.lang) + ' · ' + LEVEL_NAME[detected.level] +
        ' · Fixture ' + FIXTURE_NAME[fixture]) + '</p>';
    const mk = (key, label, color, values, dash = null) => ({ key: 'el:' + key, label, color, values, dash, visible: !state.hiddenTraces.has('el:' + key) });
    const em = elementModel(kind, data), modelAt = em ? Array.from(state.dataset.freq, f => f > 0 ? RF.modelImpedance(em.model, f) : null) : null;
    const modelCurve = (key, label, pick) => ({ ...mk(key, label, '#c4622d', Float64Array.from(modelAt, pick), [2, 3]) });
    let traces, unit, yLabel, refLines = [], focus = null;
    if (fmt === 'l') {
      const lu = kind === 'series' ? 1e-6 : 1e-9;
      unit = kind === 'series' ? 'µH' : 'nH';
      traces = [mk('l', kind === 'series' ? 'L = X/ω' : 'ESL = X/ω', MODE_PALETTE.dd[0], scaled(r.series.l, lu))];
      yLabel = 'Induktivität [' + unit + ']';
      const value = kind === 'series' ? r.l : r.esl;
      refLines = [{ value: value / lu, color: '#c4622d', label: (kind === 'series' ? 'L ' : 'ESL ') + display(value / lu) + ' ' + unit }];
      focus = kind === 'series' && value > 0 ? [-value / lu, 2 * value / lu] : null;
    } else if (fmt === 'c' && kind === 'series') {
      const e = Number.isFinite(r.cp) && r.cp > 0 ? Math.max(-5, Math.min(0, Math.floor(Math.log10(r.cp) / 3))) : -4, factor = 10 ** (3 * e);
      unit = ['f', 'p', 'n', 'µ', 'm', ''][e + 5] + 'F';
      traces = [mk('cp', 'C_p(f) = 1/(ω²L) − 1/(ωX)', MODE_PALETTE.cc[0], scaled(r.series.c, factor))];
      yLabel = 'Kapazität [' + unit + ']';
      refLines = [{ value: r.cp / factor, color: '#c4622d', label: 'C_p (Thomson) ' + display(r.cp / factor) + ' ' + unit }];
      focus = focusAround([r.cp / factor], 0.5, 1.5);
    } else if (fmt === 'c' && kind === 'shunt') {
      const [factor, cu] = engineeringScale([{ values: r.series.c }], 'F');
      unit = cu;
      traces = [mk('c', 'C = −1/(ωX)', MODE_PALETTE.cc[0], scaled(r.series.c, factor))];
      yLabel = 'Kapazität [' + unit + ']';
      refLines = [{ value: r.c / factor, color: '#c4622d', label: 'C ' + display(r.c / factor) + ' ' + unit }];
    } else {
      unit = 'Ω'; yLabel = 'Impedanz [Ω]';
      traces = [
        mk('zabs', '|Z|', MODE_PALETTE.dd[0], Float64Array.from(z, v => v ? Math.hypot(v[0], v[1]) : NaN)),
        mk('zre', kind === 'series' ? 'R = Re Z' : 'ESR = Re Z', MODE_PALETTE.dc[0], Float64Array.from(z, v => v ? v[0] : NaN), REFLECTION_DASH)
      ];
      if (em) traces.push(modelCurve('zfit', 'Modell |Z|', v => v ? Math.hypot(v[0], v[1]) : NaN), { ...modelCurve('zfitre', kind === 'series' ? 'Modell R' : 'Modell ESR', v => v ? v[0] : NaN), color: MODE_PALETTE.dc[0], dash: [1, 3] });
    }
    const route = fixture === 'reflection' ? from.key : from.key + ' → ' + to.key;
    const details = () => detectNote + '<section class="detail-card"><div class="fit-summary"><h3>' + (kind === 'series' ? 'Induktives Bauteil' : 'Kapazitives Bauteil') +
      ' · Ersatzschaltbild</h3><small id="esb-formula">' + esc(route + ' · ' + formula) + '</small></div>' +
      '<div class="metric-grid">' + (kind === 'series'
        ? metric('L · LC-Fit unterhalb SRF', r.l * 1e6, 'µH') + metric('L · Plateau', r.lFlat * 1e6, 'µH') + metric('R_DC · tiefste Frequenzen', r.rdc, 'Ω') +
          '<div class="metric"><strong>' + esc(Number.isFinite(r.fsrf) ? hz(r.fsrf) : '—') + '</strong><span>SRF · Maximum von |Z|</span></div>' +
          metric('C_p · 1/((2π·SRF)²·L)', r.cp * 1e12, 'pF') + metric('R_p · Re Z bei SRF', r.rp, 'Ω')
        : metric('C · Plateau unterhalb SRF', r.c * 1e9, 'nF') +
          '<div class="metric"><strong>' + esc(Number.isFinite(r.fsrf) ? hz(r.fsrf) : '—') + '</strong><span>SRF · Im Z = 0</span></div>' +
          metric('ESL · oberhalb SRF', r.esl * 1e9, 'nH') + metric('ESR · Re Z bei SRF', r.esr * 1e3, 'mΩ')) +
      '</div><p class="note">' + (fixture === 'reflection' ? 'Die Formel gilt für eine Eintor-Messung gegen Masse. Weit weg von Z₀ sinkt die Messgenauigkeit eines VNA deutlich. '
        : 'Die Formel gilt für eine reine ' + (fixture === 'series' ? 'Serien' : 'Shunt') +
        '-Fixture zwischen den gewählten Ports. Für kleine Impedanzen (Serie) bzw. große Impedanzen (Shunt) sinkt die Messgenauigkeit eines VNA deutlich. ') + help + '</p></section>' +
      (em ? modelEditor(em) : '<section class="detail-card"><div class="fit-summary"><h3>Modell-Editor</h3><small>' + (kind === 'series'
        ? 'Für das Modell fehlt ein induktiver Bereich bei tiefen Frequenzen.' : 'Für das Modell fehlt ein kapazitiver Bereich bei tiefen Frequenzen.') + '</small></div></section>');
    return {
      traces, unit, yLabel, title: kind === 'series' ? 'Induktives Bauteil' : 'Kapazitives Bauteil', caption: route + ' · Fixture ' + FIXTURE_NAME[fixture],
      native: '', positive: !['l', 'c'].includes(fmt), signed: ['l', 'c'].includes(fmt), refLines, focus, details, fitBand: em && fmt === 'z' ? em.band : null
    };
  }

  function esbView() {
    const model = esbModel();
    if (model === 'series' || model === 'shunt') return elementView(model);
    const pairs = selectedPairs();
    if (!pairs) {
      const physics = windingPhysics(), mapping = physics?.mappings.find(m => m.kind === physics.recommended) ?? physics?.mappings[0];
      if (mapping) return { needsPairs: true, title: 'Portzuordnung fehlt',
        empty: tx('Die Messung zeigt zwei Wicklungen: ' + physics.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(' und ') + ' (' + Magnetic.label(physics.verdict.category, 'de') + ', ' + LEVEL_NAME[physics.verdict.level || 'unklar'] +
          '). Für das Ersatzschaltbild müssen daraus zwei Portpaare werden. Vorschlag aus der Messung: ' + mapping.text + '.',
          'The measurement shows two windings: ' + physics.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(' and ') + ' (' + Magnetic.label(physics.verdict.category, 'en') + ', ' + window.I18N.t(LEVEL_NAME[physics.verdict.level || 'unklar']) +
          '). The equivalent circuit needs two port pairs made from them. Suggestion from the measurement: ' + mapping.en + '.'),
        extra: actionButton(tx('Vorschlag übernehmen', 'Apply suggestion'), 'physics-apply', mapping.kind, 'button primary', 'check') };
      return { empty: 'Für CMC- und Übertragermodell werden zwei Portpaare benötigt. Für ein Einzelbauteil wähle „Bauteil · induktiv“ oder „Bauteil · kapazitiv“.', needsPairs: true };
    }
    const view = model === 'transformer' ? transformerView(pairs) : cmcView();
    if (state.esb.model === 'auto' && !view.empty) {
      const detected = detectModel();
      const base = view.details;
      view.details = () => '<p class="detect-note">' + icon('check') + esc('Automatisch erkannt: ' + (detected.type === 'transformer' ? 'Übertrager' : 'CMC') +
        ' · |Scc₂₁| = ' + display(detected.scc) + ' bei ' + hz(detected.f) + (detected.type === 'transformer' ? ' (galvanisch getrennt)' : ' (Gleichtakt galvanisch verbunden)')) + '</p>' + base();
    }
    return view;
  }

  function empty(title, content, canConfigure = false, extra = '') {
    state.view = null;
    $('chart-card').hidden = true;
    $('empty-panel').hidden = false;
    $('empty-panel').innerHTML = '<h2>' + esc(title) + '</h2><p>' + esc(content) + '</p>' +
      (extra ? '<div class="preset-row">' + extra + actionButton('Ports konfigurieren', 'tab', 'ports', 'button', 'network') + '</div>' : canConfigure ? actionButton('Ports konfigurieren', 'tab', 'ports', 'button primary', 'network') : '');
    $('analysis-details').innerHTML = '';
    detailsShown = null;
    Plot.set(null);
  }

  function renderAnalysis() {
    persistSettings(); // axis and view changes reach this point without passing renderMain
    if (!state.network) {
      empty(state.busy ? 'Netzwerk wird berechnet' : 'Keine Netzwerkdaten',
        state.busy ? 'Die Portlasten und Referenzen werden für alle Messpunkte angewendet.' : state.error || 'Öffne eine Touchstone-Datei.');
      return;
    }
    const factory = { s: sView, smith: smithView, z: zView, cispr: cisprView, cmc: esbView }[state.tab];
    try {
      state.view = factory();
    } catch (error) {
      empty('Auswertung fehlgeschlagen', error.message);
      return;
    }
    if (state.view.empty) {
      empty(state.view.title || 'Auswahl ergänzen', state.view.empty, state.view.needsPairs, state.view.extra || '');
      return;
    }
    state.view = compareView(state.view, factory);
    const warn = pairWarning();
    $('physics-warning').hidden = !warn;
    if (warn) insertHtml($('physics-warning'), esc(warn) + ' ' + actionButton(tx('Ports prüfen', 'Check ports'), 'tab', 'ports', 'quiet-button'));
    $('empty-panel').hidden = true;
    $('chart-card').hidden = false;
    $('plot-heading').textContent = state.view.title;
    $('plot-caption').textContent = state.view.caption;
    $('chart-tools').hidden = !!state.view.smith;
    $('plot-hint').textContent = state.view.smith ? 'Kurvenpunkt antippen oder Pfeiltasten für den Frequenzmarker' :
      (coarse.matches || (navigator.maxTouchPoints > 0 && mobile.matches) ? 'Tippen oder waagerecht wischen für Marker · Zwei Finger zoomen · Doppeltippen setzt zurück · Y-Skala links: ziehen, zwei Finger übereinander zoomen' :
        'Klick für Marker · Ziehen oder Mausrad zum Zoomen · Doppelklick setzt zurück · Y-Skala: Mausrad und Ziehen') +
      (state.view.fitBand ? ' · Fit-Band grün hinterlegt' : '') +
      (state.view.hint ? ' · ' + state.view.hint : '');
    const a = axis();
    if (state.dataset.freq.at(-1) <= 0) a.x = 'linear';
    document.querySelectorAll('[data-action="x-scale"]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.value === a.x));
      button.disabled = button.dataset.value === 'log' && state.dataset.freq.at(-1) <= 0;
    });
    const scales = yScales();
    $('y-scale-segment').hidden = scales.length < 2;
    document.querySelectorAll('[data-action="y-scale"]').forEach(button => {
      button.hidden = !scales.includes(button.dataset.value);
      button.setAttribute('aria-pressed', String(button.dataset.value === effectiveY()));
    });
    updatePlot();
    renderTraces();
    renderMarker(true);
    renderDetails();
  }

  function updatePlot(preserveHover = false) {
    if (!state.view) return;
    const a = axis();
    Plot.set({
      ...state.view, f: state.dataset.freq, xScale: a.x, xRange: a.xRange, yScale: effectiveY(), yRange: (effectiveY() === a.y ? a.yRange : null) ?? (effectiveY() === 'linear' && state.view.focus?.every(Number.isFinite) && state.view.focus[0] < state.view.focus[1] ? state.view.focus : null),
      markers: state.markers, activeMarker: state.activeMarker, onMarker: index => setMarker(state.activeMarker, index),
      onMarkerDrag: (i, index) => setMarker(i, index), onMarkerSelect: i => { if (i !== state.activeMarker) switchMarker(i); },
      onZoom: range => { axis().xRange = range; updatePlot(true); persistSettings(); },
      onYRange: range => { const a = axis(); a.y = effectiveY(); a.yRange = range; updatePlot(true); persistSettings(); }
    }, preserveHover);
  }

  // The cards are only rebuilt when their content changes. Moving a marker or leaving an input field must not
  // replace a button under the pointer or wipe a value that is being typed into the model editor.
  let detailsShown = null;
  function renderDetails() {
    const html = state.view?.details?.() || '', key = window.I18N.lang + '\u0000' + html, box = $('analysis-details');
    if (key === detailsShown && box.childElementCount) return;
    detailsShown = key;
    box.innerHTML = html;
  }

  function renderTraces() {
    const view = state.view;
    const marker = state.markers[state.activeMarker];
const typed = state.tab === 's' && state.basis === 'mm' && ['cmc', 'lan'].includes(deviceType());
    const isExt = typed && sameSet(state.sKeys.mm || [], typeTraces(currentModes(), true));
    const pick = (typed ? actionButton('Erweitert', 'curve-preset', isExt ? 'basic' : 'ext', 'button', '', pressed(isExt) + ' title="Zusätzliche Kurven für ' + (deviceType() === 'cmc' ? 'CMC: Sdc21' : 'LAN-Übertrager: Scc11, Sdd22, Scd21') + '"') : '') +
      (state.tab === 's' ? actionButton('Wählen', 'matrix', '', 'button', 'grid', ' aria-label="Kurven wählen"') : '');
    const list = view.traces.map(trace =>
      '<button type="button" class="trace-row" data-action="toggle-trace" data-value="' + esc(trace.key) + '"' + pressed(trace.visible) +
      ' style="--trace:' + trace.color + '" title="' + esc(trace.label + (trace.visible ? ' ausblenden' : ' einblenden')) + '">' +
      '<span class="trace-check" aria-hidden="true"></span><span class="trace-dot' + (trace.dash ? ' is-dashed' : '') + '"></span>' +
      '<span class="trace-name">' + esc(trace.label) + '</span><span class="trace-value">' +
      esc(valueWith(traceValue(trace, marker), view.unit)) + '</span></button>').join('');
    const shown = view.traces.filter(t => t.visible).length;
    $('trace-panel').innerHTML = '<div class="trace-head"><h3>Kurven <small class="trace-count">' + shown + '/' + view.traces.length + '</small></h3>' + pick + '</div>' +
      (list ? '<div class="trace-list">' + list + '</div>' + traceLegend(view) + '<p class="trace-note">Werte an M' + (state.activeMarker + 1) +
        ' · Antippen blendet ein/aus</p>' :
        '<p class="trace-empty">Wähle Matrixelemente, um sie einzublenden.</p>');
  }

  function traceLegend(view) {
    if (state.tab !== 's') return '';
    const families = new Set(view.traces.map(t => t.family));
    const items = [
      ['dd', 'var(--mode-d)', 'DD Differential'], ['cc', 'var(--mode-c)', 'CC Gleichtakt'],
      ['dc', 'var(--mode-dc)', 'Sdc C→D'], ['cd', 'var(--mode-cd)', 'Scd D→C'], ['p', 'var(--mode-p)', 'Einzelport'],
      ['m0', '#7a5a12', '0-Mode (Nullsystem)'], ['mab', '#1f6fb2', 'α/β-Moden (Leiter–Leiter)'], ['mx', '#b23a8e', 'Modenkonversion 0/α/β']
    ].filter(([family]) => families.has(family));
    const lines = view.traces.some(t => t.dash) && view.traces.some(t => !t.dash)
      ? '<span><i class="line-key"></i>Transmission</span><span><i class="line-key dashed"></i>Reflexion</span>' : '';
    if (!items.length && !lines) return '';
    return '<div class="mode-legend">' + items.map(([, color, label]) => '<span><i style="--c:' + color + '"></i>' + label + '</span>').join('') + lines + '</div>';
  }

  const MARKER_COLORS = ['#2b2a27', '#c4622d', '#6a4fb3', '#1e7f78'];

  function markerInput(i) {
    const count = state.markers.filter(m => m !== null).length;
    return '<div class="marker-unit' + (state.activeMarker === i ? ' is-active' : '') + '" data-marker-unit="' + i + '" style="--mk:' + MARKER_COLORS[i] + '">' +
      actionButton('M' + (i + 1), 'active-marker', i, 'marker-name', '', pressed(state.activeMarker === i) + ' aria-label="Marker ' + (i + 1) + ' wählen"') +
      '<input id="marker-' + i + '" type="text" inputmode="decimal" aria-label="Frequenz M' + (i + 1) + '" title="Frequenz, z. B. 10 MHz oder 10M" autocomplete="off" value="' +
      esc(freqInput(state.dataset.freq[state.markers[i]])) + '">' +
      (count > 0 ? actionButton('', 'remove-marker', i, 'marker-remove', 'close', ' title="Marker ' + (i + 1) + ' entfernen" aria-label="Marker ' + (i + 1) + ' entfernen"') : '') + '</div>';
  }

  function renderMarker(rebuild = false) {
    const view = state.view, fs = state.dataset.freq;
    const used = state.markers.map((m, i) => m === null ? null : i).filter(i => i !== null);
    if (rebuild || !$('marker-data') || $('marker-panel').dataset.count !== String(used.length)) {
      $('marker-panel').dataset.count = String(used.length);
      $('marker-panel').innerHTML = '<div class="marker-tools"><div class="marker-controls">' + used.map(markerInput).join('') +
        (used.length < 4 ? actionButton('Marker', 'add-marker', '', 'button add-marker', 'plus', ' title="Weiteren Marker setzen (bis M4)"') : '') +
        '</div><span class="peak-buttons" role="group" aria-label="Markersuche">' +
        actionButton('Min', 'peak', 'min', 'button', '', ' title="Aktiven Marker auf das Minimum der ersten sichtbaren Kurve im Ausschnitt setzen"') +
        actionButton('Max', 'peak', 'max', 'button', '', ' title="Aktiven Marker auf das Maximum der ersten sichtbaren Kurve im Ausschnitt setzen"') +
        '</span></div><div id="marker-data"></div>';
    }
    for (const i of used) {
      const input = $('marker-' + i);
      if (!input) continue;
      if (document.activeElement !== input) input.value = freqInput(fs[state.markers[i]]);
      input.parentElement.classList.toggle('is-active', i === state.activeMarker);
      input.previousElementSibling.setAttribute('aria-pressed', String(i === state.activeMarker));
    }
    const visible = view.traces.filter(t => t.visible);
    const activeIndex = state.markers[state.activeMarker];
    const reference = state.markers[0];
    const showDelta = state.activeMarker !== 0 && reference !== null && activeIndex !== null;
    const rows = visible.map(t => {
      const raw = complexAt(t.complex, activeIndex);
      let delta = traceValue(t, activeIndex) - traceValue(t, reference);
      if (view.format === 'phase' && Number.isFinite(delta)) delta = ((delta + 180) % 360 + 360) % 360 - 180;
      return '<tr><td><span class="table-name"><span class="trace-dot' + (t.dash ? ' is-dashed' : '') + '" style="--trace:' + t.color + '"></span>' + esc(t.label) +
        '</span></td>' + used.map(i => '<td' + (i === state.activeMarker ? ' class="is-active-col"' : '') + '>' + esc(valueWith(traceValue(t, state.markers[i]), view.unit)) + '</td>').join('') +
        (showDelta ? '<td>' + esc(valueWith(delta, view.unit)) + '</td>' : '') +
        (view.smith ? '<td>' + esc(complexText(raw?.every(Number.isFinite) ? RF.reflection(raw, view.smithRef) : null, 'Ω')) + '</td>' : '') + '</tr>';
    }).join('');
    if (!rows) {
      $('marker-data').innerHTML = '<p class="marker-notice">Für die Markerwerte muss mindestens eine Kurve sichtbar sein.</p>';
      return;
    }
    if (!used.length) {
      $('marker-data').innerHTML = '<p class="marker-notice">Kein Marker gesetzt. Tippe ins Diagramm oder auf „Marker“.</p>';
      return;
    }
    const k = state.activeMarker + 1;
    $('marker-data').innerHTML = '<div class="table-scroll"><table class="data-table marker-table"><thead><tr><th scope="col">Kurve</th>' +
      used.map(i => '<th scope="col"' + (i === state.activeMarker ? ' class="is-active-col"' : '') + '><span class="mk-dot" style="--mk:' + MARKER_COLORS[i] + '"></span>M' + (i + 1) + ' · ' + esc(hz(fs[state.markers[i]])) + '</th>').join('') +
      (showDelta ? '<th scope="col">Δ M' + k + '−M1 · ' + esc(hz(fs[activeIndex] - fs[reference])) + '</th>' : '') +
      (view.smith ? '<th scope="col">Zᵢₙ · M' + k + '</th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function setMarker(marker, index) {
    if (!state.view || marker < 0 || marker > 3 || index === null) return;
    state.markers[marker] = index;
    state.activeMarker = marker;
    updatePlot(true);
    renderTraces();
    renderMarker(false);
    renderDetails();
    persistSettings();
  }

  function enterMarker(input) {
    const marker = Number(input.id.split('-')[1]), value = parseHz(input.value);
    const fs = state.dataset.freq;
    if (!Number.isFinite(value) || value < fs[0] || value > fs.at(-1)) {
      toast('Wähle eine Frequenz innerhalb des Messbereichs.');
      input.value = freqInput(fs[state.markers[marker]]);
      return;
    }
    setMarker(marker, Plot.nearest(fs, value));
    input.value = freqInput(fs[state.markers[marker]]);
  }

  function peakSearch(kind) {
    const trace = state.view?.traces.find(t => t.visible);
    if (!trace) { toast('Blende zuerst eine Kurve ein.'); return; }
    const fs = state.dataset.freq, range = axis().xRange || [fs[0], fs.at(-1)];
    let best = null;
    for (let i = 0; i < fs.length; i++) {
      const v = trace.values[i];
      if (fs[i] < range[0] || fs[i] > range[1] || !Number.isFinite(v)) continue;
      if (best === null || (kind === 'max' ? v > trace.values[best] : v < trace.values[best])) best = i;
    }
    if (best === null) { toast('Im Ausschnitt gibt es keine gültigen Werte.'); return; }
    setMarker(state.activeMarker, best);
    toast('M' + (state.activeMarker + 1) + ' → ' + (kind === 'max' ? 'Maximum' : 'Minimum') + ' von ' + trace.label + ' bei ' + hz(fs[best]));
  }

  function switchMarker(index) {
    if (state.markers[index] !== null) setMarker(index, state.markers[index]);
  }

  function addMarker() {
    const fs = state.dataset.freq;
    const slot = state.markers.findIndex(m => m === null);
    if (slot < 0) { toast('Es sind bereits vier Marker gesetzt.'); return; }
    const from = state.markers[state.activeMarker] ?? state.markers.find(m => m !== null) ?? 0;
    const offset = Math.max(1, Math.round(fs.length / 10));
    state.markers[slot] = from + offset < fs.length ? from + offset : Math.max(0, from - offset);
    state.activeMarker = slot;
    updatePlot();
    renderTraces();
    renderMarker(true);
    renderDetails();
    persistSettings();
    $('marker-' + slot)?.focus({ preventScroll: true });
  }

  function removeMarker(value) {
    const i = Number(value);
    state.markers[i] = null;
    if (state.activeMarker === i) state.activeMarker = Math.max(0, state.markers.findIndex(m => m !== null));
    updatePlot();
    renderTraces();
    renderMarker(true);
    renderDetails();
    persistSettings();
  }

  function renderMatrix() {
    const modes = currentModes();
    const modalCount = modes.filter(mode => mode.type !== 'P').length;
    const selected = state.sKeys[state.basis];
    const blockStart = i => i > 0 && modes[i].type !== modes[i - 1].type ? ' class="block-start"' : '';
    const familyName = {
      dd: 'Differential → Differential', cc: 'Gleichtakt → Gleichtakt',
      dc: 'Konversion Gleichtakt → Differential (Störfestigkeit)', cd: 'Konversion Differential → Gleichtakt (Abstrahlung)',
      p: 'mit Einzelport', se: 'Single Ended'
    };
    const tag = mode => '<span class="mode-tag" style="--c:' + MODE_COLOR[mode.type] + '">' + esc(mode.key) + '</span>';
    const cells = modes.map((row, i) => '<tr' + blockStart(i) + '><th scope="row" title="' + esc(modeLabel(row)) + '">' + tag(row) + '</th>' +
      modes.map((col, j) => {
        const key = traceKey(row, col), label = traceLabel(row, col), family = traceFamily(row, col);
        return '<td' + blockStart(j) + '><button class="matrix-cell fam-' + family + (i === j ? ' is-reflection' : '') + '" type="button" id="matrix-' + i + '-' + j +
          '" data-action="select-curve" data-value="' + esc(key) + '"' + pressed(selected.includes(key)) +
          ' title="' + esc(row.key + ' ← ' + col.key + ' · ' + familyName[family] + (i === j ? ' · Reflexion' : ' · Transmission')) + '">' +
          esc(label) + '</button></td>';
      }).join('') + '</tr>').join('');
    const legend = state.basis === 'mm'
      ? '<div class="mode-legend matrix-legend"><span><i style="--c:var(--mode-d)"></i>DD Differential</span><span><i style="--c:var(--mode-c)"></i>CC Gleichtakt</span>' +
        '<span><i style="--c:var(--mode-dc)"></i>Sdc C→D · Störfestigkeit</span><span><i style="--c:var(--mode-cd)"></i>Scd D→C · Abstrahlung</span>' + (modes.some(m => m.type === 'P') ? '<span><i style="--c:var(--mode-p)"></i>Einzelport</span>' : '') +
        '<span>Zeile = Antwort · Spalte = Anregung · Diagonale = Reflexion</span></div>' : '';
    const content = $('matrix-content');
    const previous = content.querySelector('.matrix-scroll');
    const position = previous ? [previous.scrollLeft, previous.scrollTop] : [0, 0];
    insertHtml(content, '<div class="matrix-actions">' +
      actionButton('Standard', 'curve-preset', 'default') + (['cmc', 'lan'].includes(deviceType()) && state.basis === 'mm' ? actionButton('Erweitert', 'curve-preset', 'ext') : '') + actionButton('Übertragung', 'curve-preset', 'through') +
      actionButton('Reflexion', 'curve-preset', 'reflect') +
      (state.basis === 'mm' ? actionButton('Modenkonversion', 'curve-preset', 'convert') : '') +
      (modes.length ** 2 <= MAX_TRACES ? actionButton('Alle ' + modes.length ** 2, 'curve-preset', 'all') : '') +
      (modalCount === 4 && modes.length > 4 ? actionButton('16 Mixed Mode', 'curve-preset', 'modal-all') : '') +
      actionButton('Leeren', 'curve-preset', 'clear') + '</div>' + legend + '<div class="matrix-scroll">' +
      '<table class="matrix-table"><thead><tr><th scope="col">↓ / →</th>' +
      modes.map((mode, j) => '<th scope="col"' + blockStart(j) + ' title="' + esc(modeLabel(mode)) + '">' + tag(mode) + '</th>').join('') +
      '</tr></thead><tbody>' + cells + '</tbody></table></div><p class="matrix-meta">' + selected.length + ' / ' + MAX_TRACES + ' Kurven ausgewählt</p>');
    content.querySelector('.matrix-scroll').scrollTo(...position);
  }

  function pickCurves() {
    renderMatrix();
    openDialog('matrix-dialog');
  }

  function selectCurve(key) {
    const selected = state.sKeys[state.basis];
    if (selected.includes(key)) {
      state.sKeys[state.basis] = selected.filter(entry => entry !== key);
    } else if (selected.length < MAX_TRACES) {
      selected.push(key);
      state.hiddenTraces.delete('s:' + state.basis + ':' + key);
    } else {
      toast('Es sind bereits ' + MAX_TRACES + ' Kurven ausgewählt.');
      return;
    }
    rememberCurves();
    renderMatrix();
    renderAnalysis();
  }

