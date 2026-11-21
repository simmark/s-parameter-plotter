// oberflaeche/start – Start der App: Demo, geteilte Dateien, letzte Sitzung wiederherstellen.
import { initDataset } from '../analyse/netzwerk.js';
import { $, mobile } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { state } from '../basis/zustand.js';
import { renderShelf } from '../dateien/bibliothek.js';
import { flushSettings } from '../dateien/einstellungen.js';
import { ingest, newBag, plural } from '../dateien/import.js';
import { addZip } from '../dateien/quellen.js';
import { ZIP_NAME, addItems, blankProfile, configKey, entrySource, handleDesc, importFile, openItem, session } from '../dateien/sitzung.js';
import { renderSession, renderStorageNotice } from '../dateien/sitzungsliste.js';
import { expandModels } from '../dateien/spice.js';

function loadDemo(n) {
  state.importJob++;
  flushSettings();
  session.current = null;
  state.profile = blankProfile();
  $('import-notice').classList.remove('neutral');
  if (mobile.matches) state.collapsed = true;
  initDataset(RF.demoNetwork(n));
  state.profile.key = configKey();
  renderSession();
  renderShelf();
}

// Start order: restore the saved session, then a file shared from Android or opened from the OS, otherwise the demo.
async function receiveSharedFile() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') || !('caches' in window)) return false;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('s-parameter-analyzer:shared');
    const response = await cache.match('shared-file');
    if (!response) return false;
    await cache.delete('shared-file');
    const name = decodeURIComponent(response.headers.get('X-File-Name') || 'Geteilt.snp');
    await importFile(new File([await response.blob()], name));
    return true;
  } catch {
    return false;
  }
}

// Rebuilds the session list from the durable store. Files are read lazily, so 100 and more entries start quickly.
async function restoreSession(open) {
  let entries;
  try { entries = await Store.entries('session'); } catch { return false; }
  if (!entries.length) return false;
  const known = new Set(session.items.map(item => item.entryId));
  const added = addItems(await expandModels(entries.filter(entry => !known.has(entry.id)).map(entry => entrySource(entry))));
  renderSession();
  renderStorageNotice();
  if (!open || !added.length) return true;
  let meta = null;
  try { meta = await Store.getMeta('session'); } catch { meta = null; }
  const target = added.find(item => item.entryId === meta?.entryId && (!meta.sub || item.name === meta.sub)) ?? added.find(item => item.entryId === meta?.entryId) ?? added[0];
  await openItem(target.id);
  return !!state.dataset && session.current === target.id;
}

async function boot() {
  let launched = false;
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files?.length) return;
      launched = true;
      // With "focus-existing" further files opened from the system land in this window and join the list.
      const bag = newBag();
      for (const handle of params.files) {
        if (ZIP_NAME.test(handle.name)) await addZip(await handle.getFile(), bag);
        else bag.files.push(handleDesc(handle));
      }
      ingest(bag);
    });
  }
  await Store.init();
  let broken = [];
  try {
    const moved = await Store.migrate();
    if (moved.shelf) session.notices.push({ id: 'migrated-shelf', neutral: true, text: 'Die bisherige Bibliothek wurde in den neuen Speicher übernommen: ' + plural(moved.shelf, 'Datei', 'Dateien') + ', geprüft.' });
    await Store.recover();
    broken = await Store.interrupted();
  } catch { /* storage problems are shown by the notice and the storage dialog */ }
  for (const item of broken) {
    session.notices.push({ id: item.id, importId: item.id, text: 'Der Import „' + item.name + '“ wurde unterbrochen (' + (item.done || 0) + ' von ' + item.total + ' Dateien verarbeitet). Es wurde nichts davon übernommen; vorhandene Dateien sind unverändert. Bitte erneut importieren.' });
  }
  Store.sweep().catch(() => {});
  Store.trimImports().catch(() => {});
  renderStorageNotice();
  renderShelf();
  const shared = new URLSearchParams(location.search).has('shared');
  let restored = false;
  try { restored = await restoreSession(!shared && !launched); } catch { restored = false; }
  if (await receiveSharedFile()) return;
  if (launched || (restored && state.dataset)) return;
  if (!state.dataset) loadDemo(4);
}

boot();

registerActions({
  demo: value => loadDemo(Number(value)),
});

export { restoreSession };
