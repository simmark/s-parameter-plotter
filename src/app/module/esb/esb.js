// module/esb/esb – ESB-Tab: Modellwahl (CMC, Übertrager, Einzelbauteil), Ansichten und SPICE-Export des Modells.
import { renderAnalysis } from '../../analyse/darstellung.js';
import { cache, selectedPairs } from '../../analyse/daten.js';
import { detectModel, elementPhysics, windingPhysics } from '../../analyse/erkennung.js';
import { currentModes, getView, modeOptions } from '../../analyse/kurven.js';
import { chooseMode, controlsPairs, renderControls } from '../../analyse/steuerung.js';
import { $, actionButton, esc, help, icon, selectField, textField, toast } from '../../basis/dom.js';
import { registerActions, registerChanges, registerForms, registerView } from '../../basis/erweiterung.js';
import { MODE_PALETTE, REFLECTION_DASH } from '../../basis/farben.js';
import { display, freqInput, hz, omega, parseHz, portName, valueWith } from '../../basis/format.js';
import { tx } from '../../basis/sprache.js';
import { axis, state } from '../../basis/zustand.js';
import { ingest, newBag } from '../../dateien/import.js';
import { fileDesc } from '../../dateien/sitzung.js';
import { currentElement, elementView, modelApply, modelEditor, multiElement, trafoLowLeak } from './modelleditor.js';
import { cmcView, focusAround, transformerSchematic } from './schaltbilder.js';
import { saveBlob } from '../../oberflaeche/export.js';

function naturalData(pairs) {
  const view = getView('se');
  const active = state.layout.active;
  const map = pairs.flatMap(pair => [active.indexOf(pair.p), active.indexOf(pair.q)]);
  return cache('natural:' + map.join(':'), () => Array.from(state.dataset.freq, (f, i) =>
    view.samples[i] && RF.cmcNatural(RF.submatrix(view.samples[i], active.length, map), map.map(p => view.modes[p].ref), f)));
}

function metric(label, value, unit) {
  return '<div class="metric"><strong>' + esc(valueWith(value, unit)) + '</strong><span>' + esc(label) + '</span></div>';
}

// First crossing of Im(Y) from inductive (negative) to capacitive (positive), interpolated on a log axis.
function selfResonance(natural, key) {
  const fs = state.dataset.freq;
  let prev = null;
  for (let i = 0; i < fs.length; i++) {
    const b = natural[i]?.[key]?.[1];
    if (!(fs[i] > 0) || !Number.isFinite(b)) { prev = null; continue; }
    if (prev && prev.b < 0 && b >= 0) {
      const t = -prev.b / (b - prev.b);
      return Math.exp(Math.log(prev.f) + t * (Math.log(fs[i]) - Math.log(prev.f)));
    }
    prev = { f: fs[i], b };
  }
  return NaN;
}

function fitDetails(fit, band, resonance = {}) {
  const unphysical = [fit.cw, fit.cg, fit.ctH, fit.ctD].some(value => Number.isFinite(value) && value < 0);
  const missing = ![fit.lcm, fit.ldm].every(Number.isFinite);
  return '<section class="detail-card"><div class="fit-summary"><h3>Ersatzschaltbild · Fit</h3><small>' +
    esc(hz(band[0]) + ' – ' + hz(band[1]) + ' · ' + fit.count + ' Punkte') + '</small></div>' +
    (fit.count < 3 ? '<p class="inline-notice">Im Fit-Band sind mindestens drei gültige positive Frequenzpunkte nötig.</p>' :
      '<div class="metric-grid">' + metric('Cw · Koppelkapazität je Seite', fit.cw * 1e12, 'pF') +
      metric('Ct · Wicklung (H-Mode)', fit.ctH * 1e12, 'pF') + metric('Cg · je Anschluss', fit.cg * 1e12, 'pF') +
      metric('L · je Wicklung', fit.l * 1e6, 'µH') + metric('M · Gegeninduktivität', fit.m * 1e6, 'µH') +
      metric('k · M/L', fit.k, '') +
      '<div class="metric"><strong>' + esc(Number.isFinite(resonance.cm) ? hz(resonance.cm) : '—') + '</strong><span>Eigenresonanz CM · H-Mode</span></div>' +
      '<div class="metric"><strong>' + esc(Number.isFinite(resonance.dm) ? hz(resonance.dm) : '—') + '</strong><span>Eigenresonanz DM · D-Mode</span></div>' +
      '</div><p class="diagnostics">' +
      esc('L+M ' + valueWith(fit.lcm * 1e6, 'µH') + ' · L−M ' + valueWith(fit.ldm * 1e6, 'µH') +
        ' · Ct aus D ' + valueWith(fit.ctD * 1e12, 'pF') + ' · Fitrest H/D ' +
        valueWith(100 * fit.hError, '%') + ' / ' + valueWith(100 * fit.dError, '%') +
        ' · Modenkopplung im Y-Modell ' + valueWith(100 * fit.coupling, '%')) + '</p>') +
    (fit.count >= 3 && (unphysical || missing) ?
      '<p class="inline-notice">Der Fit liefert für dieses Band negative Kapazitäten oder keine gültige Induktivität. Prüfe Portpolarität, DUT-Symmetrie und Fit-Band.</p>' : '') +
    '</section>';
}

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

