// module/zeitbereich – Tab „Zeitbereich“: Sprungantwort, TDR und Augendiagramm.
import { currentModes, traceLabel } from '../analyse/kurven.js';
import { miniChart } from '../analyse/minidiagramm.js';
import { $, esc, insertHtml, toast } from '../basis/dom.js';
import { registerFileState, registerForms, registerView } from '../basis/erweiterung.js';
import { hz } from '../basis/format.js';
import { computeCall, computeWorker } from '../basis/rechnen.js';
import { lang, tx } from '../basis/sprache.js';
import { state } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';

// ---------- Time domain (phase 5) and eye diagram (phase 6) ----------
const tdBlank = () => ({ row: '', col: '', mode: 'step', window: 'hann', rise: 0, tmax: 0, rate: 1e9, amp: 0.5, order: 7, eye: null, eyeKey: '' });
const tdModes = () => currentModes();
function tdSource() {
  const t = state.time, modes = tdModes(), net = state.network;
  if (!net || !modes.length) return null;
  const keys = state.sKeys[state.basis] || [];
  if (!modes.some(m => m.key === t.row) || !modes.some(m => m.key === t.col)) {
    const pick = keys.map(k => k.split(':')).find(([r, c]) => r !== c && modes.some(m => m.key === r) && modes.some(m => m.key === c)) || keys.map(k => k.split(':'))[0] || [modes[Math.min(1, modes.length - 1)].key, modes[0].key];
    [t.row, t.col] = pick;
  }
  const n = modes.length, i = modes.findIndex(m => m.key === t.row), j = modes.findIndex(m => m.key === t.col);
  const mats = state.basis === 'mm' ? net.mm : net.se;
  const values = mats.map(s => s ? [s[2 * (i * n + j)], s[2 * (i * n + j) + 1]] : null);
  return { values, row: modes[i], col: modes[j], ref: modes[i].ref ?? 50, label: traceLabel(modes[i], modes[j]) };
}
// Result of the current settings, cached by a key of everything it depends on.
function tdCompute() {
  const t = state.time, src = tdSource();
  if (!src) return null;
  const key = [state.dataset.name, state.basis, t.row, t.col, t.window, t.rise, state.layout.mmModes.length, state.network.mm.length].join('|');
  if (t.cache?.key === key) return t.cache;
  const freq = state.dataset.freq, sampling = TD.sampling(freq);
  const grid = TD.resample(freq, src.values, { points: 4096 });
  const resp = TD.responses(grid, { window: t.window, rise: t.rise });
  const gd = TD.groupDelay(freq, src.values);
  t.cache = { key, src, sampling, grid, resp, gd, edge: TD.edge(resp.step, resp.dt, resp.t0) };
  t.eye = null;
  return t.cache;
}
const tdTime = v => Math.abs(v) >= 1e-6 ? (v * 1e6).toFixed(2) + ' µs' : Math.abs(v) >= 1e-9 ? (v * 1e9).toFixed(3) + ' ns' : (v * 1e12).toFixed(1) + ' ps';
function tdQuality(c) {
  const { sampling: q, grid, gd } = c, notes = [];
  if (q.kind === 'log') notes.push('Logarithmische Abtastung: Zwischen den Punkten wird linear interpoliert. Feine Strukturen im Zeitbereich (Reflexionen, Resonanzen) können fehlen. Für TDR und Augen eine dichte, lineare Messung verwenden.');
  if (q.kind === 'other') notes.push('Ungleichmäßige Abtastung: Zwischen den Punkten wird linear interpoliert.');
  if (q.points < 201) notes.push('Nur ' + q.points + ' Frequenzpunkte: Das Ergebnis ist eine grobe Näherung.');
  if (gd.guided) notes.push('Phasenschritte über 90° zwischen Punkten: Die Phase wurde über die Laufzeit-Kontinuität entfaltet (Annahme einer glatten Laufzeit).');
  if (grid.dcResidual > 0.3) notes.push('Die zu f → 0 extrapolierte Phase liegt weit von 0° und 180°: Der Gleichanteil ist unsicher.');
  return notes;
}
function renderTime() {
  const box = $('time-panel');
  if (!box || state.tab !== 'time') return;
  state.time ??= tdBlank();
  const t = state.time, modes = tdModes();
  if (!state.network) { box.innerHTML = '<p class="inline-notice">Das Netzwerk wird berechnet …</p>'; return; }
  let c, failure = '';
  try { c = tdCompute(); } catch (error) { failure = error.message; }
  if (!c && !failure) { box.innerHTML = ''; return; }
  if (!c) c = { src: tdSource(), failed: true };
  const refl = t.row === t.col;
  if (t.mode === 'tdr' && !refl) t.mode = 'step';
  const opt = (list, value) => list.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  const modeOpts = modes.map(m => [m.key, m.key]);
  const q = c.sampling || TD.sampling(state.dataset.freq), notes = c.failed ? [] : tdQuality(c);
  let html = '<section class="config-card"><div class="config-head"><h2>Zeitbereich</h2><p>Aus den Frequenzdaten: Interpolation auf ein gleichmäßiges Raster, Gleichanteil aus dem tiefsten Punkt extrapoliert, Fenster, inverse FFT. Die Quelle ist ein idealer Sprung, auf Wunsch mit Gauß-Flanke. Kurven der aktuellen Portbasis (' + (state.basis === 'mm' ? 'Mixed Mode' : 'Single Ended') + ').</p></div><div class="config-content"><form id="td-form"><div class="preset-row">' +
    '<label class="control"><span>Antwort (Zeile)</span><select name="row" data-no-i18n>' + opt(modeOpts, t.row) + '</select></label>' +
    '<label class="control"><span>Anregung (Spalte)</span><select name="col" data-no-i18n>' + opt(modeOpts, t.col) + '</select></label>' +
    '<label class="control"><span>Darstellung</span><select name="mode">' + opt([['step', 'Sprungantwort'], ['impulse', 'Impulsantwort'], ...(refl ? [['tdr', 'TDR · Impedanz']] : [])], t.mode) + '</select></label>' +
    '<label class="control"><span>Fenster</span><select name="window">' + opt([['hann', 'Hann'], ['kaiser', 'Kaiser (β = 6)'], ['rect', 'Rechteck (ohne)']], t.window) + '</select></label>' +
    '<label class="control narrow"><span>Flanke 10–90 % [ps]</span><input class="field-input mono" name="rise" inputmode="decimal" value="' + (t.rise ? +(t.rise * 1e12).toPrecision(6) : '') + '" placeholder="keine"></label>' +
    '<label class="control narrow"><span>Zeit bis [ns]</span><input class="field-input mono" name="tmax" inputmode="decimal" value="' + (t.tmax ? +(t.tmax * 1e9).toPrecision(6) : '') + '" placeholder="auto"></label>' +
    '<button class="button primary" type="submit">Anwenden</button></div></form>' +
    (c.failed ? '<p class="inline-notice">' + esc(failure) + '</p></div></section>' : '<dl class="cn-facts"><dt>Kurve</dt><dd data-no-i18n>' + esc(c.src.label) + '</dd><dt>Abtastung</dt><dd data-no-i18n>' + esc(tx({ linear: 'linear', log: 'logarithmisch', other: 'ungleichmäßig' }[q.kind], { linear: 'linear', log: 'logarithmic', other: 'non-uniform' }[q.kind]) + ' · ' + q.points + tx(' Punkte · ', ' points · ') + hz(q.fmin) + ' … ' + hz(q.fmax)) + '</dd>' +
    '<dt>Zeitschritt</dt><dd data-no-i18n>' + esc(tdTime(c.resp.dt) + tx(' (Auflösung ≈ 1/(2·fmax) = ', ' (resolution ≈ 1/(2·fmax) = ') + tdTime(1 / (2 * q.fmax)) + ')') + '</dd><dt>Zeitfenster</dt><dd data-no-i18n>' + esc(tdTime(c.resp.span) + tx(' (periodisch, 1/Δf)', ' (periodic, 1/Δf)')) + '</dd>' +
    (refl ? '' : '<dt>Laufzeit (50 %)</dt><dd data-no-i18n>' + esc((Number.isFinite(c.edge.t50) ? tdTime(c.edge.t50) : '–') + tx(' · Anstieg 10–90 % ', ' · rise 10–90 % ') + (Number.isFinite(c.edge.rise) ? tdTime(c.edge.rise) : '–') + tx(' · Endwert ', ' · final value ') + c.edge.final.toFixed(4)) + '</dd>') + '</dl>' +
    (notes.length ? '<ul class="cn-issues">' + notes.map(x => '<li class="is-warn">' + esc(x) + '</li>').join('') + '</ul>' : '') + '</div></section>');
  if (c.failed) { insertHtml(box, html); return; }
  // chart
  const r = c.resp, half = r.step.length >> 1;
  let end = t.tmax || 0;
  if (!end) { let peak = 0; for (let k = 0; k < half; k++) peak = Math.max(peak, Math.abs(r.h[k])); let last = 0; for (let k = 0; k < half; k++) if (Math.abs(r.h[k]) > 2e-3 * peak) last = k; end = Math.max(r.t0 + (last + 1) * r.dt * 1.3, 20 * r.dt); }
  const xs = [], ys = [], scaleT = end > 2e-6 ? 1e6 : end > 2e-9 ? 1e9 : 1e12, unitT = { 1e6: 'µs', 1e9: 'ns', 1e12: 'ps' }[scaleT];
  const stride = Math.max(1, Math.ceil((end + 0.15 * end) / r.dt / 1500));
  const z = t.mode === 'tdr' ? TD.impedance(r.step, c.src.ref) : null;
  const begin = Math.max(r.t0, -0.15 * end), k0 = Math.max(0, Math.floor((begin - r.t0) / r.dt));
  for (let k = k0; k < half && r.t0 + k * r.dt <= end; k += stride) {
    xs.push((r.t0 + k * r.dt) * scaleT);
    ys.push(t.mode === 'tdr' ? (Number.isFinite(z[k]) ? Math.min(z[k], 1e4) : NaN) : t.mode === 'impulse' ? r.h[k] / r.dt / scaleT : r.step[k]);
  }
  const yLabel = t.mode === 'tdr' ? 'Ω' : t.mode === 'impulse' ? '1/' + unitT : 'V/V';
  const name = { step: lang() === 'en' ? 'Step response ' : 'Sprungantwort ', impulse: lang() === 'en' ? 'Impulse response ' : 'Impulsantwort ', tdr: 'TDR ' }[t.mode] + c.src.label;
  html += '<section class="config-card"><div class="config-head"><h2>Verlauf</h2><p>' + (t.mode === 'tdr' ? 'Impedanz Z = Z₀·(1+ρ)/(1−ρ) aus der Sprungantwort der Reflexion; Z₀ = Bezugsimpedanz der Mode. Ohne Flanke oder Fenster schwingt die Kurve an Sprüngen über (Gibbs).' : 'Sprung der Höhe 1 am Eingang ab t = 0; vor t = 0 liegt ein Achtel des Zeitfensters, damit ein bandbegrenzter Sprung nicht umklappt.') + '</p></div><div class="config-content">' +
    miniChart([{ name, color: '#c4622d', x: xs, y: ys }], { xFmt: v => +v.toPrecision(4) + ' ' + unitT, yFmt: v => +v.toPrecision(4) + '', yLabel, xLabel: (lang() === 'en' ? 'Time' : 'Zeit') + ' [' + unitT + ']', label: name }) + '</div></section>';
  // eye
  if (!refl) {
    const e = t.eye;
    html += '<section class="config-card"><div class="config-head"><h2>Augendiagramm</h2><p>NRZ mit ±Amplitude, periodisches PRBS-Muster, Signal als Überlagerung der Pulsantwort dieser Kurve (lineares, zeitinvariantes Netzwerk). Ohne Jitter, Rauschen, Entzerrung und ohne Maske: keine Normbewertung.</p></div><div class="config-content"><form id="eye-form"><div class="preset-row">' +
      '<label class="control narrow"><span>Bitrate [Gbit/s]</span><input class="field-input mono" name="rate" inputmode="decimal" value="' + +(t.rate / 1e9).toPrecision(6) + '"></label>' +
      '<label class="control narrow"><span>Amplitude ± [V]</span><input class="field-input mono" name="amp" inputmode="decimal" value="' + +t.amp.toPrecision(6) + '"></label>' +
      '<label class="control narrow"><span>Muster</span><select name="order">' + opt([[7, 'PRBS7'], [9, 'PRBS9'], [11, 'PRBS11']], t.order) + '</select></label>' +
      '<button class="button primary" type="submit">Auge berechnen</button></div></form>' +
      (q.fmax < 0.75 * t.rate ? '<p class="inline-notice">Die Messung endet bei ' + esc(hz(q.fmax)) + ', unter 1,5 × der Nyquist-Frequenz (' + esc(hz(t.rate / 2)) + '). Flanken und Auge hängen dann stark von Fenster und Flanke ab.</p>' : '') +
      (e ? '<img class="eye-img" src="' + e.img + '" alt="' + esc((lang() === 'en' ? 'Eye diagram ' : 'Augendiagramm ') + c.src.label) + '" width="760" height="340">' +
        '<dl class="cn-facts"><dt>Augenhöhe</dt><dd data-no-i18n>' + esc(e.height.toFixed(4) + tx(' V (innen, bester Abtastzeitpunkt, PRBS', ' V (inner, best sampling instant, PRBS') + e.order + ')') + '</dd><dt>Augenbreite</dt><dd data-no-i18n>' + esc(e.width.toFixed(2) + ' UI = ' + tdTime(e.width * e.ui)) + '</dd>' +
        '<dt>Schlechtester Fall</dt><dd data-no-i18n>' + esc(e.pda.toFixed(4) + tx(' V (Peak-Distortion: Hauptcursor ', ' V (peak distortion: main cursor ') + e.main.toFixed(4) + tx(' V, Summe |ISI| ', ' V, sum |ISI| ') + e.isi.toFixed(4) + ' V)') + '</dd><dt>Abtastzeitpunkt</dt><dd data-no-i18n>' + esc(tdTime(e.phase * e.ui / e.s) + tx(' gegenüber der Pulsmitte', ' relative to the pulse centre')) + '</dd></dl>' : '') + '</div></section>';
  }
  insertHtml(box, html);
}
// Eye picture: all 2-UI traces drawn with low alpha on a canvas (density), the decision phase as a line.
async function tdEye() {
  const t = state.time, c = tdCompute();
  if (!c) return;
  const ui = 1 / t.rate, opts = { ui, amp: t.amp, order: t.order, s: 32 };
  const viaWorker = computeWorker() ? await computeCall({ type: 'eye', step: c.resp.step, dt: c.resp.dt, opts }).catch(error => { if (error.fallback) return null; throw error; }) : null;
  const e = viaWorker || TD.eye(c.resp.step, c.resp.dt, opts);
  const W = 760, H = 340, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), lim = t.amp * 1.4, sx = x => 30 + x / (2 * e.s) * (W - 40), sy = v => H / 2 - v / lim * (H / 2 - 16);
  g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e8e5dc'; g.lineWidth = 1;
  for (const v of [-t.amp, 0, t.amp]) { g.beginPath(); g.moveTo(30, sy(v)); g.lineTo(W - 10, sy(v)); g.stroke(); }
  for (const x of [0, e.s, 2 * e.s]) { g.beginPath(); g.moveTo(sx(x), 10); g.lineTo(sx(x), H - 10); g.stroke(); }
  g.strokeStyle = 'rgba(196,98,45,0.18)'; g.lineWidth = 1.2;
  const start = e.cursor - e.s;             // centre the eye: decision point of a bit in the middle of the 2-UI window
  for (let k = 0; k < e.L; k++) {
    g.beginPath();
    for (let x = 0; x <= 2 * e.s; x++) { const v = e.wave[(((k * e.s + start + x) % e.total) + e.total) % e.total]; x ? g.lineTo(sx(x), sy(v)) : g.moveTo(sx(x), sy(v)); }
    g.stroke();
  }
  g.strokeStyle = '#2b2a27'; g.setLineDash([4, 4]); const xd = sx(e.s + e.best.phase); g.beginPath(); g.moveTo(xd, 10); g.lineTo(xd, H - 10); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#6b6a64'; g.font = '11px monospace'; g.fillText('+' + t.amp + ' V', 2, sy(t.amp) - 3); g.fillText('−' + t.amp + ' V', 2, sy(-t.amp) + 12); g.fillText('0', 2, sy(0) - 3); g.fillText('2 UI', W - 40, H - 4);
  t.eye = { img: cv.toDataURL('image/png'), height: e.best.height, width: e.width, pda: e.pda, main: e.main, isi: e.isi, phase: e.best.phase, s: e.s, ui, order: t.order };
}
function tdApply(form) {
  const t = state.time, d = new FormData(form), num = v => { const x = Number(String(v || '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };
  t.row = String(d.get('row') || t.row); t.col = String(d.get('col') || t.col); t.mode = String(d.get('mode') || 'step'); t.window = String(d.get('window') || 'hann');
  const rise = num(d.get('rise')), tmax = num(d.get('tmax'));
  t.rise = rise > 0 ? rise * 1e-12 : 0; t.tmax = tmax > 0 ? tmax * 1e-9 : 0; t.cache = null; t.eye = null;
  persistSettings(); renderTime();
}
function tdEyeApply(form) {
  const t = state.time, d = new FormData(form), num = v => Number(String(v || '').replace(',', '.'));
  const rate = num(d.get('rate')) * 1e9, amp = num(d.get('amp')), order = Number(d.get('order'));
  if (!(rate > 0) || !(amp > 0)) { toast('Bitrate und Amplitude müssen positiv sein.'); return; }
  t.rate = rate; t.amp = amp; t.order = [7, 9, 11].includes(order) ? order : 7;
  form.querySelector('button[type=submit]')?.setAttribute('aria-busy', 'true');
  tdEye().catch(error => toast(error.message)).finally(() => { persistSettings(); if (state.tab === 'time') renderTime(); });
}

registerForms({
  'td-form': tdApply,
  'eye-form': tdEyeApply,
});

registerView({ id: 'time', title: 'Zeitbereich', panel: 'time-panel', render: renderTime, context: 'Sprung- und Impulsantwort, TDR-Impedanz, Augendiagramm · aus den Frequenzdaten' });

// Settings of the time tab travel with the file; the computed eye stays out.
registerFileState('time', {
  blank: tdBlank,
  save: t => ({ row: t.row, col: t.col, mode: t.mode, window: t.window, rise: t.rise, tmax: t.tmax, rate: t.rate, amp: t.amp, order: t.order }),
  load: t => {
    if (typeof t !== 'object') return undefined;
    const num = (v, lo, hi, d) => Number.isFinite(v) && v >= lo && v <= hi ? v : d;
    return { ...tdBlank(), row: typeof t.row === 'string' ? t.row : '', col: typeof t.col === 'string' ? t.col : '', mode: ['step', 'impulse', 'tdr'].includes(t.mode) ? t.mode : 'step',
      window: ['rect', 'hann', 'kaiser'].includes(t.window) ? t.window : 'hann', rise: num(t.rise, 0, 1e-6, 0), tmax: num(t.tmax, 0, 1, 0), rate: num(t.rate, 1e3, 1e12, 1e9), amp: num(t.amp, 1e-3, 100, 0.5), order: [7, 9, 11].includes(t.order) ? t.order : 7 };
  },
});
