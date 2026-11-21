// dateien/sitzung – Sitzung: geöffnete Dateien, Laden, Wechseln und Schließen.
import { initDataset } from '../analyse/netzwerk.js';
import { $, mobile, notice, toast } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { parseFile } from '../basis/rechnen.js';
import { state } from '../basis/zustand.js';
import { renderShelf } from './bibliothek.js';
import { flushSettings, rememberCurrent, resolveSettings, snapshotSettings } from './einstellungen.js';
import { ingest } from './import.js';
import { expandFiles } from './quellen.js';
import { renderSession } from './sitzungsliste.js';
import { expandModels } from './spice.js';
import { Templates } from './vorlagen.js';
import { renderMain, setTab } from '../oberflaeche/rahmen.js';
import { renderSidebar } from '../oberflaeche/seitenleiste.js';

// ---- Session: several files at once, folders and ZIP archives, quick stepping and comparison. ----
const SPICE_NAME = /\.(?:lib|sub|cir|mod|spi|sp)$/i;
const TOUCHSTONE_NAME = /\.(?:s\d+p|ts|snp|lib|sub|cir|mod|spi|sp)$/i, ZIP_NAME = /\.zip$/i;
const MAX_SESSION = 1000, MAX_COMPARE = 6, KEEP_PARSED = 6;
const FILE_COLORS = ['#c4622d', '#3266ce', '#008879', '#8a55b6', '#a26016', '#ca5260'];
const FILE_DASH = [[7, 3], [2, 3], [9, 3, 2, 3], [12, 4], [4, 2], [1, 2]];
const session = { items: [], current: null, seq: 0, filter: '', parsed: [], selecting: false, picked: new Set(), notices: [] };
const compareCache = new Map();
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sessionItem = id => session.items.find(item => item.id === id);
const blankProfile = () => ({ name: '', source: 'default', score: null, matches: [], key: '', blocked: null });
const configKey = () => JSON.stringify(state.config);
// A descriptor is a file on its way into the store: { path, name, size, read() }.
const descKey = desc => (desc.path ? desc.path + '/' : '') + desc.name;
const fileDesc = (file, path = '') => ({ path, name: file.name, size: file.size, read: async () => file });
const handleDesc = (handle, path = '') => ({ path, name: handle.name, size: null, handle, read: () => handle.getFile() });
// Sources feed the session list. Stored ones read from the durable store; volatile ones only live in memory.
const entrySource = (entry, handle = null) => ({
  name: entry.name, path: entry.path, size: entry.size, handle, entryId: entry.id, importId: entry.importId, pack: entry.source || '',
  filePath: entry.path, fileName: entry.name, saved: entry.settings ?? null, subs: entry.subs ?? null, volatile: false,
  getFile: async () => Store.fileOf(await Store.entry(entry.id) ?? entry)
});
const volatileSource = desc => ({
  name: desc.name, path: desc.path, size: desc.size ?? null, handle: desc.handle ?? null, entryId: null, importId: null, pack: '',
  filePath: desc.path, fileName: desc.name, saved: null, subs: null, volatile: true,
  getFile: async () => { const data = await desc.read(); return new File([data], desc.name); }
});

function addItems(sources) {
  const added = [];
  for (const source of sources) {
    const key = (source.path ? source.path + '/' : '') + source.name;
    let item = session.items.find(existing => existing.key === key);
    if (item) {
      Object.assign(item, source, { dataset: null, error: '' });
      compareCache.delete(item.id);
    } else {
      if (session.items.length >= MAX_SESSION) break;
      item = { id: 'f' + (++session.seq), key, ports: Number(source.name.match(/\.s(\d+)p$/i)?.[1]) || null,
        dataset: null, settings: source.saved ?? null, profile: source.saved ? { ...blankProfile(), source: 'local', name: source.saved.profileName || '' } : null, error: '', ...source };
      session.items.push(item);
    }
    added.push(item);
  }
  session.items.sort((a, b) => collator.compare(a.path, b.path) || collator.compare(a.name, b.name));
  return added;
}

function keepParsed(item) {
  session.parsed = [item.id, ...session.parsed.filter(id => id !== item.id)];
  for (const id of session.parsed.slice(KEEP_PARSED)) {
    if (id === session.current || state.compare.ids.includes(id)) continue;
    const old = sessionItem(id);
    if (old) old.dataset = null;
  }
  session.parsed = session.parsed.filter(id => sessionItem(id)?.dataset);
}

