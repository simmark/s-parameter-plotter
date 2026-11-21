// dateien/vorlagen – Gelernte Vorlagen: Verhaltens-Fingerabdruck findet die Port-Zuordnung neuer Dateien.
import { physicsLabel } from '../analyse/erkennung.js';
import { nextTick } from '../basis/dom.js';

// ---- Learned templates: a behaviour fingerprint finds the port assignment of a new file by itself. ----
const Templates = (() => {
  const KEY = 'spa-templates', AUTO = 5, CAP = 3000;
  const GRID = [];
  for (let k = 12; k <= 41; k++) GRID.push(10 ** (k / 4));
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ } };
  const dB = value => Math.max(-70, Math.min(5, 20 * Math.log10(RF.abs(value))));
  const similarity = score => Math.max(0, Math.round(100 * (1 - score / 20)));

  const rolePort = (role, a) => role[0] === 'p' ? a.pairs[Number(role.slice(1, -1))]?.[Number(role.slice(-1))] : role[0] === 'l' ? a.loaded[Number(role.slice(1))] : a.singles[Number(role.slice(1))];
  const resolveLoad = (load, a) => load.type === 'join' ? { type: 'join', to: rolePort(load.role, a) } : { ...load };

  function featureKeys(k, m) {
    const keys = [];
    for (let i = 1; i <= k; i++) {
      keys.push('D' + i + ':D' + i, 'C' + i + ':C' + i, 'C' + i + ':D' + i);
      for (let j = 1; j < i; j++) keys.push('D' + i + ':D' + j, 'C' + i + ':C' + j, 'C' + i + ':D' + j, 'D' + i + ':C' + j);
    }
    for (let a = 1; a <= m; a++) {
      keys.push('S' + a + ':S' + a);
      for (let b = 1; b < a; b++) keys.push('S' + a + ':S' + b);
      if (k) keys.push('S' + a + ':D1');
    }
    return keys.slice(0, 40);
  }

  // Evaluates the feature curves of a dataset for one assignment of ports to the roles of a template.
  function evaluate(dataset, shape, a, points, keys) {
    const loads = RF.indices(dataset.n).map(() => ({ type: 'active' }));
    a.loaded.forEach((port, i) => { loads[port] = resolveLoad(shape.loads[i], a); });
    const config = { loads, ref: shape.ref ?? null, pairs: a.pairs.map(([p, q], i) => ({ id: i + 1, p, q, zd: shape.z[i]?.[0], zc: shape.z[i]?.[1] })) };
    let layout;
    try { layout = RF.prepareNetwork(dataset, config); } catch { return null; }
    const index = new Map(layout.mmModes.map((mode, i) => [mode.type === 'P' ? 'S' + (a.singles.indexOf(mode.port) + 1) : mode.key, i]));
    const cells = keys.map(key => key.split(':').map(k => index.get(k)));
    const size = layout.mmModes.length, values = keys.map(() => []), raw = [];
    for (const point of points) {
      const mm = RF.processPoint(dataset, config, layout, point)[1];
      raw.push(mm);
      cells.forEach(([r, c], i) => values[i].push(mm && r !== undefined && c !== undefined ? dB(RF.get(mm, size, r, c)) : NaN));
    }
    return { values, raw, index, size };
  }

  // Sign of the through path D1 → Di in the passband; magnitudes cannot tell the polarity of a pair.
  function polarity(result, k) {
    const signs = [];
    for (let i = 2; i <= k; i++) {
      const r = result.index.get('D' + i), c = result.index.get('D1');
      let top = null;
      for (const mm of result.raw) {
        const value = mm && RF.get(mm, result.size, r, c);
        if (value && (!top || RF.abs(value) > RF.abs(top))) top = value;
      }
      signs.push(top && RF.abs(top) > 0.03 && Math.abs(top[0]) > 0.3 * RF.abs(top) ? Math.sign(top[0]) : 0);
    }
    return signs;
  }

  function* assignments(n, shape, first) {
    if (first) yield first;
    const used = new Array(n).fill(false), k = shape.z.length, count = shape.loads.length, m = shape.singles;
    const same = shape.loads.map((load, i) => i > 0 && JSON.stringify(load) === JSON.stringify(shape.loads[i - 1]));
    const a = { pairs: [], loaded: [], singles: [] };
    function* single(i) {
      if (i === m) { yield { pairs: a.pairs.map(pair => [...pair]), loaded: [...a.loaded], singles: [...a.singles] }; return; }
      for (let p = 0; p < n; p++) {
        if (used[p]) continue;
        used[p] = true; a.singles[i] = p;
        yield* single(i + 1);
        used[p] = false;
      }
    }
    function* load(i) {
      if (i === count) { yield* single(0); return; }
      for (let p = same[i] ? a.loaded[i - 1] + 1 : 0; p < n; p++) {
        if (used[p]) continue;
        used[p] = true; a.loaded[i] = p;
        yield* load(i + 1);
        used[p] = false;
      }
    }
    function* pair(i) {
      if (i === k) { yield* load(0); return; }
      for (let p = 0; p < n; p++) {
        if (used[p]) continue;
        for (let q = p + 1; q < n; q++) {
          if (used[q]) continue;
          used[p] = used[q] = true; a.pairs[i] = [p, q];
          yield* pair(i + 1);
          used[p] = used[q] = false;
        }
      }
    }
    yield* pair(0);
  }

  async function match(dataset, alive = () => true) {
    const out = [], fs = dataset.freq;
    let clock = performance.now();
    for (const tpl of list) {
      if (tpl.n !== dataset.n) continue;
      const common = tpl.fp.g.map((gi, i) => [gi, i]).filter(([gi]) => GRID[gi] >= fs[0] * 0.97 && GRID[gi] <= fs.at(-1) * 1.03);
      if (common.length < 5) continue;
      const points = common.map(([gi]) => Plot.nearest(fs, GRID[gi], true)), cols = common.map(([, i]) => i);
      let best = null, count = 0, capped = false;
      for (const a of assignments(dataset.n, tpl.shape, tpl.map)) {
        if (++count > CAP) { capped = true; break; }
        const result = evaluate(dataset, tpl.shape, a, points, tpl.fp.keys);
        if (result) {
          let sum = 0, num = 0;
          result.values.forEach((row, r) => row.forEach((value, c) => {
            const ref = tpl.fp.v[r][cols[c]];
            if (Number.isFinite(value) && Number.isFinite(ref)) { sum += Math.abs(value - ref); num++; }
          }));
          const score = num >= 5 ? sum / num : Infinity;
          if (!best || score < best.score - 0.05) best = { score, a, result };
          if (count === 1 && score <= 1.5) break;
        }
        if (performance.now() - clock > 25) {
          await nextTick();
          if (!alive()) return [];
          clock = performance.now();
        }
      }
      if (!best || !Number.isFinite(best.score)) continue;
      polarity(best.result, tpl.shape.z.length).forEach((sign, i) => {
        if (sign && tpl.pol[i] && sign !== tpl.pol[i]) (best.a.flip ??= {})[i + 1] = true;
      });
      out.push({ tpl, score: best.score, a: best.a, capped });
    }
    out.sort((x, y) => x.score - y.score);
    const seen = new Set();
    return out.filter(item => !seen.has(item.tpl.name) && seen.add(item.tpl.name));
  }

  function learn(name, dataset, config, view) {
    const paired = new Set(config.pairs.flatMap(pair => [pair.p, pair.q]));
    const singles = [], loaded = [];
    for (let i = 0; i < dataset.n; i++) {
      if (paired.has(i)) continue;
      if (config.loads[i].type === 'active') singles.push(i);
      else loaded.push({ port: i, load: config.loads[i], key: config.loads[i].type === 'join' ? 'join' : JSON.stringify(config.loads[i]) });
    }
    loaded.sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : x.port - y.port);
    const roleOf = port => {
      const pi = config.pairs.findIndex(pair => pair.p === port || pair.q === port);
      if (pi >= 0) return 'p' + pi + (config.pairs[pi].p === port ? 0 : 1);
      const li = loaded.findIndex(item => item.port === port);
      return li >= 0 ? 'l' + li : 's' + singles.indexOf(port);
    };
    const shape = { z: config.pairs.map(pair => [pair.zd ?? null, pair.zc ?? null]), loads: loaded.map(item => item.load.type === 'join' ? { type: 'join', role: roleOf(item.load.to) } : item.load), singles: singles.length, ref: config.ref ?? null };
    const map = { pairs: config.pairs.map(pair => [pair.p, pair.q]), loaded: loaded.map(item => item.port), singles };
    const g = GRID.map((_, i) => i).filter(i => GRID[i] >= dataset.freq[0] && GRID[i] <= dataset.freq.at(-1));
    if (g.length < 5) throw new Error('Der Frequenzbereich ist für einen Fingerabdruck zu schmal.');
    const keys = featureKeys(shape.z.length, shape.singles);
    const result = evaluate(dataset, shape, map, g.map(i => Plot.nearest(dataset.freq, GRID[i], true)), keys);
    if (!result) throw new Error('Die Portkonfiguration lässt sich nicht auswerten.');
    const toRole = key => key.split(':').map(k => k[0] === 'P' ? 'S' + (singles.indexOf(Number(k.slice(1)) - 1) + 1) : k).join(':');
    const tpl = {
      id: Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name, n: dataset.n, shape, map,
      fp: { g, keys, v: result.values.map(row => row.map(value => Math.round(value * 10) / 10)) },
      pol: polarity(result, shape.z.length), file: dataset.name, savedAt: Date.now(), ...physicsLabel(name, dataset),
      view: { tab: view.tab, basis: view.basis, sFormat: view.sFormat, traces: (view.sKeys.mm || []).map(toRole).filter(key => !/S0/.test(key)) }
    };
    list = list.filter(item => !(item.name === name && item.n === tpl.n && item.file === tpl.file));
    list.unshift(tpl);
    const group = list.filter(item => item.name === name && item.n === tpl.n);
    if (group.length > 8) list = list.filter(item => item !== group.at(-1));
    list = list.slice(0, 200);
    save();
    return tpl;
  }

  function settings({ tpl, a }, n) {
    const loads = RF.indices(n).map(() => ({ type: 'active' }));
    a.loaded.forEach((port, i) => { loads[port] = resolveLoad(tpl.shape.loads[i], a); });
    const pairs = a.pairs.map((pair, i) => {
      const [zd, zc] = tpl.shape.z[i], [p, q] = a.flip?.[i] ? [pair[1], pair[0]] : pair;
      return { id: i + 1, p, q, ...(zd ? { zd } : {}), ...(zc ? { zc } : {}) };
    });
    const fromRole = key => key.split(':').map(k => k[0] === 'S' ? 'P' + (a.singles[Number(k.slice(1)) - 1] + 1) : k).join(':');
    const traces = tpl.view.traces.map(fromRole);
    return {
      config: { loads, pairs, ref: tpl.shape.ref }, tab: tpl.view.tab, basis: tpl.view.basis, sFormat: tpl.view.sFormat,
      sKeys: { mm: traces.length ? traces : null, se: null }, profileName: tpl.name
    };
  }

  function groups() {
    const out = new Map();
    for (const tpl of list) {
      const key = tpl.n + '|' + tpl.name;
      const group = out.get(key) ?? { key, name: tpl.name, n: tpl.n, count: 0, pairs: tpl.shape.z.length };
      group.count++;
      out.set(key, group);
    }
    return [...out.values()];
  }

  function remove(key) {
    list = list.filter(tpl => tpl.n + '|' + tpl.name !== key);
    save();
  }

  // Packs from other people or devices: validate the shape of every template before it is trusted.
  const finite = v => Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x));
  function valid(t) {
    try {
      return t && typeof t.id === 'string' && t.id.length <= 40 && typeof t.name === 'string' && t.name.length >= 1 && t.name.length <= 60 &&
        Number.isInteger(t.n) && t.n >= 2 && t.n <= 64 && Array.isArray(t.shape?.z) && t.shape.z.length <= 16 && Array.isArray(t.shape?.loads) &&
        Array.isArray(t.map?.pairs) && Array.isArray(t.map?.singles) && Array.isArray(t.map?.loaded) &&
        finite(t.fp?.g) && Array.isArray(t.fp?.keys) && t.fp.keys.every(k => typeof k === 'string') && Array.isArray(t.fp?.v) && t.fp.v.every(finite) &&
        t.fp.v.length === t.fp.keys.length && Array.isArray(t.view?.traces) && t.view.traces.every(k => typeof k === 'string') && JSON.stringify(t).length < 60000;
    } catch { return false; }
  }
  // Optional v1 extensions (class, physics fingerprint) are kept only if well-formed; older apps ignore them.
  const validPhys = ph => ph && typeof ph === 'object' && ['m4', 'p2'].includes(ph.kind) && JSON.stringify(ph).length < 2000 &&
    Object.values(ph).every(v => v === null || typeof v === 'string' || Number.isFinite(v) || (Array.isArray(v) && v.length <= 8 && v.every(x => x === null || Number.isFinite(x))));
  function merge(items) {
    let added = 0, skipped = 0;
    for (const t of Array.isArray(items) ? items : []) {
      if (!valid(t)) { skipped++; continue; }
      if (list.some(x => x.id === t.id)) continue;
      const clean = { ...t, name: String(t.name).replace(/[\r\n!]/g, ' ') };
      if ('phys' in clean && !validPhys(clean.phys)) delete clean.phys;
      if ('category' in clean && !(clean.category in Magnetic.LABEL)) delete clean.category;
      list.push(clean);
      added++;
    }
    list = list.slice(0, 300);
    if (added) save();
    return { added, skipped };
  }
  return { AUTO, match, learn, settings, groups, remove, similarity, merge, all: () => list.slice(), get size() { return list.length; } };
})();

export { Templates };
