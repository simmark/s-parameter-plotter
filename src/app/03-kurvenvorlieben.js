  // ---- Curve preferences per device type: kept on this device and part of the exchangeable pack. ----
  const Prefs = (() => {
    const KEY = 'spa-prefs';
    let curves = {};
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && typeof v.curves === 'object' && v.curves) curves = v.curves; } catch { curves = {}; }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ curves })); } catch { /* storage full or blocked */ } };
    const keys = v => Array.isArray(v) && v.length <= 32 && v.every(k => typeof k === 'string' && k.length < 40);
    const clean = v => v && typeof v === 'object' ? { ...(keys(v.mm) ? { mm: v.mm } : {}), ...(keys(v.se) ? { se: v.se } : {}), ...(keys(v.hidden) ? { hidden: v.hidden.slice(0, 80) } : {}) } : null;
    return {
      get: type => curves[type] ?? null,
      set(type, value) { curves[type] = value; save(); },
      clear() { curves = {}; save(); },
      all: () => JSON.parse(JSON.stringify(curves)),
      merge(incoming) {
        let n = 0;
        for (const [type, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
          if (!/^[a-z]{2,12}$/.test(type)) continue;
          const c = clean(value);
          if (c && Object.keys(c).length) { curves[type] = c; n++; }
        }
        if (n) save();
        return n;
      },
      get size() { return Object.keys(curves).length; }
    };
  })();

