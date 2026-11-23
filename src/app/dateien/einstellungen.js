// dateien/einstellungen – Einstellungen pro Datei: speichern, Quellen abwägen und wieder anwenden.
import { physicsOf, templateConflict } from '../analyse/erkennung.js';
import { S_FORMATS } from '../analyse/formate.js';
import { hasView, loadFileStates, saveFileStates } from '../basis/erweiterung.js';
import { EDITABLE_LOADS, LOADS, Y_SCALES, defaultAxes, state } from '../basis/zustand.js';
import { blankProfile, session, sessionItem } from './sitzung.js';
import { spiceStore } from './spice.js';
import { Templates } from './vorlagen.js';

function snapshotSettings() {
  const fs = state.dataset.freq;
  return JSON.parse(JSON.stringify({
    config: state.config, tab: state.tab, basis: state.basis, sFormat: state.sFormat, sKeys: state.sKeys,
    z: state.z, cispr: state.cispr, cmc: state.cmc, esb: state.esb, pairIn: state.pairIn, pairOut: state.pairOut,
    markers: state.markers.map(i => i === null ? null : fs[i]), profileName: state.profile.name, axes: state.axes, zFamily: state.zFamily,
    ...saveFileStates()
  }));
}

function settingsFromEmbedded(dataset) {
  const e = dataset.embedded, n = dataset.n;
  if (!e) return null;
  const valid = p => Number.isInteger(p) && p >= 0 && p < n;
  const positive = value => Number.isFinite(value) && value > 0;
  const loads = RF.indices(n).map(() => ({ type: 'active' }));
  for (const { port, load } of e.loads) {
    if (load.type === 'join') {
      if (!valid(port) || !valid(load.to) || load.to === port) return null;
      loads[port] = { type: 'join', to: load.to };
      continue;
    }
    if (!valid(port) || !LOADS.some(([type]) => type === load.type)) return null;
    const value = k => Number.isFinite(load[k]) ? load[k] : 0;
    loads[port] = EDITABLE_LOADS.includes(load.type)
      ? { type: load.type, r: Math.max(0, value('r')), x: value('x'), l: Math.max(0, value('l')), c: Math.max(0, value('c')) }
      : { type: load.type };
  }
  const used = new Set();
  const pairs = [...e.pairs].sort((a, b) => a.id - b.id).map((pair, i) => ({
    id: i + 1, p: pair.p, q: pair.q, ...(positive(pair.zd) ? { zd: pair.zd } : {}), ...(positive(pair.zc) ? { zc: pair.zc } : {})
  }));
  for (const pair of pairs) {
    if (!valid(pair.p) || !valid(pair.q) || pair.p === pair.q || used.has(pair.p) || used.has(pair.q) ||
      loads[pair.p].type !== 'active' || loads[pair.q].type !== 'active') return null;
    used.add(pair.p); used.add(pair.q);
  }
  if (!loads.some(load => load.type === 'active') || loads.some(load => load.type === 'join' && loads[load.to].type === 'join')) return null;
  return {
    config: { loads, pairs, ref: positive(e.ref) ? e.ref : null }, tab: e.view.tab, basis: e.view.basis, sFormat: e.view.format,
    sKeys: { mm: e.traces.mm ?? null, se: e.traces.se ?? null }, markers: e.markers.length ? e.markers : undefined, profileName: e.name
  };
}

// Order: this session, this device, profile inside the file, learned template, previous file, default.
async function resolveSettings(item, alive) {
  if (item.settings) return { settings: item.settings, profile: item.profile ?? blankProfile() };
  const dataset = item.dataset, base = blankProfile();
  const stored = dataset.spice && spiceStore()[dataset.spice.lib + '|' + dataset.spice.sub];
  if (stored) return { settings: stored, profile: { ...base, source: 'local', name: stored.profileName || '' } };
  const embedded = settingsFromEmbedded(dataset);
  if (embedded) return { settings: embedded, profile: { ...base, source: 'file', name: dataset.embedded.name } };
  const matches = await Templates.match(dataset, alive);
  let blocked = null;
  if (matches[0] && matches[0].score <= Templates.AUTO) {
    const conflict = templateConflict(matches[0].tpl, physicsOf(dataset));
    if (!conflict) return { settings: Templates.settings(matches[0], dataset.n), profile: { ...base, source: 'template', name: matches[0].tpl.name, score: matches[0].score, matches } };
    blocked = { name: matches[0].tpl.name, score: matches[0].score, reason: conflict };
  }
  if (state.dataset && !state.dataset.demo && state.dataset.n === dataset.n) {
    const carry = snapshotSettings();
    delete carry.cmc;
    delete carry.axes;
    return { settings: carry, profile: { ...base, source: 'carry', name: state.profile.name, matches, blocked } };
  }
  return { settings: null, profile: { ...base, source: dataset.profile ? 'builtin' : 'default', matches, blocked } };
}

