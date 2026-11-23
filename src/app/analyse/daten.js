// analyse/daten – Kurvendaten aus dem Netzwerk ziehen, Einheiten und Achsenbeschriftung.
import { complexAt, omega } from '../basis/format.js';
import { state } from '../basis/zustand.js';

function cache(key, make) {
  if (state.memo.has(key)) return state.memo.get(key);
  const result = make();
  if (state.memo.size >= 35) state.memo.delete(state.memo.keys().next().value);
  state.memo.set(key, result);
  return result;
}

function createComplex(compute) {
  const f = state.dataset.freq;
  const values = new Float64Array(f.length * 2).fill(NaN);
  for (let i = 0; i < f.length; i++) {
    const value = compute(i, f[i]);
    if (!value) continue;
    values[2 * i] = value[0];
    values[2 * i + 1] = value[1];
  }
  return values;
}

function extractS(view, row, col, basis = state.basis) {
  return cache('s:' + basis + ':' + row + ':' + col, () =>
    createComplex(i => view.samples[i] && RF.get(view.samples[i], view.modes.length, row, col)));
}

function unwrap(raw) {
  const phase = new Float64Array(raw.length / 2).fill(NaN);
  let last = NaN, offset = 0;
  for (let i = 0; i < phase.length; i++) {
    const c = complexAt(raw, i);
    if (!c.every(Number.isFinite) || RF.abs(c) === 0) {
      last = NaN; offset = 0; continue;
    }
    const value = Math.atan2(c[1], c[0]);
    if (Number.isFinite(last)) {
      const d = value - last;
      if (d > Math.PI) offset -= RF.TAU;
      if (d < -Math.PI) offset += RF.TAU;
    }
    phase[i] = value + offset;
    last = value;
  }
  return phase;
}

function delay(raw) {
  const phase = unwrap(raw), f = state.dataset.freq;
  return Float64Array.from(phase, (p, i) => {
    if (!Number.isFinite(p) || RF.abs(complexAt(raw, i)) < 1e-14) return NaN;
    const h1 = f[i] - f[i - 1], h2 = f[i + 1] - f[i];
    const dp = (p - phase[i - 1]) / h1, dn = (phase[i + 1] - p) / h2;
    const pValid = Number.isFinite(dp) && RF.abs(complexAt(raw, i - 1)) >= 1e-14;
    const nValid = Number.isFinite(dn) && RF.abs(complexAt(raw, i + 1)) >= 1e-14;
    const slope = pValid && nValid ? (h2 * dp + h1 * dn) / (h1 + h2) : pValid ? dp : nValid ? dn : NaN;
    return -slope * 1e9 / RF.TAU;
  });
}

function scalarize(raw, format) {
  if (format === 'unwrap') return Float64Array.from(unwrap(raw), p => p / RF.RAD);
  if (format === 'delay') return delay(raw);
  const fs = state.dataset.freq;
  return Float64Array.from(fs, (f, i) => {
    const z = complexAt(raw, i);
    if (!z.every(Number.isFinite)) return NaN;
    const [re, x] = z;
    if (format === 'db') return 20 * Math.log10(RF.abs(z));
    if (format === 'mag') return RF.abs(z);
    if (format === 're') return re;
    if (format === 'im') return x;
    if (format === 'phase') return RF.abs(z) ? Math.atan2(x, re) / RF.RAD : NaN;
    if (format === 'q') return re > 0 ? Math.abs(x) / re : NaN;
    if (f <= 0) return NaN;
    // Equivalent values keep their sign: above a resonance an "inductance" turns negative (the part is capacitive there).
    // Hiding that would cut resonances out of the curve.
    if (format === 'ls') return x / omega(f);
    if (format === 'cs') return x ? -1 / (omega(f) * x) : NaN;
    const b = RF.div([1, 0], z)?.[1];
    if (!Number.isFinite(b)) return NaN;
    if (format === 'lp') return b ? -1 / (omega(f) * b) : NaN;
    return b / omega(f);
  });
}

function baseUnit(format, native = '') {
  return {
    db: 'dB', mag: native, re: native, im: native, phase: '°', unwrap: '°', delay: 'ns',
    ls: 'H', lp: 'H', cs: 'F', cp: 'F', q: ''
  }[format];
}

function axisLabel(format, unit, quantity = '') {
  const title = quantity || ({
    db: 'Betrag', mag: 'Betrag', re: 'Realteil', im: 'Imaginärteil', phase: 'Phase',
    unwrap: 'Phase', delay: 'Gruppenlaufzeit', ls: 'L Serie', cs: 'C Serie', lp: 'L Parallel', cp: 'C Parallel', q: 'Güte Q'
  }[format]);
  return title + (unit ? ' [' + unit + ']' : '');
}

function engineeringScale(traces, base) {
  if (!['F', 'H', 'S'].includes(base)) return [1, base];
  const sample = [];
  for (const trace of traces) {
    const skip = Math.max(1, Math.ceil(trace.values.length / 180));
    for (let i = 0; i < trace.values.length; i += skip) {
      const v = Math.abs(trace.values[i]);
      if (Number.isFinite(v) && v > 0) sample.push(v);
    }
  }
  sample.sort((a, b) => a - b);
  const fallback = base === 'F' ? 1e-12 : base === 'H' ? 1e-6 : 1e-3;
  const magnitude = sample[Math.floor(sample.length / 2)] || fallback;
  const scale = [[1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']]
    .find(([value]) => magnitude >= value * (1 - 1e-10)) || [1e-15, 'f'];
  return [scale[0], scale[1] + base];
}

function rawTrace(key, label, color, complex, format) {
  const values = scalarize(complex, format);
  return { key, label, color, complex, values, visible: !state.hiddenTraces.has(key) };
}

function withUnits(traces, format, native = '', label = '') {
  const [factor, unit] = engineeringScale(traces, baseUnit(format, native));
  if (factor !== 1) {
    traces.forEach(trace => { trace.values = Float64Array.from(trace.values, v => v / factor); });
  }
  return { traces, unit, yLabel: axisLabel(format, unit, label), zeroBaseline: format === 'mag', signed: ['ls', 'cs', 'lp', 'cp'].includes(format), positive: format === 'q' };
}

function selectedPairs() {
  const pairs = state.config.pairs;
  const a = pairs.find(p => p.id === state.pairIn), b = pairs.find(p => p.id === state.pairOut);
  return a && b && a !== b ? [a, b] : null;
}

export { cache, createComplex, extractS, engineeringScale, rawTrace, withUnits, selectedPairs };
