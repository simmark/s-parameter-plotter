// analyse/vergleich – Vergleich mit anderen Dateien der Sitzung.
import { computeNetwork } from './netzwerk.js';
import { toast } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { state } from '../basis/zustand.js';
import { settingsFromEmbedded } from '../dateien/einstellungen.js';
import { FILE_COLORS, FILE_DASH, MAX_COMPARE, compareCache, loadDataset, session, sessionItem } from '../dateien/sitzung.js';
import { compareLetter, renderSession } from '../dateien/sitzungsliste.js';
import { renderMain } from '../oberflaeche/rahmen.js';

let compareJob = 0;
async function syncCompare(force = false) {
  const job = ++compareJob;
  state.compare.ids = state.compare.ids.filter(id => sessionItem(id));
  const ids = state.compare.ids.filter(id => id !== session.current);
  for (const id of [...compareCache.keys()]) if (!ids.includes(id)) compareCache.delete(id);
  let changed = force;
  if (state.network) {
    for (const id of ids) {
      const item = sessionItem(id);
      try {
        const dataset = await loadDataset(item);
        if (job !== compareJob) return;
        const own = item.settings?.config ?? settingsFromEmbedded(dataset)?.config;
        const config = own ?? (dataset.n === state.dataset.n ? state.config : null);
        if (!config) throw new Error('Portzahl weicht ab und die Datei hat kein eigenes Profil.');
        const key = JSON.stringify(config);
        if (compareCache.get(id)?.key === key) continue;
        const layout = RF.prepareNetwork(dataset, config);
        const network = await computeNetwork(dataset, config, layout, () => job === compareJob, 'compare');
        if (!network) return;
        compareCache.set(id, { key, ctx: { dataset, config, layout, network, memo: new Map() } });
      } catch (error) {
        if (job !== compareJob) return;
        compareCache.set(id, { key: '', ctx: null });
        toast(item.name + ' · ' + error.message);
      }
      changed = true;
    }
  }
  if (job !== compareJob || !changed) return;
  renderSession();
  if (state.dataset && state.layout) renderMain();
}

function toggleCompare(id) {
  if (id === session.current) {
    toast('Die geöffnete Datei ist die Referenz ⟨A⟩. Wähle weitere Dateien zum Vergleich.');
    return;
  }
  const ids = state.compare.ids;
  if (ids.includes(id)) state.compare.ids = ids.filter(other => other !== id);
  else if (ids.filter(other => other !== session.current).length >= MAX_COMPARE) {
    toast('Es lassen sich höchstens ' + MAX_COMPARE + ' Dateien vergleichen.');
    return;
  } else ids.push(id);
  renderSession();
  syncCompare(true);
}

function inContext(ctx, factory) {
  const keep = { dataset: state.dataset, config: state.config, layout: state.layout, network: state.network, memo: state.memo };
  Object.assign(state, ctx);
  try { return factory(); } catch { return null; } finally { Object.assign(state, keep); }
}

const unitFactor = unit => ({ m: 1e-3, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 })[unit?.length === 2 && 'FHS'.includes(unit[1]) ? unit[0] : ''] ?? 1;

function resampler(source, target) {
  const lo = new Int32Array(target.length).fill(-1), w = new Float64Array(target.length);
  let j = 0;
  for (let i = 0; i < target.length; i++) {
    const f = target[i];
    if (f < source[0] * (1 - 1e-9) || f > source.at(-1) * (1 + 1e-9)) continue;
    while (j < source.length - 2 && source[j + 1] < f) j++;
    const a = source[j], b = source[Math.min(j + 1, source.length - 1)];
    lo[i] = j;
    w[i] = b > a ? Math.max(0, Math.min(1, (f - a) / (b - a))) : 0;
  }
  return (data, stride = 1, factor = 1) => {
    const out = new Float64Array(target.length * stride).fill(NaN);
    const last = data.length / stride - 1;
    for (let i = 0; i < target.length; i++) {
      if (lo[i] < 0) continue;
      const hi = Math.min(lo[i] + 1, last);
      for (let s = 0; s < stride; s++) {
        const a = data[lo[i] * stride + s], b = data[hi * stride + s];
        out[i * stride + s] = (w[i] === 0 ? a : w[i] === 1 ? b : a + (b - a) * w[i]) * factor;
      }
    }
    return out;
  };
}

function compareView(view, factory) {
  const ids = state.compare.ids.filter(id => id !== session.current && compareCache.get(id)?.ctx);
  if (!ids.length || !view.traces?.length) return view;
  const fs = state.dataset.freq, single = view.traces.length === 1, extra = [];
  ids.forEach(id => {
    const ctx = compareCache.get(id).ctx, other = inContext(ctx, factory);
    if (!other?.traces) return;
    const letter = compareLetter(id), k = 'BCDEFGH'.indexOf(letter);
    const resample = resampler(ctx.dataset.freq, fs), factor = unitFactor(other.unit) / unitFactor(view.unit);
    for (const base of view.traces) {
      const match = other.traces.find(trace => trace.key === base.key);
      if (!match) continue;
      const key = 'cmp:' + id + ':' + base.key;
      extra.push({
        key, label: base.label + ' ⟨' + letter + '⟩', color: single ? FILE_COLORS[k % FILE_COLORS.length] : base.color,
        dash: single ? base.dash : FILE_DASH[k % FILE_DASH.length], family: base.family, base,
        complex: match.complex ? resample(match.complex, 2) : null, values: resample(match.values, 1, factor),
        visible: !state.hiddenTraces.has(key)
      });
    }
  });
  if (!extra.length) return view;
  if (state.compare.delta) {
    return {
      ...view, format: 'delta', floor: null, zeroBaseline: false, positive: false, refLines: null, smith: false, focus: null,
      yLabel: 'Δ ' + view.yLabel, caption: view.caption + ' · Differenz zu ⟨A⟩',
      traces: extra.map(trace => ({ ...trace, label: 'Δ ' + trace.label, complex: null, values: trace.values.map((value, i) => value - trace.base.values[i]) }))
    };
  }
  return { ...view, traces: [...view.traces.map(trace => ({ ...trace, label: trace.label + ' ⟨A⟩', dash: single ? trace.dash : null })), ...extra] };
}

registerActions({
  'session-compare': toggleCompare,
  'compare-delta': () => { state.compare.delta = !state.compare.delta; renderMain(); },
  'compare-clear': () => { state.compare.ids = []; state.compare.delta = false; renderSession(); syncCompare(true); },
});

export { syncCompare, compareView };