// Settings are stored with the file entry, so a reload restores pairs, loads, markers, axes and the open view.
let settingsTimer = null, settingsJob = null;
let settingsKey = '';
function persistSettings() {
  const item = sessionItem(session.current);
  if (!item?.entryId || !state.dataset || state.dataset.demo || item.dataset !== state.dataset) return;
  const settings = snapshotSettings(), entryId = item.entryId, sub = item.make ? item.name : null;
  // a pending write of another file goes out first; it must not be cancelled by the debounce of this one
  if (settingsJob && settingsKey !== entryId + '|' + sub) settingsJob();
  settingsKey = entryId + '|' + sub;
  settingsJob = () => {
    settingsJob = null;
    clearTimeout(settingsTimer);
    Store.updateEntry(entryId, sub ? record => ({ subs: { ...(record.subs || {}), [sub]: settings } }) : { settings }).catch(() => {});
  };
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => settingsJob?.(), 300);
}
const flushSettings = () => settingsJob?.();
function rememberCurrent(item) {
  if (!item?.entryId) return;
  Store.setMeta('session', { entryId: item.entryId, sub: item.make ? item.name : null, updatedAt: Date.now() }).catch(() => {});
}

function applySettings(dataset, saved) {
  const n = dataset.n;
  const validPort = p => Number.isInteger(p) && p >= 0 && p < n;
  const config = saved.config;
  if (!config || !Array.isArray(config.loads) || config.loads.length !== n) return;
  if (!config.pairs.every(pair => validPort(pair.p) && validPort(pair.q) && pair.p !== pair.q)) return;
  if (!config.loads.some(load => load.type === 'active')) return;
  if (!config.loads.every(load => load.type !== 'join' || (validPort(load.to) && config.loads[load.to].type !== 'join'))) return;
  state.config = { loads: config.loads, pairs: config.pairs, ref: Number.isFinite(config.ref) && config.ref > 0 ? config.ref : null };
  if (Array.isArray(config.triples) && config.triples.length && config.triples.every(t => [t.a, t.b, t.c].every(validPort) && new Set([t.a, t.b, t.c]).size === 3)) {
    state.config.triples = config.triples.map((t, i) => ({ a: t.a, b: t.b, c: t.c, id: i + 1 }));
  }
  if (hasView(saved.tab)) state.tab = saved.tab;
  if (['se', 'mm'].includes(saved.basis)) state.basis = saved.basis;
  if (S_FORMATS.some(([key]) => key === saved.sFormat)) state.sFormat = saved.sFormat;
  if (saved.sKeys) state.sKeys = { se: saved.sKeys.se ?? null, mm: saved.sKeys.mm ?? null };
  if (saved.z?.method) state.z = { ...state.z, ...saved.z };
  state.zFamily = saved.zFamily === 'cispr' || (saved.tab === 'cispr' && saved.zFamily !== 'z') ? 'cispr' : 'z';
  if (saved.cispr?.method) state.cispr = { ...state.cispr, ...saved.cispr };
  if (Array.isArray(saved.cmc?.band) && saved.cmc.band.every(Number.isFinite)) state.cmc = { ...state.cmc, ...saved.cmc };
  if (saved.esb?.model) state.esb = { ...state.esb, ...saved.esb };
  loadFileStates(saved, dataset);
  if (Number.isInteger(saved.pairIn)) state.pairIn = saved.pairIn;
  if (Number.isInteger(saved.pairOut)) state.pairOut = saved.pairOut;
  if (Array.isArray(saved.markers)) {
    state.markers = [0, 1, 2, 3].map(i => Number.isFinite(saved.markers[i]) ? Plot.nearest(dataset.freq, saved.markers[i], true) : (i || saved.markers.every(m => m === null) ? null : state.markers[0]));
  }
  if (saved.axes && typeof saved.axes === 'object') {
    const range = r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1] ? [r[0], r[1]] : null;
    for (const [tab, a] of Object.entries(saved.axes)) {
      if (!hasView(tab) || !a || typeof a !== 'object') continue;
      state.axes[tab] = { ...defaultAxes(tab), ...(a.x === 'log' || a.x === 'linear' ? { x: a.x } : {}), ...(Y_SCALES.includes(a.y) ? { y: a.y } : {}), xRange: range(a.xRange), yRange: range(a.yRange) };
    }
  }
}

export { snapshotSettings, settingsFromEmbedded, resolveSettings, persistSettings, flushSettings, rememberCurrent,
  applySettings };
