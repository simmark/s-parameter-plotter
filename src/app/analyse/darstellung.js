// analyse/darstellung – Analysebereich zeichnen: Diagramm, Kurvenliste und Details.
import { pairWarning } from './erkennung.js';
import { currentModes, deviceType, sameSet, typeTraces } from './kurven.js';
import { renderMarker, setMarker, switchMarker } from './marker.js';
import { compareView } from './vergleich.js';
import { $, actionButton, coarse, esc, insertHtml, mobile, pressed } from '../basis/dom.js';
import { view } from '../basis/erweiterung.js';
import { traceValue, valueWith } from '../basis/format.js';
import { tx } from '../basis/sprache.js';
import { axis, effectiveY, state, yScales } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';

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
  const factory = view(state.tab).plot;
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
    ...state.view, f: state.dataset.freq, xScale: a.x, xRange: a.xRange, xUnit:a.xUnit, axisFont:a.font, yScale: effectiveY(), yRange: (effectiveY() === a.y ? a.yRange : null) ?? (effectiveY() === 'linear' && state.view.focus?.every(Number.isFinite) && state.view.focus[0] < state.view.focus[1] ? state.view.focus : null),
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

export { renderAnalysis, updatePlot, renderDetails, renderTraces };
