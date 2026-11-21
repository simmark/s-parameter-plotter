'use strict';

const Plot = (() => {
  const canvas = document.getElementById('plot');
  const bound = new Map();
  // In the dark theme neutral canvas colours are mapped, curve colours stay as they are.
  const ctx = new Proxy(canvas.getContext('2d'), {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      if (!bound.has(key)) bound.set(key, value.bind(target));
      return bound.get(key);
    },
    set(target, key, value) {
      target[key] = (key === 'fillStyle' || key === 'strokeStyle') && typeof value === 'string' ? Theme.map(value) : value;
      return true;
    }
  });
  const uiFont = 'Inter, "Noto Sans", system-ui, sans-serif';
  const monoFont = '"IBM Plex Mono", "DejaVu Sans Mono", monospace';
  const ink = '#2b2a27', axisInk = '#6b6a64', grid = '#e8e5dc', minorGrid = '#f3f1eb';
  const markerColors = ['#2b2a27', '#c4622d', '#6a4fb3', '#1e7f78'];
  const LOC = window.I18N?.locale || 'de-DE', COMMA = LOC.startsWith('de');
  const tr = text => window.I18N ? window.I18N.t(text) : text;
  const formatter = new Intl.NumberFormat(LOC, { maximumSignificantDigits: 4, useGrouping: false });
  let model, geometry, hovering = null, dragging = null, markerDrag = null, frame = 0, rendered = null;

  const formatNumber = value => {
    if (Object.is(value, -0)) return '0';
    if (Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.001)) {
      return value.toExponential(2).replace('.', COMMA ? ',' : '.').replace(/e\+?/, 'e');
    }
    return formatter.format(value);
  };

  const preciseFormatter = new Intl.NumberFormat(LOC, { maximumSignificantDigits: 7, useGrouping: false });

  function formatFreq(f, precise = false) {
    if (!Number.isFinite(f)) return '—';
    const fmt = precise ? v => preciseFormatter.format(v) : formatNumber;
    for (const [value, unit] of [[1e12, 'THz'], [1e9, 'GHz'], [1e6, 'MHz'], [1e3, 'kHz']]) {
      if (Math.abs(f) >= value) return fmt(f / value) + ' ' + unit;
    }
    return fmt(f) + ' Hz';
  }

  // Accepts "10 MHz", "10MHz", "10M", "1,5 G", "2.4e9", "100 k". A lone "m" means mega here.
  function parseFreq(text) {
    const match = String(text).trim().match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*([kmgt])?\s*(hz)?$/i);
    if (!match) return NaN;
    const factors = { k: 1e3, m: 1e6, g: 1e9, t: 1e12 };
    return Number(match[1].replace(',', '.')) * (factors[match[2]?.toLowerCase()] || 1);
  }

  function lowerBound(array, value) {
    let l = 0, r = array.length;
    while (l < r) {
      const mid = (l + r) >>> 1;
      if (array[mid] < value) l = mid + 1;
      else r = mid;
    }
    return l;
  }

  function nearest(array, f, log = false) {
    let i = lowerBound(array, f);
    if (i === 0) return 0;
    if (i === array.length) return i - 1;
    const prev = array[i - 1], next = array[i];
    if (log && prev === 0 && f > 0) return i;
    const pivot = log && prev > 0 ? Math.sqrt(prev) * Math.sqrt(next) : (prev + next) / 2;
    if (f < pivot) i--;
    return i;
  }

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    if (!(raw > 0)) return 1;
    const base = 10 ** Math.floor(Math.log10(raw));
    const ratio = raw / base;
    const unit = [1, 2, 2.5, 5, 10].find(v => v >= ratio) || 10;
    return base * unit;
  }

  function linearTicks(lo, hi, target) {
    const step = niceStep(hi - lo, target);
    const min = Math.ceil(lo / step - 1e-9);
    const max = Math.floor(hi / step + 1e-9);
    return Array.from({ length: Math.max(0, Math.min(35, max - min + 1)) }, (_, i) => ({
      value: (min + i) * step, major: true
    }));
  }

  function logTicks(lo, hi, width, vertical) {
    const start = Math.floor(Math.log10(lo)), end = Math.floor(Math.log10(hi) + 1e-10);
    const count = end - start + 1;
    if (hi / lo < 2.25) return linearTicks(lo, hi, vertical ? 5 : Math.max(3, width / 98));
    const out = [];
    const labelStep = Math.max(1, Math.ceil(count / Math.max(2, width / (vertical ? 36 : 47))));
    for (let p = start; p <= end && p < start + 315; p++) {
      const base = 10 ** p;
      for (let j = 1; j <= 9; j++) {
        if (j !== 1 && count > 10) continue;
        const value = base * j;
        if (value < lo * (1 - 1e-10) || value > hi * (1 + 1e-10)) continue;
        out.push({
          value,
          major: (j === 1 && (p - start) % labelStep === 0) || (count < 4 && (j === 2 || j === 5))
        });
      }
    }
    return out;
  }

  function domain() {
    if (!model) return null;
    const fs = model.f;
    const first = model.xScale === 'log' ? (fs[0] > 0 ? 0 : 1) : 0;
    let lo = fs[first] ?? fs[0], hi = fs.at(-1);
    if (lo === hi) {
      if (model.xScale === 'log' && lo > 0) { lo /= 1.25; hi *= 1.25; }
      else if (lo > 0) { lo *= 0.8; hi *= 1.2; }
      else hi = 1;
    }
    return { lo, hi };
  }

  const toPlotValue = (trace, index) => {
    const value = trace.values[index];
    return model.floor === null || model.floor === undefined ? value : Math.max(model.floor, value);
  };

  // Symmetric log axis: linear around zero up to the threshold c, logarithmic beyond it, on both sides of zero.
  // Signed equivalent values (L, C around a resonance) stay visible with their sign and their peaks.
  const symMap = c => v => Math.sign(v) * Math.log10(1 + Math.abs(v) / c);
  const symUnmap = c => t => Math.sign(t) * c * (10 ** Math.abs(t) - 1);
  function symThreshold(from, to) {
    if (model.symThreshold > 0) return model.symThreshold;
    const mags = [];
    for (const trace of model.traces) {
      if (!trace.visible) continue;
      for (let i = from; i < to; i++) {
        const value = Math.abs(toPlotValue(trace, i));
        if (Number.isFinite(value) && value > 0) mags.push(value);
      }
    }
    if (!mags.length) return 1;
    mags.sort((a, b) => a - b);
    return 10 ** Math.floor(Math.log10(mags[Math.floor(mags.length * 0.1)]));
  }
  function symTicks(lo, hi, c, height) {
    const out = [{ value: 0, major: true }], map = symMap(c), span = map(hi) - map(lo);
    const room = Math.max(2, Math.floor(height / 26)), decades = Math.max(1, Math.ceil(span)), step = Math.max(1, Math.ceil(decades / room));
    for (const sign of [1, -1]) {
      const limit = sign > 0 ? hi : -lo;
      for (let k = 0; k < 320 && c * 10 ** k <= limit * (1 + 1e-9); k++) out.push({ value: sign * c * 10 ** k, major: k % step === 0 });
    }
    return out.filter(tick => tick.value >= lo && tick.value <= hi).sort((a, b) => a.value - b.value);
  }

  function autoYRange(from, to, h) {
    const visible = model.traces.filter(t => t.visible);
    let lo = Infinity, hi = -Infinity;
    for (const trace of visible) {
      for (let i = from; i < to; i++) {
        const value = toPlotValue(trace, i);
        if (!Number.isFinite(value) || (model.yScale === 'log' && value <= 0)) continue;
        lo = Math.min(lo, value); hi = Math.max(hi, value);
      }
    }
    const valid = Number.isFinite(lo) && Number.isFinite(hi);
    if (model.yRange) return [...model.yRange, valid];
    if (!valid) return model.yScale === 'log' ? [0.1, 10, false] : [-1, 1, false];
    if (model.yScale === 'symlog') {
      const c = symThreshold(from, to), up = v => c * 10 ** Math.ceil(Math.log10(Math.max(v, c) / c) - 1e-9);
      const a = lo < 0 ? -up(-lo) : 0, b = hi > 0 ? up(hi) : 0;
      return [a, a === b ? a + c : b, true];
    }
    if (model.signed && model.yScale === 'linear') {
      // Resonance peaks of signed equivalent values would flatten everything else: the linear view shows the bulk
      // (2nd to 98th percentile, always including zero); the symmetric log axis shows the peaks in full.
      const all = [];
      for (const trace of visible) for (let i = from; i < to; i++) { const value = toPlotValue(trace, i); if (Number.isFinite(value)) all.push(value); }
      all.sort((a, b) => a - b);
      const q = f => all[Math.min(all.length - 1, Math.max(0, Math.round(f * (all.length - 1))))];
      const a = Math.min(0, q(0.02)), b = Math.max(0, q(0.98)), bulk = b - a;
      if (bulk > 0 && hi - lo > 6 * bulk) { lo = a - 0.25 * bulk; hi = b + 0.25 * bulk; }
    }
    if (model.yScale === 'log') {
      if (lo === hi) return [lo / 2, hi * 2, true];
      if (hi / lo < 3) return [lo * 0.96, hi * 1.04, true];
      return [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(hi)), true];
    }
    const nonpositiveDb = model.format === 'db' && hi <= 0;
    if (lo === hi) {
      const pad = Math.max(Math.abs(lo) * 0.08, lo ? 1e-12 : 1);
      lo -= pad; hi += pad;
    }
    const pad = (hi - lo) * 0.035;
    const step = niceStep(hi - lo + 2 * pad, Math.max(4, h / 48));
    const loRound = Math.floor((lo - pad) / step) * step;
    const hiRound = Math.ceil((hi + pad) / step) * step;
    return [model.zeroBaseline && lo >= 0 ? Math.max(0, loRound) : loRound,
      nonpositiveDb ? Math.min(0, hiRound) : hiRound, true];
  }

  function line(x1, y1, x2, y2, color, width = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }

  function dot(x, y, color, radius = 3.5) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function markerTag(x, y, name, color, active = false) {
    ctx.font = '700 10px ' + monoFont;
    const w = ctx.measureText(name).width + 12, h = 16;
    const left = Math.min(geometry.right - w, Math.max(geometry.left, x - w / 2));
    if (active) { ctx.fillStyle = color; roundRect(left - 2, y - 2, w + 4, h + 4, 5); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = color; roundRect(left, y, w, h, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, left + w / 2, y + h / 2 + 0.5);
    return { x0: left - 4, x1: left + w + 4, y0: y - 4, y1: y + h + 4 };
  }

  function tracePath(trace, start, end, x, y) {
    ctx.beginPath();
    let pen = false, seen = 0, lastPoint;
    function push(i) {
      const v = toPlotValue(trace, i);
      const xx = x(model.f[i]), yy = y(v);
      if (!Number.isFinite(xx) || !Number.isFinite(yy)) { pen = false; return; }
      if (pen) ctx.lineTo(xx, yy);
      else ctx.moveTo(xx, yy);
      pen = true; seen++; lastPoint = [xx, yy];
    }
    const points = end - start;
    if (points <= 5 * (geometry.right - geometry.left)) {
      for (let i = start; i < end; i++) push(i);
    } else {
      // Preserve extrema per pixel column and break the trace at missing samples.
      let col = -Infinity, first = -1, last = -1, min = -1, max = -1;
      function flush() {
        if (first < 0) return;
        [...new Set([first, min, max, last])].sort((a, b) => a - b).forEach(push);
        first = -1;
      }
      for (let i = start; i < end; i++) {
        const v = toPlotValue(trace, i);
        const xx = x(model.f[i]), yy = y(v);
        if (!Number.isFinite(xx) || !Number.isFinite(yy)) { flush(); pen = false; continue; }
        const next = Math.floor(xx);
        if (next !== col || first < 0) {
          flush();
          col = next; first = min = max = i;
        } else {
          if (v < toPlotValue(trace, min)) min = i;
          if (v > toPlotValue(trace, max)) max = i;
        }
        last = i;
      }
      flush();
    }
    ctx.setLineDash(trace.dash || []);
    ctx.strokeStyle = trace.color; ctx.lineWidth = trace.dash ? 1.8 : 1.7; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.setLineDash([]);
    if (seen === 1) dot(...lastPoint, trace.color);
  }

  function drawXY(w, h) {
    const small = w < 470;
    const right = w - (small ? 14 : 24);
    const top = 27, bottom = h - 46;
    const full = domain();
    const [xlo, xhi] = model.xRange || [full.lo, full.hi];
    const xLog = model.xScale === 'log';
    const rangeStart = lowerBound(model.f, xlo);
    const endBound = lowerBound(model.f, xhi);
    const rangeEnd = endBound < model.f.length && model.f[endBound] === xhi ? endBound + 1 : endBound;
    const [ylo, yhi, hasValues] = autoYRange(rangeStart, rangeEnd, bottom - top);
    const yLog = model.yScale === 'log', ySym = model.yScale === 'symlog';
    const symC = ySym ? symThreshold(rangeStart, rangeEnd) : 1;
    const yticks = ySym ? symTicks(ylo, yhi, symC, bottom - top) : yLog ? logTicks(ylo, yhi, bottom - top, true) : linearTicks(ylo, yhi, Math.max(4, (bottom - top) / 44));
    // The left margin grows with the widest tick label so the axis title never overlaps the numbers.
    ctx.font = (small ? '9.5px ' : '10.5px ') + monoFont;
    const labelWidth = yticks.reduce((max, tick) => tick.major ? Math.max(max, ctx.measureText(formatNumber(tick.value)).width) : max, 0);
    const left = Math.round(Math.max(small ? 53 : 75, labelWidth + (small ? 30 : 38)));
    const logOrigin = Math.log(xlo);
    const xMap = xLog ? f => {
      const offset = (f - xlo) / xlo;
      return Math.abs(offset) < 0.5 ? Math.log1p(offset) : Math.log(f) - logOrigin;
    } : f => f;
    const unMap = xLog ? t => Math.abs(t) < 0.5
      ? xlo + xlo * Math.expm1(t)
      : Math.exp(logOrigin + t) : t => t;
    const xBase = xMap(xlo), xSpan = xMap(xhi) - xBase;
    const x = f => left + (xMap(f) - xBase) / xSpan * (right - left);
    const fAt = px => unMap(xBase + (px - left) / (right - left) * xSpan);
    const yMap = ySym ? symMap(symC) : yLog ? Math.log10 : v => v;
    const yUnmap = ySym ? symUnmap(symC) : yLog ? t => 10 ** t : t => t;
    const yBase = yMap(ylo), ySpan = yMap(yhi) - yBase;
    const y = value => bottom - (yMap(value) - yBase) / ySpan * (bottom - top);
    geometry = { left, right, top, bottom, x, y, fAt, xlo, xhi, xBase, xSpan, unMap, yBase, ySpan, yUnmap };
    ctx.fillStyle = '#fffefb'; ctx.fillRect(left, top, right - left, bottom - top);
    if (model.fitBand) {
      const fitLeft = Math.max(left, x(model.fitBand[0]));
      const fitRight = Math.min(right, x(model.fitBand[1]));
      if (fitRight > fitLeft) {
        ctx.fillStyle = '#f6ece3';
        ctx.fillRect(fitLeft, top, fitRight - fitLeft, bottom - top);
      }
    }
    const xticks = xLog ? logTicks(xlo, xhi, right - left, false) : linearTicks(xlo, xhi, (right - left) / (small ? 69 : 92));
    ctx.font = (small ? '9.5px ' : '10.5px ') + monoFont;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.fillStyle = axisInk;
    for (const tick of yticks) {
      const yy = y(tick.value);
      line(left, yy, right, yy, tick.major ? grid : minorGrid);
      if (tick.major) ctx.fillText(formatNumber(tick.value), left - 8, yy);
    }
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    let lastLabelRight = 0, lastLabel = '';
    for (const tick of xticks) {
      const xx = x(tick.value);
      line(xx, top, xx, bottom, tick.major ? grid : minorGrid);
      if (!tick.major) continue;
      const label = formatFreq(tick.value);
      const half = ctx.measureText(label).width / 2;
      const textX = Math.max(half + 3, Math.min(w - half - 3, xx));
      if (label === lastLabel || textX - half < lastLabelRight + 5) continue;
      ctx.fillText(label, textX, bottom + 7);
      lastLabelRight = textX + half;
      lastLabel = label;
    }
    ctx.strokeStyle = '#d6d2c6'; ctx.lineWidth = 1; ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.font = '600 11px ' + uiFont;
    ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(tr('Frequenz'), (left + right) / 2, h - 11);
    ctx.save();
    ctx.translate(small ? 10 : 17, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(tr(model.yLabel), 0, 0);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    const start = Math.max(xLog && model.f[0] === 0 ? 1 : 0, rangeStart - 1);
    const end = Math.min(model.f.length, rangeEnd + 1);
    for (const trace of model.traces) {
      if (trace.visible) tracePath(trace, start, end, x, y);
    }
    // Extracted ESB values as dashed reference lines.
    for (const ref of model.refLines || []) {
      const yy = y(ref.value);
      if (!Number.isFinite(yy) || yy < top || yy > bottom) continue;
      ctx.setLineDash([6, 4]); line(left, yy, right, yy, ref.color, 1.2); ctx.setLineDash([]);
      ctx.font = '700 10px ' + monoFont;
      const refLabel = tr(ref.label);
      const tw = ctx.measureText(refLabel).width + 10;
      ctx.fillStyle = ref.color; roundRect(right - tw - 6, yy - 17, tw, 15, 3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(refLabel, right - tw - 1, yy - 9.2);
    }
    if (!hasValues) {
      ctx.font = '600 12px ' + uiFont;
      ctx.fillStyle = axisInk; ctx.textAlign = 'center';
      ctx.fillText(tr(yLog ? 'Keine positiven Werte im Bereich' : 'Keine Kurvendaten im Bereich'), (left + right) / 2, (top + bottom) / 2);
    } else if (yLog && model.traces.some(trace => trace.visible && trace.values.slice(rangeStart, rangeEnd).some(value => value <= 0))) {
      // A logarithmic axis cannot show zero or negative values: say so instead of dropping them silently.
      ctx.font = '600 10.5px ' + uiFont;
      ctx.fillStyle = axisInk; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(tr('Werte ≤ 0 sind auf der Log-Achse nicht darstellbar'), left + 8, top + 6);
    }
    if (dragging && Math.abs(dragging.current - dragging.start) > 8) {
      const x1 = Math.min(dragging.current, dragging.start), x2 = Math.max(dragging.current, dragging.start);
      ctx.fillStyle = '#c9644222'; ctx.fillRect(x1, top, x2 - x1, bottom - top);
      ctx.strokeStyle = '#c96442'; ctx.strokeRect(x1, top, x2 - x1, bottom - top);
    }
    const markerList = model.markers.map((index, i) => ({ index, i })).filter(m => m.index !== null && m.index !== undefined);
    const visibleTraces = model.traces.filter(t => t.visible);
    for (const { index, i } of markerList) {
      const xx = x(model.f[index]);
      if (xx < left - 0.1 || xx > right + 0.1 || !Number.isFinite(xx)) continue;
      ctx.setLineDash(i === model.activeMarker ? [] : [4, 3]);
      line(xx, top, xx, bottom, markerColors[i], i === model.activeMarker ? 1.3 : 1);
      ctx.setLineDash([]);
      for (const trace of visibleTraces) {
        const yy = y(toPlotValue(trace, index));
        if (Number.isFinite(yy)) dot(xx, yy, trace.color, i === model.activeMarker ? 4 : 3.4);
      }
    }
    // Values next to the marker points, only while the plot stays readable (≤ 4 visible curves).
    if (visibleTraces.length && visibleTraces.length <= 4) {
      ctx.font = '600 10px ' + monoFont; ctx.textBaseline = 'middle';
      // All markers get labels while that stays sparse, otherwise only the active one.
      const labelled = visibleTraces.length * markerList.length <= 6 ? markerList : markerList.filter(m => m.i === model.activeMarker);
      for (const { index, i } of labelled) {
        const xx = x(model.f[index]);
        if (xx < left || xx > right || !Number.isFinite(xx)) continue;
        const labels = visibleTraces.map(trace => {
          const v = trace.values[index];
          return { trace, v, yy: y(toPlotValue(trace, index)) };
        }).filter(l => Number.isFinite(l.yy) && Number.isFinite(l.v)).sort((a, b) => a.yy - b.yy);
        for (let k = 1; k < labels.length; k++) labels[k].yy = Math.max(labels[k].yy, labels[k - 1].yy + 14);
        const overflow = labels.length ? labels.at(-1).yy - (bottom - 8) : 0;
        if (overflow > 0) labels.forEach(l => { l.yy -= overflow; });
        for (const l of labels) {
          const text = formatNumber(l.v).replace(/^-/, '−') + (model.unit ? ' ' + model.unit : '');
          const tw = ctx.measureText(text).width + 8;
          const onLeft = xx + 8 + tw > right;
          const bx = onLeft ? xx - 8 - tw : xx + 8;
          const by = Math.max(top + 2, Math.min(bottom - 15, l.yy - 7.5));
          ctx.fillStyle = 'rgba(255,255,255,.9)'; roundRect(bx, by, tw, 15, 3); ctx.fill();
          ctx.strokeStyle = l.trace.color; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = l.trace.color; ctx.textAlign = 'left';
          ctx.fillText(text, bx + 4, by + 7.8);
        }
      }
    }
    ctx.restore();

    geometry.tags = [];
    const placed = [];
    for (const { index, i } of markerList) {
      const xx = x(model.f[index]);
      if (xx < left - 0.1 || xx > right + 0.1) continue;
      // Tags of nearby markers step down so every tag stays clickable.
      let row = 0;
      while (placed.some(p => p.row === row && Math.abs(p.x - xx) < 26)) row++;
      placed.push({ x: xx, row });
      const rect = markerTag(xx, top - 18 + row * 17, 'M' + (i + 1), markerColors[i], i === model.activeMarker);
      geometry.tags.push({ i, ...rect });
    }

    if (hovering && !dragging && !markerDrag) {
      const index = nearest(model.f, fAt(hovering.x), xLog);
      const hx = x(model.f[index]);
      let snap = null;
      for (const trace of visibleTraces) {
        const yy = y(toPlotValue(trace, index));
        if (!Number.isFinite(yy)) continue;
        const distance = Math.abs(yy - hovering.y);
        if (distance < 32 && (!snap || distance < snap.distance)) snap = { trace, yy, distance };
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      ctx.setLineDash([3, 4]);
      line(hx, top, hx, bottom, '#9a978f');
      ctx.setLineDash([]);
      ctx.restore();
      if (snap) {
        // Magnetic snap: ring on the curve and a compact readout next to it.
        ctx.beginPath(); ctx.arc(hx, snap.yy, 6, 0, 2 * Math.PI);
        ctx.strokeStyle = snap.trace.color; ctx.lineWidth = 2; ctx.stroke();
        dot(hx, snap.yy, snap.trace.color, 3);
        const v = snap.trace.values[index];
        const valueText = (Number.isFinite(v) ? formatNumber(v).replace(/^-/, '−') : '—') + (model.unit ? ' ' + model.unit : '');
        const freqText = formatFreq(model.f[index]);
        ctx.font = '700 11px ' + monoFont;
        const snapLabel = tr(snap.trace.label);
        const w1 = ctx.measureText(snapLabel + '  ' + valueText).width;
        ctx.font = '500 10px ' + monoFont;
        const w2 = ctx.measureText(freqText).width;
        const bw = Math.max(w1, w2) + 22, bh = 34;
        let bx = hx + 12, by = snap.yy - bh - 8;
        if (bx + bw > right) bx = hx - 12 - bw;
        if (by < top) by = snap.yy + 10;
        ctx.fillStyle = 'rgba(31,30,29,.94)'; roundRect(bx, by, bw, bh, 6); ctx.fill();
        ctx.fillStyle = snap.trace.color; ctx.fillRect(bx + 8, by + 9, 3, 16);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.font = '700 11px ' + monoFont; ctx.fillStyle = '#fff';
        ctx.fillText(snapLabel + '  ' + valueText, bx + 16, by + 12);
        ctx.font = '500 10px ' + monoFont; ctx.fillStyle = '#d6d3ca';
        ctx.fillText(freqText, bx + 16, by + 25);
        geometry.snap = { index, trace: snap.trace.key };
      } else {
        geometry.snap = null;
        const label = formatFreq(model.f[index]);
        ctx.font = '500 10px ' + monoFont;
        const ww = ctx.measureText(label).width + 12;
        const xx = Math.min(right - ww, Math.max(left, hx - ww / 2));
        ctx.fillStyle = '#1f1e1d'; roundRect(xx, bottom - 21, ww, 17, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(label, xx + ww / 2, bottom - 12.5);
      }
    }
    rendered = { xlo, xhi, ylo, yhi };
  }

  function smithGrid(cx, cy, radius) {
    const rs = [0, 0.2, 0.5, 1, 2, 5];
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, RF.TAU);
    ctx.fillStyle = '#fffefb'; ctx.fill();
    ctx.save();
    ctx.clip();
    for (const r of rs) {
      ctx.beginPath(); ctx.arc(cx + radius * r / (1 + r), cy, radius / (1 + r), 0, RF.TAU);
      ctx.strokeStyle = r === 0 ? '#b5b1a5' : '#e3dfd4'; ctx.lineWidth = r === 0 ? 1.5 : 1; ctx.stroke();
    }
    for (const reactance of [0.2, 0.5, 1, 2, 5]) {
      for (const sign of [-1, 1]) {
        const x = reactance * sign;
        ctx.beginPath();
        for (let i = 0; i <= 115; i++) {
          const r = (i / (116 - i)) * 3;
          const norm = (r + 1) ** 2 + x ** 2;
          const re = ((r - 1) * (r + 1) + x ** 2) / norm;
          const im = 2 * x / norm;
          if (i === 0) ctx.moveTo(cx + radius * re, cy - radius * im);
          else ctx.lineTo(cx + radius * re, cy - radius * im);
        }
        ctx.lineTo(cx + radius, cy);
        ctx.strokeStyle = '#e3dfd4'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    line(cx - radius, cy, cx + radius, cy, '#c2beb2');
    ctx.font = '10px ' + monoFont;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = axisInk;
    rs.slice(1).forEach(r => ctx.fillText(COMMA ? String(r).replace('.', ',') : String(r), cx + radius * (r - 1) / (r + 1), cy + 4));
    ctx.restore();
    // Reactance labels sit just outside the unit circle where each x arc meets it.
    ctx.font = '9.5px ' + monoFont; ctx.fillStyle = axisInk; ctx.textBaseline = 'middle';
    for (const reactance of [0.2, 0.5, 1, 2, 5]) {
      for (const sign of [1, -1]) {
        const x = reactance * sign, norm = x * x + 1;
        const re = (x * x - 1) / norm, im = 2 * x / norm;
        ctx.textAlign = re > 0.15 ? 'left' : re < -0.15 ? 'right' : 'center';
        const label = (sign > 0 ? '+j' : '−j') + (COMMA ? String(reactance).replace('.', ',') : String(reactance));
        ctx.fillText(label, cx + (radius + 11) * re, cy - (radius + 9) * im);
      }
    }
  }

  function drawSmith(w, h) {
    const traces = model.traces.filter(t => t.visible);
    let maximum = 1;
    for (const t of traces) {
      for (let i = 0; i < t.complex.length; i += 2) {
        const mag = Math.hypot(t.complex[i], t.complex[i + 1]);
        if (Number.isFinite(mag)) maximum = Math.max(maximum, mag);
      }
    }
    const cx = w / 2, cy = (h - 6) / 2;
    const radius = Math.max(20, (Math.min(w, h) / 2 - 25) / maximum);
    const xy = (r, im) => [cx + radius * r, cy - radius * im];
    geometry = { left: 10, right: w - 10, top: 5, bottom: h - 8, xy };
    smithGrid(cx, cy, radius);
    for (const trace of traces) {
      ctx.beginPath();
      let pen = false, count = 0, lastPoint;
      for (let i = 0; i < trace.complex.length; i += 2) {
        const point = xy(trace.complex[i], trace.complex[i + 1]);
        if (!point.every(Number.isFinite)) { pen = false; continue; }
        if (pen) ctx.lineTo(...point);
        else ctx.moveTo(...point);
        pen = true; count++; lastPoint = point;
      }
      ctx.lineWidth = 1.8; ctx.strokeStyle = trace.color; ctx.stroke();
      if (count === 1) dot(...lastPoint, trace.color);
    }
    model.markers.forEach((index, i) => {
      if (index === null) return;
      for (const trace of traces) {
        const point = xy(trace.complex[index * 2], trace.complex[index * 2 + 1]);
        if (!point.every(Number.isFinite)) continue;
        dot(...point, markerColors[i], i === model.activeMarker ? 5 : 4.3);
        markerTag(point[0] + (i % 2 ? 13 : -13), Math.max(2, point[1] - 21 - (i > 1 ? 17 : 0)), 'M' + (i + 1), markerColors[i], i === model.activeMarker);
      }
    });
    if (maximum > 1.0001) {
      ctx.font = '10px ' + uiFont; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = axisInk;
      ctx.fillText(tr('Werte außerhalb |Γ| = 1'), 10, h - 16);
    }
    if (!traces.length) {
      ctx.font = '600 12px ' + uiFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = axisInk;
      ctx.fillText(tr('Keine Kurve eingeblendet'), cx, cy - 18);
    }
    rendered = null;
  }

  function draw() {
    if (!model || !canvas.clientWidth || !canvas.clientHeight) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
    if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    if (model.smith) drawSmith(w, h);
    else drawXY(w, h);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function pointFrom(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const inside = p => geometry && p.x >= geometry.left && p.x <= geometry.right && p.y >= geometry.top && p.y <= geometry.bottom;
  const onScale = p => geometry && !model.smith && geometry.ySpan && p.x < geometry.left && p.y >= geometry.top && p.y <= geometry.bottom;
  let yDrag = null;
  // The vertical range is changed in the mapped space, so linear, log and symmetric log behave the same.
  function yRangeFrom(base, span) {
    const range = [geometry.yUnmap(base), geometry.yUnmap(base + span)];
    return range.every(Number.isFinite) && range[1] > range[0] ? range : null;
  }
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function pickSmith(p) {
    let index = null, best = Infinity;
    for (const trace of model.traces) {
      if (!trace.visible) continue;
      for (let i = 0; i < model.f.length; i++) {
        const [x, y] = geometry.xy(trace.complex[i * 2], trace.complex[i * 2 + 1]);
        const distance = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (distance < best) { best = distance; index = i; }
      }
    }
    return index;
  }

  const indexAt = p => model.smith ? pickSmith(p) : nearest(model.f, geometry.fAt(p.x), model.xScale === 'log');
  const touches = new Map();
  let gesture = null, lastTap = null, pendingMarker = null, pendingZoom = null, pendingDrag = null, gestureFrame = 0;

  // A marker is grabbed at its tag above the plot or within a few pixels of its line.
  function markerHit(p) {
    if (!model || !geometry) return null;
    for (const tag of geometry.tags || []) {
      if (p.x >= tag.x0 && p.x <= tag.x1 && p.y >= tag.y0 && p.y <= tag.y1) return tag.i;
    }
    if (model.smith || p.y < geometry.top || p.y > geometry.bottom) return null;
    let best = null;
    model.markers.forEach((index, i) => {
      if (index === null || index === undefined) return;
      const d = Math.abs(geometry.x(model.f[index]) - p.x);
      if (d <= 5 && (best === null || d < best.d)) best = { i, d };
    });
    return best?.i ?? null;
  }

  // Marker and zoom updates from touch moves are coalesced to one per animation frame.
  function flushGesture() {
    gestureFrame = 0;
    if (!model) return;
    if (pendingZoom) { const range = pendingZoom; pendingZoom = null; model.onZoom(range); }
    if (pendingMarker !== null) { const index = pendingMarker; pendingMarker = null; model.onMarker(index); }
    if (pendingDrag) { const [i, index] = pendingDrag; pendingDrag = null; model.onMarkerDrag?.(i, index); }
    if (pendingY) { const range = pendingY; pendingY = null; model.onYRange?.(range); }
  }
  let pendingY = null;
  function queue(kind, value) {
    if (kind === 'yrange') pendingY = value;
    else if (kind === 'zoom') pendingZoom = value;
    else if (kind === 'drag') pendingDrag = value;
    else pendingMarker = value;
    if (!gestureFrame) gestureFrame = requestAnimationFrame(flushGesture);
  }

  const toAxis = f => model.xScale === 'log' ? Math.log(f) : f;
  const fromAxis = t => model.xScale === 'log' ? Math.exp(t) : t;

  function startPinch() {
    const [a, b] = [...touches.values()];
    const mid = (a.x + b.x) / 2;
    gesture = {
      type: 'pinch', distance: Math.max(24, Math.abs(a.x - b.x)),
      span: toAxis(geometry.xhi) - toAxis(geometry.xlo),
      anchor: toAxis(geometry.fAt(clamp(mid, geometry.left, geometry.right)))
    };
  }

  // Vertical axis by touch: one finger on the scale pans it, two fingers above each other zoom it.
  const yTouch = () => !!model.onYRange && !model.smith && !!geometry.ySpan;
  const upright = (a, b) => Math.abs(a.y - b.y) > 1.5 * Math.abs(a.x - b.x);
  function startYPinch() {
    const [a, b] = [...touches.values()], g = geometry;
    const fraction = clamp((g.bottom - (a.y + b.y) / 2) / (g.bottom - g.top), 0, 1);
    gesture = { type: 'ypinch', distance: Math.max(24, Math.abs(a.y - b.y)), span: g.ySpan, anchor: g.yBase + fraction * g.ySpan, top: g.top, bottom: g.bottom };
  }
  function moveYPinch() {
    const [a, b] = [...touches.values()], g = gesture;
    const span = g.span * g.distance / Math.max(24, Math.abs(a.y - b.y));
    const fraction = clamp((g.bottom - (a.y + b.y) / 2) / (g.bottom - g.top), 0, 1);
    const range = yRangeFrom(g.anchor - fraction * span, span);
    if (range) queue('yrange', range);
  }
  // The page scrolls vertically over the plot. A touch that starts on the scale, or two fingers above each other, belongs to the axis instead.
  canvas.addEventListener('touchstart', e => {
    if (!model || !geometry || !yTouch()) return;
    const rect = canvas.getBoundingClientRect(), points = [...e.touches].map(t => ({ x: t.clientX - rect.left, y: t.clientY - rect.top }));
    if ((points.length === 1 && onScale(points[0])) || (points.length === 2 && (points.some(onScale) || upright(points[0], points[1]))) || gesture?.type === 'yscale' || gesture?.type === 'ypinch') e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => { if (gesture?.type === 'yscale' || gesture?.type === 'ypinch') e.preventDefault(); }, { passive: false });

  function movePinch() {
    const [a, b] = [...touches.values()];
    const full = domain();
    const fullSpan = toAxis(full.hi) - toAxis(full.lo);
    const mid = clamp((a.x + b.x) / 2, geometry.left, geometry.right);
    let span = gesture.span * gesture.distance / Math.max(24, Math.abs(a.x - b.x));
    if (span >= fullSpan) { queue('zoom', null); return; }
    const fraction = (mid - geometry.left) / (geometry.right - geometry.left);
    let base = gesture.anchor - fraction * span;
    base = clamp(base, toAxis(full.lo), toAxis(full.hi) - span);
    const lo = fromAxis(base), hi = fromAxis(base + span);
    if (lowerBound(model.f, hi) - lowerBound(model.f, lo) >= 2) queue('zoom', [lo, hi]);
  }

  canvas.addEventListener('pointerdown', e => {
    if (!model || e.button !== 0 || !geometry) return;
    const p = pointFrom(e);
    const hit = markerHit(p);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, p);
      if (touches.size === 2 && yTouch() && (gesture?.type === 'yscale' || [...touches.values()].some(onScale) || upright(...touches.values()))) startYPinch();
      else if (touches.size === 2 && !model.smith) startPinch();
      else if (touches.size === 1 && onScale(p) && yTouch()) gesture = { type: 'yscale', start: p, base: geometry.yBase, span: geometry.ySpan, height: geometry.bottom - geometry.top, moved: false };
      else if (touches.size === 1 && hit !== null && !model.smith) {
        gesture = { type: 'marker', i: hit, start: p };
        model.onMarkerSelect?.(hit);
      } else if (touches.size === 1) gesture = inside(p) ? { type: 'touch', start: p, moved: false } : null;
      else gesture = null;
      return;
    }
    if (hit !== null && !model.smith) {
      markerDrag = { i: hit, id: e.pointerId, moved: false };
      canvas.setPointerCapture(e.pointerId);
      model.onMarkerSelect?.(hit);
      return;
    }
    if (onScale(p) && model.onYRange) {
      yDrag = { y: p.y, base: geometry.yBase, span: geometry.ySpan, height: geometry.bottom - geometry.top, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (!inside(p)) return;
    if (!model.smith && e.pointerType === 'mouse') {
      dragging = { start: p.x, current: p.x, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!model || !geometry) return;
    const p = pointFrom(e);
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, p);
      if (gesture?.type === 'pinch' && touches.size === 2) movePinch();
      else if (gesture?.type === 'ypinch' && touches.size === 2) moveYPinch();
      else if (gesture?.type === 'yscale') {
        if (!gesture.moved && Math.abs(p.y - gesture.start.y) > 6) gesture.moved = true;
        if (gesture.moved) { const range = yRangeFrom(gesture.base + (p.y - gesture.start.y) / gesture.height * gesture.span, gesture.span); if (range) queue('yrange', range); }
      } else if (gesture?.type === 'marker') {
        const index = nearest(model.f, geometry.fAt(clamp(p.x, geometry.left, geometry.right)), model.xScale === 'log');
        queue('drag', [gesture.i, index]);
      } else if (gesture?.type === 'touch') {
        const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
        // A mostly horizontal swipe drags the marker; vertical swipes keep scrolling the page.
        if (!gesture.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) gesture.moved = true;
        if (gesture.moved) {
          const q = model.smith ? p : { x: clamp(p.x, geometry.left, geometry.right), y: p.y };
          const index = indexAt(q);
          if (index !== null) queue('marker', index);
        }
      }
      return;
    }
    if (model.smith) return;
    if (yDrag) {
      const range = yRangeFrom(yDrag.base + (p.y - yDrag.y) / yDrag.height * yDrag.span, yDrag.span);
      if (range) queue('yrange', range);
      return;
    }
    if (markerDrag) {
      markerDrag.moved = true;
      const index = nearest(model.f, geometry.fAt(clamp(p.x, geometry.left, geometry.right)), model.xScale === 'log');
      queue('drag', [markerDrag.i, index]);
      return;
    }
    if (dragging) dragging.current = clamp(p.x, geometry.left, geometry.right);
    hovering = inside(p) ? p : null;
    canvas.style.cursor = markerHit(p) !== null ? 'ew-resize' : inside(p) ? 'crosshair' : onScale(p) && model.onYRange ? 'ns-resize' : '';
    schedule();
  });
  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'touch') { hovering = null; schedule(); }
  });
  canvas.addEventListener('pointercancel', e => {
    touches.delete(e.pointerId);
    gesture = null; dragging = null; markerDrag = null; yDrag = null; hovering = null; schedule();
  });
  canvas.addEventListener('pointerup', e => {
    if (!model || e.button !== 0 || !geometry) return;
    const p = pointFrom(e);
    if (yDrag) { yDrag = null; return; }
    if (markerDrag && e.pointerType !== 'touch') {
      markerDrag = null;
      schedule();
      return;
    }
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      const current = gesture;
      if (current?.type === 'pinch' || current?.type === 'ypinch' || current?.type === 'marker') { gesture = touches.size ? { type: 'idle' } : null; return; }
      gesture = null;
      if (current?.type === 'yscale') {
        // Double tap on the scale returns to the automatic range, like the double click with the mouse.
        if (current.moved) return;
        const now = performance.now();
        if (lastTap && lastTap.scale && now - lastTap.time < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { lastTap = null; model.onYRange?.(null); }
        else lastTap = { time: now, x: p.x, y: p.y, scale: true };
        return;
      }
      if (!current || current.type !== 'touch' || current.moved || !inside(p)) return;
      // A tap stays in place. A finger that travelled (e.g. the start of a vertical scroll) must not set a marker.
      if (Math.hypot(p.x - current.start.x, p.y - current.start.y) > 12) return;
      const now = performance.now();
      if (!model.smith && lastTap && now - lastTap.time < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        lastTap = null;
        model.onZoom(null);
        return;
      }
      lastTap = { time: now, x: p.x, y: p.y };
      const index = indexAt(p);
      if (index !== null) model.onMarker(index);
      return;
    }
    if (dragging && Math.abs(dragging.current - dragging.start) > 8) {
      const from = geometry.fAt(Math.min(dragging.current, dragging.start));
      const to = geometry.fAt(Math.max(dragging.current, dragging.start));
      dragging = null; hovering = null;
      model.onZoom([from, to]);
    } else {
      dragging = null;
      if (!inside(p)) { schedule(); return; }
      const index = indexAt(p);
      if (index !== null) model.onMarker(index);
    }
    schedule();
  });
  canvas.addEventListener('dblclick', e => {
    if (!model || model.smith || !geometry) return;
    if (onScale(pointFrom(e))) { model.onYRange?.(null); return; }
    if (!inside(pointFrom(e))) return;
    model.onZoom(null);
  });

  canvas.addEventListener('wheel', e => {
    if (!model || model.smith || !geometry) return;
    const pos = pointFrom(e), g = geometry;
    const scale = Math.exp(clamp(e.deltaY, -250, 250) * 0.0023);
    if (model.onYRange && g.ySpan && (onScale(pos) || (e.shiftKey && inside(pos)))) {
      // On the scale, or with Shift inside the plot: zoom the vertical axis around the pointer.
      e.preventDefault();
      const fraction = clamp((g.bottom - pos.y) / (g.bottom - g.top), 0, 1), anchor = g.yBase + fraction * g.ySpan, span = g.ySpan * scale;
      const range = yRangeFrom(anchor - fraction * span, span);
      if (range) model.onYRange(range);
      return;
    }
    if (!inside(pos)) return;
    e.preventDefault();
    const ratio = (pos.x - g.left) / (g.right - g.left);
    const x = g.xBase + ratio * g.xSpan;
    const base = domain();
    const lo = Math.max(base.lo, g.unMap(x - ratio * g.xSpan * scale));
    const hi = Math.min(base.hi, g.unMap(x + (1 - ratio) * g.xSpan * scale));
    if (hi > lo && lowerBound(model.f, hi) - lowerBound(model.f, lo) >= 2) model.onZoom([lo, hi]);
  }, { passive: false });

  canvas.addEventListener('keydown', e => {
    if (!model || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const index = model.markers[model.activeMarker] ?? 0;
    const step = e.shiftKey ? 10 : 1;
    const min = !model.smith && model.xScale === 'log' && model.f[0] === 0 ? 1 : 0;
    let next = index + (e.key === 'ArrowRight' ? step : -step);
    if (e.key === 'Home') next = min;
    if (e.key === 'End') next = model.f.length - 1;
    model.onMarker(clamp(next, min, model.f.length - 1));
  });

  new ResizeObserver(schedule).observe(canvas);

  function set(next, preserveHover = false) {
    if (!preserveHover) { hovering = null; dragging = null; }
    model = next;
    schedule();
  }

  function image(title, subtitle) {
    if (!model) return Promise.resolve(null);
    hovering = null; dragging = null;
    draw();
    const exportCanvas = document.createElement('canvas');
    const ratio = canvas.width / canvas.clientWidth;
    const visible = model.traces.filter(t => t.visible);
    const lineHeight = 19, header = 60;
    const cols = Math.max(1, Math.floor((canvas.clientWidth - 16) / 143));
    const footer = Math.ceil(visible.length / cols) * lineHeight + 10;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + Math.round((header + footer) * ratio);
    const ec = exportCanvas.getContext('2d');
    ec.setTransform(ratio, 0, 0, ratio, 0, 0);
    ec.fillStyle = '#fff'; ec.fillRect(0, 0, exportCanvas.width / ratio, exportCanvas.height / ratio);
    ec.fillStyle = ink; ec.font = '700 18px ' + uiFont; ec.fillText(tr(title), 16, 24, canvas.clientWidth - 30);
    ec.fillStyle = axisInk; ec.font = '12px ' + uiFont; ec.fillText(tr(subtitle), 16, 43, canvas.clientWidth - 30);
    ec.drawImage(canvas, 0, header, canvas.clientWidth, canvas.clientHeight);
    visible.forEach((t, i) => {
      const x = 16 + (i % cols) * 143, y = header + canvas.clientHeight + Math.floor(i / cols) * lineHeight + 7;
      ec.setLineDash(t.dash ? [4, 2.5] : []); ec.strokeStyle = t.color; ec.lineWidth = 2;
      ec.beginPath(); ec.moveTo(x, y - 4); ec.lineTo(x + 14, y - 4); ec.stroke(); ec.setLineDash([]);
      ec.fillStyle = ink; ec.font = '11px ' + monoFont; ec.fillText(tr(t.label), x + 17, y, 116);
    });
    return new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
  }

  return { set, image, domain, lastLimits: () => rendered, snapInfo: () => geometry?.snap ?? null, tagRects: () => geometry?.tags ?? [], formatFreq, parseFreq, nearest, lowerBound, formatNumber };
})();
