// analyse/kurven – Welche Kurven gezeigt werden: Moden, Vorgaben, gemerkte Auswahl.
import { renderAnalysis, renderTraces, updatePlot } from './darstellung.js';
import { detectModel } from './erkennung.js';
import { renderMatrix } from './kurvenwahl.js';
import { renderMarker } from './marker.js';
import { $, toast } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { MODAL_SYMBOL, MODAL_TYPES } from '../basis/farben.js';
import { display } from '../basis/format.js';
import { MAX_TRACES, state } from '../basis/zustand.js';
import { Prefs } from '../dateien/kurvenvorlieben.js';

function currentModes() {
  if (!state.layout) return [];
  return state.basis === 'mm' ? state.layout.mmModes : state.layout.seModes;
}

function getView(basis = state.basis) {
  const n = state.network;
  return basis === 'mm' ? { modes: n.layout.mmModes, samples: n.mm } : { modes: n.layout.seModes, samples: n.se };
}

function modeLabel(mode) {
  return mode.key + ' · ' + display(mode.ref) + ' Ω';
}

function modeOptions() {
  return currentModes().map(mode => [mode.key, modeLabel(mode)]);
}

function chooseDefaults() {
  const modes = currentModes();
  const keys = modes.map(m => m.key);
  const valid = k => keys.includes(k);
  const pick = (k, alt) => valid(k) ? k : alt;
  const first = keys[0] || '', second = keys[1] || first;
  state.smith = pick(state.smith, first);
  for (const type of ['z', 'cispr', 'esb']) {
    const settings = state[type];
    settings.input = pick(settings.input, first);
    settings.output = pick(settings.output, second);
    const needsDistinct = type === 'z' ? settings.method.startsWith('tx') : type === 'esb' || ['series', 'shunt'].includes(settings.method);
    if (needsDistinct && settings.input === settings.output && keys.length > 1) {
      settings.output = keys.find(key => key !== settings.input);
    }
  }
  if (state.curveApply) {
    state.curveApply = false;
    const pref = Prefs.get(deviceType());
    if (pref) {
      for (const basis of ['mm', 'se']) if (pref[basis]) state.sKeys[basis] = pref[basis].slice();
      if (pref.hidden) { state.hiddenTraces.clear(); pref.hidden.forEach(key => state.hiddenTraces.add(key)); }
    }
  }
  const existing = state.sKeys[state.basis];
  if (!existing) state.sKeys[state.basis] = typeTraces(modes, false);
  else {
    const retained = existing.filter(key => key.split(':').every(valid));
    state.sKeys[state.basis] = existing.length && !retained.length ? typeTraces(modes, false) : retained;
  }
  const pairs = state.config.pairs.map(p => p.id);
  if (!pairs.includes(state.pairIn)) state.pairIn = pairs[0] ?? 1;
  if (!pairs.includes(state.pairOut) || state.pairOut === state.pairIn) {
    state.pairOut = pairs.find(id => id !== state.pairIn) ?? 2;
  }
}

const traceKey = (row, col) => row.key + ':' + col.key;

function traceLabel(row, col, parameter = 'S') {
  if (row.type === 'P' && col.type === 'P') return parameter + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
  if (row.type === 'P' || col.type === 'P') return parameter + '(' + row.key + '←' + col.key + ')';
  if (parameter !== 'S') return parameter + '(' + row.key + '←' + col.key + ')';
  // 0/α/β modes of three-conductor groups: S0α·21 = response in the 0 mode of group 2 to the α mode of group 1
  if (MODAL_TYPES.has(row.type) || MODAL_TYPES.has(col.type)) return 'S' + MODAL_SYMBOL[row.type] + MODAL_SYMBOL[col.type] + '·' + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
  return 'S' + (row.type + col.type).toLowerCase() + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
}

// Device type for curve defaults: a name the user gave wins, otherwise the structure and physics decide.
function deviceType() {
  const name = (state.profile?.name || '').toLowerCase();
  if (/\blan\b|lan-|übertrager|uebertrager|transformer|trafo|magnetics|ethernet|phy/.test(name)) return 'lan';
  if (/cmc|cmb|common|gleichtakt|drossel|choke|rfi/.test(name)) return 'cmc';
  if (state.config.pairs.length >= 2) {
    try { if (state.network) return detectModel().type === 'transformer' ? 'lan' : 'cmc'; } catch { /* fall through */ }
    return state.dataset.n >= 6 ? 'lan' : 'cmc';
  }
  return state.config.pairs.length ? 'pair' : 'se';
}

