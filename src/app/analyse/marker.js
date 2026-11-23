// analyse/marker – Marker setzen, verschieben und Spitzen suchen.
import { renderDetails, renderTraces, updatePlot } from './darstellung.js';
import { $, actionButton, esc, pressed, toast } from '../basis/dom.js';
import { registerActions, slot } from '../basis/erweiterung.js';
import { complexAt, complexText, freqInput, hz, parseHz, traceValue, valueWith } from '../basis/format.js';
import { axis, state } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';

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
      slot('marker-tools') +
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
  }).join('') + (view.phases || []).map(trace => '<tr><td><span class="trace-dot is-dashed" style="--trace:' +
    trace.color + '"></span>' + esc(trace.label) + '</td>' +
    used.map(i => '<td>' + esc(valueWith(trace.values[state.markers[i]], '°')) + '</td>').join('') +
    (showDelta ? '<td>—</td>' : '') + '</tr>').join('');
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

registerActions({
  'active-marker': value => switchMarker(Number(value)),
  'add-marker': addMarker,
  'remove-marker': removeMarker,
  peak: peakSearch,
});

export { renderMarker, setMarker, enterMarker, switchMarker };
