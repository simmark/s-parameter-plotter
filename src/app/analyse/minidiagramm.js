// analyse/minidiagramm – Kleines SVG-Liniendiagramm für Panels (Übersprechen, Zeitbereich).
import { esc } from '../basis/dom.js';

// Small SVG line chart for derived curves (crosstalk sums, time domain). Series: { name, color, x, y, dash }. Text bypasses i18n.
function miniChart(series, { xLog = false, xFmt = v => String(v), yFmt = v => String(v), yLabel = '', xLabel = '', yRange = null, height = 260, label = '' } = {}) {
  const W = 760, H = height, L = 56, R = 12, T = 12, B = 34;
  const pts = series.flatMap(s => s.x.map((x, i) => [x, s.y[i]])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0));
  if (!pts.length) return '';
  const tx = v => xLog ? Math.log10(v) : v;
  let x0 = Math.min(...pts.map(p => tx(p[0]))), x1 = Math.max(...pts.map(p => tx(p[0])));
  let [y0, y1] = yRange || [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
  if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.05; if (!yRange) { y0 -= pad; y1 += pad; }
  if (x1 === x0) x1 = x0 + 1;
  const sx = v => L + (tx(v) - x0) / (x1 - x0) * (W - L - R), sy = v => T + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (H - T - B);
  const nice = (a, b, n) => { const step0 = (b - a) / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 5, 10].map(m => m * mag).find(m => m >= step0); const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * step; v += step) out.push(+v.toPrecision(12)); return out; };
  const xt = xLog ? Array.from({ length: Math.floor(x1) - Math.ceil(x0) + 1 }, (_, i) => 10 ** (Math.ceil(x0) + i)) : nice(x0, x1, 6), yt = nice(y0, y1, 5);
  const grid = xt.map(v => '<line class="grid" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="axis" x="' + sx(v) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + esc(xFmt(v)) + '</text>').join('') +
    yt.map(v => '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/><text class="axis" x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + esc(yFmt(v)) + '</text>').join('');
  const paths = series.map(s => {
    let d = '', pen = false;
    s.x.forEach((x, i) => { const y = s.y[i]; if (!Number.isFinite(x) || !Number.isFinite(y) || (xLog && !(x > 0))) { pen = false; return; } d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1); pen = true; });
    return '<path class="series" d="' + d + '" stroke="' + s.color + '"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
  }).join('');
  return '<figure class="mini-figure" data-no-i18n><svg class="mini-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + grid +
    '<text class="axis" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + esc(xLabel) + '</text><text class="axis" x="4" y="' + (T + 2) + '">' + esc(yLabel) + '</text>' + paths + '</svg>' +
    '<ul class="mini-legend">' + series.map(s => '<li><i' + (s.dash ? ' class="dashed"' : '') + ' style="--c:' + s.color + '"></i>' + esc(s.name) + '</li>').join('') + '</ul></figure>';
}

export { miniChart };
