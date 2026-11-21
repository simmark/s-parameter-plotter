// module/esb/schaltbilder – Schaltbilder mit den Werten des Fits.
import { modalCispr } from '../../analyse/cispr.js';
import { cache, selectedPairs } from '../../analyse/daten.js';
import { $, actionButton, esc, help } from '../../basis/dom.js';
import { registerActions } from '../../basis/erweiterung.js';
import { COLORS } from '../../basis/farben.js';
import { display, hz, metricText, omega, portName, si } from '../../basis/format.js';
import { state } from '../../basis/zustand.js';
import { fitDetails, naturalData, selfResonance } from './esb.js';
import { modelEditor, multiElement } from './modelleditor.js';

// ---- Circuit drawings whose labels carry the values of the fit. Strokes use the text colour, so they work in both themes. ----
const Sch = {
  h: (x1, x2, y) => '<path d="M' + x1 + ' ' + y + 'H' + x2 + '"/>',
  v: (x, y1, y2) => '<path d="M' + x + ' ' + y1 + 'V' + y2 + '"/>',
  res: (x, y) => '<rect x="' + x + '" y="' + (y - 7) + '" width="34" height="14" rx="2"/>',
  coil: (x, y, turns = 3) => '<path d="M' + x + ' ' + y + 'a6 6 0 0 1 12 0'.repeat(turns) + '"/>',
  cap: (x, y) => '<path d="M' + (x + 14) + ' ' + (y - 9) + 'v18m6-18v18M' + x + ' ' + y + 'h14m6 0h14"/>',
  vres: (x, y) => '<rect x="' + (x - 7) + '" y="' + y + '" width="14" height="34" rx="2"/>',
  vcoil: (x, y, turns = 3, side = 1) => '<path d="M' + x + ' ' + y + ('a6 6 0 0 ' + (side ? 1 : 0) + ' 0 12').repeat(turns) + '"/>',
  vcap: (x, y) => '<path d="M' + (x - 9) + ' ' + (y + 14) + 'h18m-18 6h18M' + x + ' ' + y + 'v14m0 6v14"/>',
  gnd: (x, y) => '<path d="M' + (x - 9) + ' ' + y + 'h18m-14 4h10m-7 4h4"/>',
  term: (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="3.2"/>',
  dot: (x, y) => '<circle class="sch-dot" cx="' + x + '" cy="' + y + '" r="2.4"/>',
  // two lines: name on top, value below; anchor 'middle', 'start' or 'end'
  label: (x, y, name, value, anchor = 'middle') => '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '">' + esc(name) + '</text>' +
    (value === null ? '' : '<text class="value" x="' + x + '" y="' + (y + 12) + '" text-anchor="' + anchor + '">' + esc(value) + '</text>')
};
const schematicFigure = (id, title, label, width, height, strokes, texts, caption, extra = '') =>
  '<figure class="detail-card cmc-schematic" id="' + id + '"><div class="fit-summary"><h3>' + esc(title) + '</h3>' +
  actionButton('Vergrößern', 'schematic-zoom', id, 'quiet-button', '', ' title="Schaltbild vergrößern oder wieder einpassen; vergrößert lässt es sich verschieben"') + '</div>' +
  '<div class="schematic-box"><svg class="value-schematic" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(label) + '">' +
  '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' + strokes + '</g>' +
  '<g fill="currentColor" font-size="11" font-weight="650">' + texts + '</g></svg></div>' +
  '<figcaption>' + esc(caption) + '</figcaption>' + extra + '</figure>';

// Losses of the CMC from the modal impedances: Z_DM = 2·Z_winding (leakage path), Z_CM = Z_winding/2 (coupled path).
function cmcLoss(pairs) {
  try {
    const [cm, dm] = modalCispr(pairs).blocks, fs = state.dataset.freq;
    const fits = cache('zfit:' + pairs.map(p => p.id).join(':'), () => [cm, dm].map(block => RF.fitResonant(fs, Array.from(fs, (_, i) => block[i]?.z ?? null))));
    const peak = fits[0]?.tanks[0]?.r;
    return { rw: fits[1] ? fits[1].r0 / 2 : NaN, rfe: Number.isFinite(peak) ? 2 * peak : NaN };
  } catch { return { rw: NaN, rfe: NaN }; }
}

// CMC: per winding R_w and the leakage L_σ = L − M in series with the coupled part M; C_t across each winding,
// C_w between the windings on each side, C_g from every terminal to ground. This is the circuit the fit assumes.
const EDITED_NOTE = '<p class="inline-notice" id="schematic-edited">Das Bild zeigt die Werte aus dem Modell-Editor, nicht die der automatischen Auswertung.</p>';
function cmcSchematic([input, output], fit = {}, loss = {}, edited = false) {
  const S = Sch, strokes = [], texts = [], rows = [104, 258];
  // A model element cannot be negative. A fit band that does not determine an element yields such a value: it is shown as
  // "not determinable" and named below, instead of presenting an unphysical number as a result.
  const bad = [];
  const val = (v, unit, name = '') => { if (Number.isFinite(v) && v > 0) return si(v, unit); if (name && Number.isFinite(v)) bad.push(name); return 'n. b.'; };
  const leak = fit.l - fit.m;
  rows.forEach((y, r) => {
    const up = r === 0, side = up ? -1 : 1, yt = y + side * 62, yr = y + side * 30;
    strokes.push(S.term(26, y), S.h(29, 136, y), S.res(136, y), S.h(170, 196, y), S.coil(196, y), S.h(232, 282, y), S.coil(282, y, 4), S.h(330, 591, y), S.term(594, y));
    // core loss across the coupled part, turn capacitance across the whole winding
    strokes.push(S.v(270, y, yr), S.v(342, y, yr), S.h(270, 289, yr), S.res(289, yr), S.h(323, 342, yr));
    strokes.push(S.v(120, y, yt), S.v(500, y, yt), S.h(120, 293, yt), S.cap(293, yt), S.h(327, 500, yt));
    strokes.push(S.dot(120, y), S.dot(500, y), S.dot(270, y), S.dot(342, y), S.dot(60, y), S.dot(560, y), S.dot(92, y), S.dot(528, y));
    texts.push(S.label(153, y + (up ? 24 : -30), 'R_w', val(loss.rw, 'Ω')), S.label(214, y + (up ? 24 : -30), 'Lσ', val(leak, 'H', up ? 'Lσ' : '')));
    texts.push(S.label(352, yr + 4, 'R_Fe', loss.sections?.length > 1 ? loss.sections.length + ' Glieder' : val(loss.rfe, 'Ω'), 'start'), S.label(310, yt + (up ? -26 : 22), 'Ct', val(up ? fit.ctH : fit.ctD, 'F', up ? 'Ct (aus dem Gleichtakt)' : 'Ct (aus dem Gegentakt)')));
    // capacitance to ground at both terminals
    for (const x of [60, 560]) {
      strokes.push(S.vcap(x, y), S.gnd(x, y + 34));
      texts.push(S.label(x + (x < 300 ? -13 : 13), y + 24, 'Cg', val(fit.cg, 'F', up && x < 300 ? 'Cg' : ''), x < 300 ? 'end' : 'start'));
    }
    strokes.push(S.dot(288, y - 12 * 1 - 2));
  });
  // winding-to-winding capacitance on both sides, magnetic coupling between the two coupled inductors
  for (const x of [92, 528]) {
    strokes.push(S.v(x, rows[0], 164), S.vcap(x, 164), S.v(x, 198, rows[1]));
    texts.push(S.label(x + (x < 300 ? 14 : -14), 178, 'Cw', val(fit.cw, 'F', x < 300 ? 'Cw' : ''), x < 300 ? 'start' : 'end'));
  }
  strokes.push('<path d="M284 174h44m-44 8h44"/>');
  texts.push(S.label(306, 158, 'M', val(fit.m, 'H', 'M')), S.label(306, 200, 'k', Number.isFinite(fit.k) ? display(fit.k) : '—'));
  texts.push(S.label(26, rows[0] - 12, portName(input.p) + ' +', null), S.label(594, rows[0] - 12, portName(output.p) + ' +', null),
    S.label(26, rows[1] - 12, portName(input.q) + ' −', null), S.label(594, rows[1] - 12, portName(output.q) + ' −', null));
  const warn = bad.length ? '<p class="inline-notice" id="cmc-unphysical">Im gewählten Fit-Band nicht bestimmbar (der Fit liefert einen negativen Wert): ' + esc(bad.join(', ')) +
    '. Wähle ein Band, in dem dieses Element die Kurve prägt – für Kapazitäten reicht es meist, das Band zu höheren Frequenzen zu erweitern.</p>' : '';
  const table = (edited ? EDITED_NOTE : '') + warn + '<div class="metric-grid">' + metricText('L · Induktivität je Wicklung', val(fit.l, 'H')) + metricText('M · Gegeninduktivität', val(fit.m, 'H')) +
    metricText('k = M/L', Number.isFinite(fit.k) ? display(fit.k) : '—') + metricText('Lσ = L − M · Streuung je Wicklung', val(leak, 'H')) +
    metricText(edited ? 'R_w · je Wicklung' : 'R_w · je Wicklung, aus R₀ von Z DM / 2', val(loss.rw, 'Ω')) + (loss.sections?.length > 1 ? loss.sections.map(([m, r], k) => metricText('Kernglied ' + (k + 1) + ' · M ∥ R_Fe', si(m, 'H') + ' ∥ ' + val(r, 'Ω'))).join('') + metricText('M · Summe der Kernglieder, im Bild als ein Glied', val(fit.m, 'H'))
      : metricText(edited ? 'R_Fe · je Wicklung' : 'R_Fe · je Wicklung, aus der CM-Resonanz × 2', val(loss.rfe, 'Ω'))) +
    (edited && fit.cx > 0 ? metricText('Cx · diagonal, im Bild nicht gezeichnet', si(fit.cx, 'F')) : '') +
    (edited && loss.rls > 0 ? metricText('R_σ · parallel zu Lσ, im Bild nicht gezeichnet', si(loss.rls, 'Ω')) : '') + '</div>' +
    '<p class="note">Normierung: Im Gleichtakt liegen beide Wicklungen parallel, Z CM = jω(L + M)/2 an 25 Ω. Im Gegentakt liegen sie in Reihe, Z DM = j2ω(L − M) = j2ωLσ an 100 Ω. ' +
    'L, M, Cw, Cg und Ct stammen aus dem Fit im gewählten Band. R_w und R_Fe stammen aus dem Modell bis zur 2. Resonanz und sind Näherungen: R_Fe gilt nur nahe der Gleichtakt-Resonanz, Kernverluste sind frequenzabhängig.</p>';
  return schematicFigure('cmc-schematic', 'Ersatzschaltbild mit Werten', 'CMC zwischen ' + portName(input.p) + '/' + portName(input.q) + ' und ' + portName(output.p) + '/' + portName(output.q),
    620, 362, strokes.join(''), texts.join(''), 'Je Wicklung: R_w und Streuung Lσ in Reihe mit dem gekoppelten Teil M · R_Fe parallel zum gekoppelten Teil · Ct parallel je Wicklung · Cw je Seite zwischen den Wicklungen · Cg je Anschluss gegen Masse', table);
}

// Transformer, referred to the primary: R₁ – Lσ₁ – (L_m ∥ R_Fe) – ideal 1:n – Lσ₂ – R₂, C_p across the primary, C_ww between the windings.
function transformerSchematic([a, b], t, edited = false) {
  const S = Sch, strokes = [], texts = [], top = 86, bot = 206, measuredLeak = t.leakMeasured ?? t.leak;
  const val = (v, unit) => Number.isFinite(v) && v > 0 ? si(v, unit) : '—';
  const half = t.leak > 0 ? t.leak / 2 : NaN, lm = t.ocl > 0 ? t.ocl - (half > 0 ? half : 0) : NaN, n = t.n;
  const ls2 = half > 0 && n > 0 ? half * n * n : NaN, fromK = t.ocl * (1 - t.k * t.k);
  strokes.push(S.term(22, top), S.term(22, bot), S.term(638, top), S.term(638, bot));
  strokes.push(S.h(25, 70, top), S.res(70, top), S.h(104, 130, top), S.coil(130, top), S.h(166, 336, top), S.h(25, 336, bot));
  strokes.push(S.v(48, top, 129), S.vcap(48, 129), S.v(48, 163, bot), S.dot(48, top), S.dot(48, bot));
  strokes.push(S.v(204, top, 128), S.vcoil(204, 128), S.v(204, 164, bot), S.dot(204, top), S.dot(204, bot));
  strokes.push(S.v(250, top, 129), S.vres(250, 129), S.v(250, 163, bot), S.dot(250, top), S.dot(250, bot));
  // ideal transformer: two windings, core lines between them, dots mark the polarity found in the measurement
  strokes.push(S.v(336, top, 122), S.vcoil(336, 122, 4, 1), S.v(336, 170, bot), '<path d="M348 118v56m6-56v56"/>', S.v(366, top, 122), S.vcoil(366, 122, 4, 0), S.v(366, 170, bot));
  strokes.push(S.dot(328, 116), S.dot(374, t.k < 0 ? 176 : 116));
  strokes.push(S.h(366, 412, top), S.coil(412, top), S.h(448, 480, top), S.res(480, top), S.h(514, 635, top), S.h(366, 635, bot));
  // winding-to-winding capacitance
  strokes.push(S.v(48, 40, top), S.h(48, 334, 40), S.cap(334, 40), S.h(368, 612, 40), S.v(612, 40, top), S.dot(612, top));
  texts.push(S.label(87, top - 26, 'R₁', val(t.r1, 'Ω')), S.label(148, top - 26, 'Lσ₁', val(half, 'H')), S.label(430, top - 26, 'Lσ₂', val(ls2, 'H')), S.label(497, top - 26, 'R₂', val(t.r2, 'Ω')));
  texts.push(S.label(60, 142, 'C_p', val(t.cpar > 0 ? t.cpar : t.cres, 'F'), 'start'), S.label(190, 142, 'L_m', val(lm, 'H'), 'end'), S.label(262, 142, 'R_Fe', val(t.rfe, 'Ω'), 'start'));
  texts.push(S.label(351, bot + 18, '1 : n', Number.isFinite(n) ? '1 : ' + display(n) : '—'), S.label(351, 14, 'Cww', val(t.cww, 'F')));
  texts.push(S.label(22, bot + 22, 'Paar ' + a.id, null, 'start'), S.label(638, bot + 22, 'Paar ' + b.id, null, 'end'));
  const agree = !edited && Number.isFinite(fromK) && t.leak > 0 ? Math.abs(fromK / t.leak - 1) : NaN;
  const table = (edited ? EDITED_NOTE : '') + '<div class="metric-grid">' + metricText('L_m · Hauptinduktivität = OCL − Lσ₁', val(lm, 'H')) + metricText('Lσ₁ · primär (Annahme: hälftig)', val(half, 'H')) +
    metricText('Lσ₂ · sekundär = Lσ₁·n²', val(ls2, 'H')) + metricText('n · Übersetzung 1 : n', Number.isFinite(n) ? display(n) : '—') +
    (edited ? metricText('R₁ · Primärwicklung', val(t.r1, 'Ω')) + metricText('R₂ · Sekundärwicklung', val(t.r2, 'Ω')) + metricText('R_Fe · Kernverluste', val(t.rfe, 'Ω')) +
        (t.cp2 > 0 ? metricText('C_p2 · über der Sekundärwicklung, im Bild nicht gezeichnet', val(t.cp2, 'F')) : '') +
        (t.lse > 0 && t.rse > 0 ? metricText('Lσ_e ∥ R_e · Wirbelstromanteil der Streuung, im Bild in Lσ enthalten', val(t.lse, 'H') + ' ∥ ' + val(t.rse, 'Ω')) : '')
      : metricText('R₁ · Re Z₁₁ bei tiefer Frequenz', val(t.r1, 'Ω')) + metricText('R₂ · Re Z₂₂ bei tiefer Frequenz', val(t.r2, 'Ω')) +
        metricText('R_Fe · Re Z₁₁ in der Leerlaufresonanz', val(t.rfe, 'Ω')) + metricText('Lσ aus k · L₁₁(1 − k²)', val(fromK, 'H'))) + '</div>' +
    '<p class="note" id="transformer-limits"><span>Was die Messung festlegt: OCL, n, Cww, C_p, R₁, R₂ und die gesamte Streuinduktivität bei kurzgeschlossener Sekundärseite,</span> <b data-no-i18n>Lσ = ' + esc(val(measuredLeak, 'H')) + '</b>. ' +
    '<span>Was sie nicht festlegt: wie sich die Streuung auf Primär- und Sekundärseite verteilt. Von den Klemmen aus ist nur die Summe messbar; das Bild teilt sie je zur Hälfte auf (Lσ₁ = Lσ₂/n²). Wer die Aufteilung braucht, muss sie aus dem Wickelaufbau oder einer Feldrechnung nehmen.</span> ' +
    '<span>R₁ und R₂ enthalten den Anteil der Kernverluste, der bei der tiefsten Messfrequenz schon wirkt; eine Gleichstrommessung ist genauer. R_Fe ist eine Näherung aus einer einzigen Frequenz; Kernverluste hängen von Frequenz und Aussteuerung ab.</span> ' +
    (Number.isFinite(agree) ? '<span id="transformer-agree" data-agree="' + agree + '">' + (agree > 0.3 ? 'Die Streuung aus dem Kopplungsfaktor weicht um ' + Math.round(100 * agree) + ' % von der Kurzschlussmessung ab. Bei hoher Kopplung ist k sehr empfindlich; die Kurzschlussmessung ist verlässlicher und steht im Bild.'
      : 'Die Streuung aus dem Kopplungsfaktor stimmt mit der Kurzschlussmessung auf ' + Math.round(100 * agree) + ' % überein.') + '</span>' : '') + '</p>';
  return schematicFigure('transformer-schematic', 'T-Ersatzschaltbild mit Werten', 'T-Ersatzschaltbild eines Übertragers mit idealem Übertrager 1 : n', 660, 246, strokes.join(''), texts.join(''),
    'Primärbezogen: R₁ und Lσ₁ in Reihe · L_m parallel R_Fe · idealer Übertrager 1 : n · Lσ₂ und R₂ auf der Sekundärseite · C_p über der Primärwicklung · Cww zwischen den Wicklungen', table);
}

const focusAround = (values, lo, hi) => {
  const list = values.filter(value => Number.isFinite(value) && value > 0);
  return list.length ? [lo * Math.min(...list), hi * Math.max(...list)] : null;
};
const modelTrace = (key, label, color, model) => ({
  key, label, color, dash: [2, 3], visible: !state.hiddenTraces.has(key),
  values: Float64Array.from(state.dataset.freq, f => model && f > 0 && f <= model.fMax ? Math.hypot(...RF.tankImpedance(model, f)) : NaN)
});

function resonantCard(model, title, exportable = false) {
  if (!model) return '<section class="detail-card"><div class="fit-summary"><h3>' + esc(title) + '</h3><small>Für das Modell fehlt ein induktiver Bereich bei tiefen Frequenzen.</small></div></section>';
  const [a, b] = model.tanks;
  return '<section class="detail-card"><div class="fit-summary"><h3>' + esc(title) + '</h3><small>' +
    esc('R₀ + (L₁ ∥ C₁ ∥ R₁)' + (b ? b.c > 0 ? ' + (L₂ ∥ C₂ ∥ R₂)' : ' + L₂' : '') + ' · Fit bis ' + hz(model.fMax) + ' · Abweichung ' + display(model.err) + ' dB RMS') +
    '</small></div><div class="metric-grid">' + metricText('R₀ · Serienwiderstand', si(model.r0, 'Ω')) + metricText('L₁ · Hauptinduktivität', si(a.l, 'H')) +
    (a.c > 0 ? metricText('C₁ · Parallelkapazität', si(a.c, 'F')) + metricText('R₁ · Dämpfung der 1. Resonanz', si(a.r, 'Ω')) + metricText('f₁ · 1. Resonanz (parallel)', hz(model.f1)) : '') +
    (b ? metricText('L₂ · ' + (b.c > 0 ? 'zweiter Kreis' : 'Serieninduktivität'), si(b.l, 'H')) +
      (b.c > 0 ? metricText('C₂ · zweiter Kreis', si(b.c, 'F')) + metricText('R₂ · Dämpfung der 2. Resonanz', si(b.r, 'Ω')) : '') +
      metricText('f₂ · 2. Resonanz (' + (model.second === 'series' ? 'Serie' : 'parallel') + ')', hz(model.f2)) : '') + '</div>' +
    (a.c > 0 ? '' : '<p class="note">Im Messbereich liegt keine Resonanz. Das Modell besteht nur aus R₀ und L₁.</p>') +
    (exportable ? '<div class="preset-row">' + actionButton('Als SPICE-Modell öffnen', 'esb-spice', 'open', 'button', 'plus') + actionButton('SPICE .lib speichern', 'esb-spice', 'save', 'button', 'file') + '</div>' : '') +
    '</section>';
}

function cmcResonantView(pairs) {
  const [cm, dm] = modalCispr(pairs).blocks, fs = state.dataset.freq;
  const fits = cache('zfit:' + pairs.map(p => p.id).join(':'), () => [cm, dm].map(block => RF.fitResonant(fs, Array.from(fs, (_, i) => block[i]?.z ?? null))));
  const measured = (key, label, color, block) => ({ key, label, color, visible: !state.hiddenTraces.has(key), values: Float64Array.from(fs, (_, i) => block[i]?.z ? Math.hypot(...block[i].z) : NaN) });
  return {
    traces: [measured('zf:cm', '|Z CM|', COLORS[1], cm), modelTrace('zf:cmm', 'Modell CM', COLORS[1], fits[0]), measured('zf:dm', '|Z DM|', COLORS[0], dm), modelTrace('zf:dmm', 'Modell DM', COLORS[0], fits[1])],
    unit: 'Ω', yLabel: 'Impedanz [Ω]', positive: true, title: 'CMC · Ersatzschaltbild bis zur 2. Resonanz', caption: 'Z CM und Z DM nach CISPR 17 · Modell gepunktet', native: '',
    details: () => resonantCard(fits[0], 'Gleichtakt · Z CM') + resonantCard(fits[1], 'Gegentakt · Z DM') +
      '<p class="note">Jede Mode wird als Reihenschaltung aus R₀ und bis zu zwei Parallelschwingkreisen beschrieben. Startwerte: L₁ aus dem LC-Fit, C₁ über die Thomson-Gleichung aus der 1. Resonanz, L₂ aus der Serienresonanz. Danach passt ein Simplex-Verfahren Betrag und Phase an. ' + help + '</p>'
  };
}

function cmcView() {
  const pairs = selectedPairs();
  if (!pairs) return { empty: 'Definiere zwei Portpaare und ordne Plus und Minus an beiden Seiten entlang derselben Wicklungen zu.', needsPairs: true };
  if (state.cmc.format === 'zfit') return cmcResonantView(pairs);
  const dataset = state.dataset, natural = naturalData(pairs), band = state.cmc.band;
  const key = pairs.map(p => p.id).join(':');
  const fit = cache('fit:' + key + ':' + band.join(':'), () => RF.fitCMC(dataset.freq, natural, ...band));
  const resonance = cache('srf:' + key, () => ({ cm: selfResonance(natural, 'h'), dm: selfResonance(natural, 'd') }));
  const isCap = state.cmc.format === 'cap', isZ = state.cmc.format === 'zesb', unit = isZ ? 'Ω' : isCap ? 'pF' : 'µH';
  const em = multiElement('cmc'), [cmZ, dmZ] = modalCispr(pairs).blocks;
  const mz = em ? Array.from(dataset.freq, f => f > 0 ? RF.cmcModelZ(em.model, f, em.data.meas.refCm, em.data.meas.refDm) : null) : null;
  const mag = z => z ? Math.hypot(z[0], z[1]) : NaN;
  let list, extra = [];
  if (isZ) {
    list = [['|Z CM|', COLORS[1], i => mag(cmZ[i]?.z)], ['|Z DM|', COLORS[0], i => mag(dmZ[i]?.z)]];
    if (mz) extra = [['Modell CM', COLORS[1], i => mag(mz[i]?.cm)], ['Modell DM', COLORS[0], i => mag(mz[i]?.dm)]];
  } else if (isCap) {
    if (em) extra = [['Modell Cw', COLORS[1], () => em.model.cw * 1e12], ['Modell Cg', COLORS[0], () => em.model.cg * 1e12], ['Modell Ct', COLORS[2], () => em.model.ct * 1e12]];
    list = [
      ['Cw', COLORS[1], i => natural[i]?.cw * 1e12],
      ['Cg', COLORS[0], i => natural[i]?.cg * 1e12],
      ['Ct (H)', COLORS[2], (i, f) => {
        const h = natural[i]?.h;
        if (!h || !Number.isFinite(fit.lcm) || !Number.isFinite(fit.cg)) return NaN;
        return ((h[1] + 2 / (omega(f) * fit.lcm)) / omega(f) - fit.cg) * 0.5e12;
      }]
    ];
  } else {
    const [cm, dm] = modalCispr(pairs).blocks;
    list = [
      ['L+M', COLORS[1], (i, f) => Number.isFinite(cm[i]?.z?.[1]) && f > 0 ? 2e6 * cm[i].z[1] / omega(f) : NaN],
      ['L−M', COLORS[0], (i, f) => Number.isFinite(dm[i]?.z?.[1]) && f > 0 ? 0.5e6 * dm[i].z[1] / omega(f) : NaN]
    ];
    if (mz) extra = [['Modell L+M', COLORS[1], (i, f) => mz[i]?.cm ? 2e6 * mz[i].cm[1] / omega(f) : NaN], ['Modell L−M', COLORS[0], (i, f) => mz[i]?.dm ? 0.5e6 * mz[i].dm[1] / omega(f) : NaN]];
  }
  const traces = [...list.map(item => [...item, null]), ...extra.map(item => [...item, [2, 3]])].map(([label, color, fn, dash]) => ({
    key: 'cmc:' + label, label, color, dash, values: Float64Array.from(dataset.freq, (f, i) => fn(i, f)),
    visible: !state.hiddenTraces.has('cmc:' + label)
  }));
  const coreM = em?.edited ? RF.coreSections(em.model).reduce((sum, [m]) => sum + m, 0) : NaN;
  const shown = em?.edited ? { l: coreM + em.model.ls, m: coreM, k: coreM / (coreM + em.model.ls), ctH: em.model.ct, ctD: em.model.ct, cw: em.model.cw, cg: em.model.cg, cx: em.model.cx } : fit;
  return {
    traces, unit, yLabel: (isZ ? 'Impedanz' : isCap ? 'Kapazität' : 'Induktivität') + ' [' + unit + ']', signed: !isZ, positive: isZ,
    focus: isCap ? focusAround([fit.cw * 1e12, fit.cg * 1e12], 0.5, 1.5) : null,
    title: isZ ? 'CMC · Impedanz und Ersatzschaltbild' : isCap ? 'Parasitärkapazitäten' : 'Wirksame Induktivitäten',
    caption: isZ ? 'Z CM und Z DM nach CISPR 17 · Modell aus dem Editor gepunktet' : isCap ? 'Projektion der Vierport-Y-Matrix auf die natürlichen CMC-Moden' : 'Aus dem Imaginärteil von Z CM und Z DM · je Wicklung',
    native: '', fitBand: em ? em.band : band,
    details: () => fitDetails(fit, band, resonance) + cmcSchematic(pairs, shown, em?.edited ? { rw: em.model.rw, rfe: em.model.rfe, rls: em.model.rls, sections: RF.coreSections(em.model) } : cmcLoss(pairs), !!em?.edited) +
      (em ? modelEditor(em) : '<section class="detail-card" id="model-missing"><div class="fit-summary"><h3>Modell-Editor</h3><small>Für das Modell fehlen positive Werte für L und M. Prüfe Portpolarität und Fit-Band.</small></div></section>') +
      '<p class="note">Cw und Cg sind Modellwerte für eine möglichst symmetrische CMC. Übrige aktive Ports sind mit Z₀ abgeschlossen. ' +
      help + '</p>'
  };
}

registerActions({
  'schematic-zoom': value => { $(value)?.querySelector('.schematic-box')?.classList.toggle('is-zoomed'); },
});

export { cmcLoss, transformerSchematic, focusAround, cmcView };