async function loadDataset(item) {
  if (!item.dataset && item.make) {
    item.dataset = item.make();
    item.dataset.name = item.name;
    item.ports = item.dataset.n;
    item.error = '';
  }
  if (!item.dataset) {
    const file = await item.getFile();
    if (file.size > 100 * 1024 * 1024) throw new Error('Die Datei überschreitet 100 MiB.');
    item.size = file.size;
    item.dataset = await parseFile(file.name === item.name ? file : new File([file], item.name));
    item.ports = item.dataset.n;
    item.error = '';
  }
  keepParsed(item);
  return item.dataset;
}

async function openItem(id, { keepTab = false } = {}) {
  const item = sessionItem(id);
  if (!item) return;
  const tabBefore = keepTab && state.dataset && !state.dataset.demo ? state.tab : null;
  const job = ++state.importJob;
  flushSettings();
  const previous = sessionItem(session.current);
  if (previous && previous.dataset === state.dataset && state.dataset) {
    previous.settings = snapshotSettings();
    previous.profile = state.profile;
  }
  if (state.collapsed && !mobile.matches) {
    state.collapsed = false;
    renderSidebar();
  }
  notice('import-notice', 'Touchstone-Datei wird gelesen …');
  $('import-notice').classList.add('neutral');
  try {
    const dataset = await loadDataset(item);
    if (job !== state.importJob) return;
    const resolved = await resolveSettings(item, () => job === state.importJob);
    if (job !== state.importJob) return;
    if (mobile.matches) state.collapsed = true;
    session.current = id;
    rememberCurrent(item);
    state.profile = { ...resolved.profile };
    initDataset(dataset, resolved.settings);
    state.profile.key = configKey();
    // Stepping through files keeps the view the user is looking at instead of the tab stored with the file.
    if (tabBefore && state.tab !== tabBefore) setTab(tabBefore);
    if (state.profile.source === 'template') {
      toast('Vorlage „' + state.profile.name + '“ erkannt · ' + Templates.similarity(state.profile.score) + ' % · Ports automatisch zugeordnet');
    } else if (dataset.warnings.length && mobile.matches) toast(dataset.warnings[0]);
    renderSession();
    renderShelf();
  } catch (error) {
    if (job !== state.importJob) return;
    item.error = error.message;
    notice('import-notice', error.message);
    if (session.items.length > 1) toast(item.name + ' · ' + error.message);
    renderSession();
  } finally {
    if (job === state.importJob) $('import-notice').classList.remove('neutral');
  }
}

async function openSources(list, { prefer = null } = {}) {
  const sources = await expandModels(list);
  if (!sources.length) {
    toast('Keine Touchstone-Dateien gefunden.');
    return;
  }
  const added = addItems(sources);
  if (!added.length) return;
  renderSession();
  const fresh = new Set(added);
  await openItem((added.find(item => prefer && item.entryId === prefer) ?? session.items.find(item => fresh.has(item)) ?? added[0]).id);
}

const importFile = async file => file ? ingest(await expandFiles([file])) : undefined;

function stepSession(delta) {
  const index = session.items.findIndex(item => item.id === session.current);
  const next = session.items[index + Number(delta)];
  if (next) openItem(next.id, { keepTab: true });
}

// Removes session files from the list and from the durable session store. Library copies keep their content.
async function dropItems(gone) {
  if (!gone.length) return;
  const drop = new Set(gone);
  session.items = session.items.filter(item => !drop.has(item));
  for (const item of gone) { session.picked.delete(item.id); compareCache.delete(item.id); }
  state.compare.ids = state.compare.ids.filter(id => sessionItem(id));
  const kept = new Set(session.items.map(item => item.entryId).filter(Boolean));
  const ids = [...new Set(gone.map(item => item.entryId).filter(id => id && !kept.has(id)))];
  try { await Store.removeEntries(ids); } catch (error) { toast('Die Sitzung konnte nicht vollständig bereinigt werden: ' + error.message); }
}

async function clearSession() {
  const gone = session.items.filter(item => item.id !== session.current);
  session.filter = '';
  session.selecting = false;
  await dropItems(gone);
  renderSession();
  renderShelf();
  if (state.dataset) renderMain();
}

registerActions({
  'session-open': value => openItem(value, { keepTab: true }),
  'session-step': stepSession,
  'session-clear': clearSession,
});

export { SPICE_NAME, TOUCHSTONE_NAME, ZIP_NAME, MAX_SESSION, MAX_COMPARE, FILE_COLORS, FILE_DASH, session,
  compareCache, collator, sessionItem, blankProfile, configKey, descKey, fileDesc, handleDesc, entrySource,
  volatileSource, addItems, loadDataset, openItem, openSources, importFile, stepSession, dropItems };
