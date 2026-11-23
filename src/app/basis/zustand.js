// basis/zustand – Zentraler Zustand der Oberfläche (state), Lastarten und Achseneinstellungen.
import { mobile } from './dom.js';
import { COLORS } from './farben.js';

const MAX_TRACES = COLORS.length;
const LOADS = [
  ['active', 'Aktiv'], ['match', 'Load Z₀'], ['open', 'Open'], ['short', 'Short'],
  ['resistor', 'R-Last'], ['complex', 'R + jX'], ['series', 'RLC-Serie'], ['parallel', 'RLC-Parallel']
];
const EDITABLE_LOADS = ['resistor', 'complex', 'series', 'parallel'];
// Defaults: impedances on a log axis; signed equivalent values (L, C) on the symmetric log axis so that sign changes and peaks show.
const defaultAxes = tab => ({ x: 'log', xRange: null, y: ['z', 'cispr'].includes(tab) ? 'log' : tab === 'cmc' ? 'symlog' : 'linear', yRange: null });
const Y_SCALES = ['log', 'symlog', 'linear'];
const state = {
  dataset: null, config: null, layout: null, network: null, tab: 's', basis: 'mm',
  sFormat: 'db', sKeys: { se: null, mm: null }, smith: '',
  z: { method: 'reflection', format: 'mag', input: '', output: '' },
  cispr: { method: 'four', format: 'mag', input: '', output: '' },
  cmc: { format: 'ind', band: null }, pairIn: 1, pairOut: 2,
  esb: { model: 'auto', fixture: 'auto', tFormat: 'ocl', eFormat: 'z', input: '', output: '', evalFreq: 100e3 },
  axes: {}, markers: [0, null, null, null], activeMarker: 0,
  compare: { ids: [], delta: false }, profile: { name: '', source: 'default', score: null, matches: [], key: '' }, connector: null, time: null,
  viewMode: 0, hiddenTraces: new Set(), collapsed: mobile.matches, job: 0, importJob: 0,
  busy: false, error: '', memo: new Map(), view: null, dialogLoad: null, pairDraft: null, toastTimer: null
};
const axis = () => state.axes[state.tab] ??= defaultAxes(state.tab);
// Log Y only for quantities that are positive by nature (|Z|, Q); signed quantities get the symmetric log axis instead,
// so a log axis never drops negative values silently. dB and phase stay linear.
function yScales() {
  const view = state.view;
  if (!view || view.smith) return ['linear'];
  if (view.signed) return ['symlog', 'linear'];
  return view.positive || view.format === 'mag' ? ['log', 'linear'] : ['linear'];
}
function effectiveY() {
  const allowed = yScales(), y = axis().y;
  if (allowed.includes(y)) return y;
  return y === 'log' && allowed.includes('symlog') ? 'symlog' : 'linear';
}

export { MAX_TRACES, LOADS, EDITABLE_LOADS, defaultAxes, Y_SCALES, state, axis, yScales, effectiveY };