registerActions({
  'eval-marker': () => { const i = state.markers[state.activeMarker]; if (i === null || i === undefined) { toast('Setze zuerst einen Marker auf die Messkurve.'); return; } setEvalFreq(state.dataset.freq[i]); },
});

registerForms({
  'eval-form': form => setEvalFreq(parseHz(new FormData(form).get('eval'))),
  'fit-form': applyFit,
});

function esbControls() {
  const model = esbModel();
  const level = state.esb.model === 'auto' && ['series', 'shunt'].includes(model) ? detectModel().level : null;
  const autoLabel = 'Automatisch · ' + (model === 'transformer' ? 'Übertrager' : model === 'cmc' ? 'CMC' : model === 'shunt' ? 'kapazitiv' : 'induktiv') + (level ? ' · ' + LEVEL_NAME[level] : '');
  let html = selectField('Modell', 'esb-model', ESB_MODELS.map(([key, label]) => [key, key === 'auto' ? autoLabel : label]), state.esb.model);
  if (model === 'transformer') {
    html += controlsPairs() + selectField('Darstellung', 'esb-tformat', TRANSFORMER_FORMATS, state.esb.tFormat) +
      '<form class="fit-fields" id="eval-form">' + textField('Auswertung bei', 'eval', freqInput(state.esb.evalFreq)) + '<button class="button" type="submit">Anwenden</button>' +
      actionButton('= Marker', 'eval-marker', '', 'button', '', ' title="Die Frequenz des aktiven Markers als Auswertefrequenz für OCL, n und k übernehmen"') + '</form>';
  } else if (model === 'series' || model === 'shunt') {
    const fixture = esbFixture(model);
    html += selectField('Fixture', 'esb-fixture', ESB_FIXTURES.map(([key, label]) => [key, key === 'auto' ? 'Automatisch · ' + FIXTURE_NAME[fixture] : label]), state.esb.fixture || 'auto') +
      selectField(fixture === 'reflection' ? 'Port / Mode' : 'Eingang', 'esb-input', modeOptions(), state.esb.input) +
      (fixture === 'reflection' ? '' : selectField('Ausgang', 'esb-output', modeOptions(), state.esb.output)) +
      selectField('Darstellung', 'esb-eformat', model === 'series' ? SERIES_FORMATS : SHUNT_FORMATS, state.esb.eFormat);
  } else {
    html += controlsPairs() + selectField('Darstellung', 'cmc-format', [['cap', 'Kapazitäten'], ['ind', 'Induktivitäten'], ['zesb', 'Impedanz · Ersatzschaltbild (Editor)'], ['zfit', 'Impedanz · je Mode bis 2. Resonanz']], state.cmc.format);
  }
  if (model === 'cmc' && state.config.pairs.length >= 2) {
    html += '<form class="fit-fields" id="fit-form">' + textField('Fit ab', 'start', freqInput(state.cmc.band[0])) +
      textField('Fit bis', 'stop', freqInput(state.cmc.band[1])) + '<button class="button" type="submit">Fit anwenden</button></form>';
  }
  return html;
}

function applyFit(form) {
  const data = new FormData(form);
  const start = parseHz(data.get('start')), stop = parseHz(data.get('stop'));
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !(start > 0 && stop > start)) {
    toast('Gib ein positives, aufsteigendes Fit-Band ein.');
    return;
  }
  state.cmc.band = [start, stop];
  renderControls();
  renderAnalysis();
}
function setEvalFreq(f) {
  const fs = state.dataset.freq;
  if (!(f > 0) || f < fs[0] || f > fs.at(-1)) { toast('Wähle eine Frequenz innerhalb des Messbereichs.'); return; }
  state.esb.evalFreq = f;
  renderControls();
  renderAnalysis();
  toast('Auswertefrequenz ' + hz(f) + ' · OCL, n und k werden dort bestimmt');
}

registerView({
  id: 'cmc', title: 'ESB-Modell', basis: () => ['series', 'shunt'].includes(esbModel()),
  context: 'Ersatzschaltbilder: CMC, Übertrager und Einzelbauteile', plot: esbView, controls: esbControls,
});

registerChanges({
  'cmc-format': value => { axis().yRange = null; state.cmc.format = value; },
  'esb-model': value => { state.esb.model = value; axis().yRange = null; },
  'esb-fixture': value => { state.esb.fixture = value; axis().yRange = null; },
  'esb-tformat': value => { state.esb.tFormat = value; axis().yRange = null; },
  'esb-eformat': value => { state.esb.eFormat = value; axis().yRange = null; },
  'esb-input': value => chooseMode(state.esb, 'input', value, true),
  'esb-output': value => chooseMode(state.esb, 'output', value, true),
});

function exportModel(mode) {
  const form = $('model-form');
  if (form) modelApply(form);
  const model = currentElement()?.model;
  if (!model) return;
  const name = state.dataset.name.replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') + '_ESB';
  const file = new File([RF.modelNetlist(model, name)], name + '.lib', { type: 'text/plain' });
  if (mode === 'save') saveBlob(file, file.name);
  else ingest({ ...newBag(), files: [fileDesc(file)] });
}

registerActions({ 'esb-spice': exportModel });

export { naturalData, metric, selfResonance, fitDetails, FIXTURE_NAME, LEVEL_NAME, esbModel, scaled, transformerData,
  elementData, esbView };
