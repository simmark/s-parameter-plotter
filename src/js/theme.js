// Default to the light workbench. Keep the last manually selected theme.
window.Theme = (() => {
  const KEY = 'spa-theme', cache = new Map();
  let pref = 'light';
  try { if (localStorage.getItem(KEY) === 'dark') pref = 'dark'; } catch { /* storage unavailable */ }
  const dark = () => pref === 'dark';
  function apply() {
    document.documentElement.dataset.theme = dark() ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark() ? '#121A18' : '#F4F1E9');
  }
  function shift(r, g, b) {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    if (s >= 0.3 && l >= 0.25 && l <= 0.8) return [r, g, b];
    let h = 0;
    if (d) h = max === r / 255 ? ((g - b) / 255 / d) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
    const nl = 0.105 + 0.82 * (1 - l), ns = Math.min(nl < 0.3 ? s * 0.55 : s, nl < 0.3 || nl > 0.8 ? 0.14 : 1), c = (1 - Math.abs(2 * nl - 1)) * ns, x = c * (1 - Math.abs(h % 2 - 1)), m = nl - c / 2;
    const k = ((Math.floor(h) % 6) + 6) % 6, rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
    return rgb.map(v => Math.round(255 * (v + m)));
  }
  function map(color) {
    if (!dark()) return color;
    if (cache.has(color)) return cache.get(color);
    let out = color;
    const hex = /^#([0-9a-f]{3,8})$/i.exec(color), rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
    if (hex && [3, 6, 8].includes(hex[1].length)) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
      const v = shift(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
      out = '#' + v.map(n => n.toString(16).padStart(2, '0')).join('') + h.slice(6);
    } else if (rgb) {
      const v = shift(+rgb[1], +rgb[2], +rgb[3]);
      out = 'rgba(' + v.join(',') + ',' + (rgb[4] ?? 1) + ')';
    }
    cache.set(color, out);
    return out;
  }
  apply();
  return { map, dark, toggle() { pref = dark() ? 'light' : 'dark'; try { localStorage.setItem(KEY, pref); } catch { /* not persisted */ } apply(); } };
})();
