// analyse/netzwerk – Datensatz vorbereiten und das Netzwerk (Lasten, Paare, Bezug) neu berechnen.
import { syncCompare } from './vergleich.js';
import { nextTick, notice, toast } from '../basis/dom.js';
import { resetFileStates } from '../basis/erweiterung.js';
import { compute, networkInWorker } from '../basis/rechnen.js';
import { state } from '../basis/zustand.js';
import { applySettings } from '../dateien/einstellungen.js';
import { render } from '../oberflaeche/rahmen.js';

// ---- Comparison: the same curves of other files, resampled onto the frequency grid of the open file. ----
async function computeNetwork(dataset, config, layout, alive, lane = 'main', channels = null, paths = null) {
  const viaWorker = await networkInWorker(dataset, config, lane, channels, paths);
  if (viaWorker === null || !alive()) return null;
  if (viaWorker) {
    const unpack = p => Array.from(p.mask, (ok, i) => ok ? p.data.subarray(i * p.len, (i + 1) * p.len) : null);
    const se = unpack(viaWorker.se), mm = viaWorker.mm ? unpack(viaWorker.mm) : se;
    return { layout, se, mm, gaps: viaWorker.gaps, xt: viaWorker.xt, xtChannels: channels, xtPaths: paths, worker: true };
  }
  compute.stats.page++;
  let start = performance.now();
  const se = [], mm = [];
  let gaps = 0;
  for (let i = 0; i < dataset.freq.length; i++) {
    if ((i & 31) === 0 && performance.now() - start > 19) {
      await nextTick();
      if (!alive()) return null;
      start = performance.now();
    }
    const [single, mixed] = RF.processPoint(dataset, config, layout, i);
    se.push(single); mm.push(mixed);
    if (!single || !mixed) gaps++;
  }
  return { layout, se, mm, gaps };
}

async function refreshNetwork() {
  const id = ++state.job;
  const { dataset, config } = state;
  state.network = null;
  state.memo = new Map();
  state.error = '';
  if (config.triples?.length) {
    const taken = new Set(config.pairs.flatMap(p => [p.p, p.q])), keep = [];
    for (const t of config.triples) {
      const ports = [t.a, t.b, t.c];
      if (ports.some(p => taken.has(p) || config.loads[p]?.type !== 'active')) toast('Dreileitergruppe T' + t.id + ' aufgelöst: einer ihrer Ports ist jetzt anders belegt.');
      else { keep.push(t); ports.forEach(p => taken.add(p)); }
    }
    config.triples = keep.map((t, i) => ({ ...t, id: i + 1 }));
    if (!config.triples.length) delete config.triples;
  }
  try {
    state.layout = RF.prepareNetwork(dataset, config);
    if (!state.layout.active.length) throw new Error('Mindestens ein physischer Port muss aktiv bleiben.');
    if (!state.layout.hasMixed) state.basis = 'se';
    state.busy = true;
    render();
    await nextTick();
    const channels = state.connector?.channels?.length ? state.connector.channels : null;
    const network = await computeNetwork(dataset, config, state.layout, () => id === state.job, 'main', channels, state.connector?.paths);
    if (!network || id !== state.job) return;
    state.network = network;
  } catch (error) {
    if (id !== state.job) return;
    state.error = error.message;
  }
  if (id !== state.job) return;
  state.busy = false;
  render();
  syncCompare();
}

function initDataset(dataset, saved = null) {
  const pairs = dataset.profile?.pairs ?? dataset.sourcePairs;
  const config = {
    loads: RF.indices(dataset.n).map(() => ({ type: 'active' })),
    pairs: pairs.map((pair, i) => ({ ...pair, id: i + 1 })),
    ref: null
  };
  for (const tap of dataset.profile?.taps ?? []) config.loads[tap] = { type: 'open' };
  if (dataset.demo && dataset.n === 8) {
    config.loads[5] = { type: 'match' };
    config.loads[7] = { type: 'open' };
  }
  state.dataset = dataset;
  state.config = config;
  resetFileStates();
  state.pairDraft = null;
  state.basis = config.pairs.length ? 'mm' : 'se';
  state.sKeys = { se: null, mm: null };
  state.smith = '';
  state.z = { method: 'reflection', format: 'mag', input: '', output: '' };
  state.cispr = { method: 'four', format: 'mag', input: '', output: '' };
  const fs = dataset.freq;
  const start = fs[0] > 0 ? fs[0] : fs[1] ?? 0;
  const end = fs.at(-1);
  state.zFamily = 'z';
  state.cmc = { format: 'ind', band: dataset.demo ? [1e6, 100e6] : [start, end] };
  state.esb = { model: 'auto', fixture: 'auto', tFormat: 'ocl', eFormat: 'z', input: '', output: '', evalFreq: 100e3 };
  state.pairIn = config.pairs[0]?.id ?? 1;
  state.pairOut = config.pairs[1]?.id ?? 2;
  state.hiddenTraces.clear();
  state.axes = {};
  const target = dataset.demo ? 10e6 : Math.sqrt(start) * Math.sqrt(end);
  state.markers = [Plot.nearest(fs, target, true), null, null, null];
  state.activeMarker = 0;
  state.tab = 's';
  state.curveApply = true;
  if (saved) {
    try { applySettings(dataset, saved); } catch { /* ignore outdated settings */ }
  }
  notice('import-notice', dataset.warnings.join(' '));
  refreshNetwork();
}

export { computeNetwork, refreshNetwork, initDataset };