// Standard curves: CMC Sdd21 + Scc21 (extended + Sdc21); LAN transformer Sdd21, Scc21, Sdd11, Sdc21 (extended + Scc11, Sdd22).
function typeTraces(modes, extended) {
  const diff = modes.filter(m => m.type === 'D'), common = modes.filter(m => m.type === 'C');
  const type = deviceType();
  if (diff.length >= 2 && common.length >= 2 && (type === 'cmc' || type === 'lan')) {
    const [d1, d2] = diff, [c1, c2] = common;
    const keys = type === 'cmc'
      ? [traceKey(d2, d1), traceKey(c2, c1)].concat(extended ? [traceKey(d2, c1)] : [])
      : [traceKey(d2, d1), traceKey(c2, c1), traceKey(d1, d1), traceKey(d2, c1)].concat(extended ? [traceKey(c1, c1), traceKey(d2, d2), traceKey(c2, d1)] : []);
    return keys;
  }
  return defaultTraces(modes);
}

const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));

function rememberCurves() {
  if (!state.dataset || state.dataset.demo) return;
  const type = deviceType();
  Prefs.set(type, { ...(Prefs.get(type) || {}), [state.basis]: state.sKeys[state.basis].slice(), hidden: [...state.hiddenTraces].slice(0, 80) });
}

function defaultTraces(modes) {
  if (!modes.length) return [];
  const modal = type => modes.filter(m => m.type === type);
  if (modal('Z').length && !modes.some(m => m.type === 'D')) {
    const [z, a, b] = ['Z', 'A', 'B'].map(modal);
    return z.length >= 2 ? [traceKey(z[1], z[0]), traceKey(a[1], a[0]), traceKey(b[1], b[0]), traceKey(a[1], z[0])] : [traceKey(z[0], z[0]), traceKey(a[0], a[0]), traceKey(b[0], b[0])];
  }
  const diff = modes.filter(m => m.type === 'D'), common = modes.filter(m => m.type === 'C');
  if (diff.length > 1) return [
    traceKey(diff[1], diff[0]), traceKey(common[1], common[0]), traceKey(diff[0], diff[0]), traceKey(common[0], common[0])
  ];
  if (diff.length === 1) return [traceKey(diff[0], diff[0]), traceKey(common[0], common[0])];
  if (modes.length === 1) return [traceKey(modes[0], modes[0])];
  return [traceKey(modes[1], modes[0]), traceKey(modes[0], modes[0]), traceKey(modes[1], modes[1])];
}

function curvePreset(preset) {
  const modes = currentModes().filter(mode => preset !== 'modal-all' || mode.type !== 'P');
  let next = [];
  if (preset === 'default' || preset === 'basic') next = typeTraces(modes, false);
  if (preset === 'ext') next = typeTraces(modes, true);
  if (preset === 'reflect') next = modes.map(mode => traceKey(mode, mode));
  if (preset === 'all' || preset === 'modal-all') next = modes.flatMap(row => modes.map(col => traceKey(row, col)));
  if (preset === 'through' || preset === 'convert') {
    for (const [i, row] of modes.entries()) {
      for (const [j, col] of modes.entries()) {
        const through = preset === 'through' && i > j && row.type === col.type;
        const conversion = preset === 'convert' && row.type !== col.type && row.type !== 'P' && col.type !== 'P';
        if (through || conversion) next.push(traceKey(row, col));
      }
    }
  }
  if (next.length > MAX_TRACES) toast('Die ersten ' + MAX_TRACES + ' passenden Matrixelemente wurden gewählt.');
  state.sKeys[state.basis] = next.slice(0, MAX_TRACES);
  state.sKeys[state.basis].forEach(key => state.hiddenTraces.delete('s:' + state.basis + ':' + key));
  rememberCurves();
  if ($('matrix-dialog').open) renderMatrix();
  renderAnalysis();
}

function toggleTrace(key) {
  const trace = state.view?.traces.find(t => t.key === key);
  if (!trace) return;
  trace.visible = !trace.visible;
  if (trace.visible) state.hiddenTraces.delete(key);
  else state.hiddenTraces.add(key);
  rememberCurves();
  updatePlot();
  renderTraces();
  renderMarker(false);
  document.querySelectorAll('.trace-row').forEach(button => {
    if (button.dataset.value === key) button.focus({ preventScroll: true });
  });
}

registerActions({
  'curve-preset': curvePreset,
  'toggle-trace': toggleTrace,
});

export { currentModes, getView, modeLabel, modeOptions, chooseDefaults, traceKey, traceLabel, deviceType, typeTraces,
  sameSet, rememberCurves };
