// dateien/quellen – Quellen: Ordner, Ziehen und Ablegen, ZIP-Archive.
import { $, toast } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { persistSettings, rememberCurrent } from './einstellungen.js';
import { ingest, newBag } from './import.js';
import { MAX_SESSION, TOUCHSTONE_NAME, ZIP_NAME, dropItems, fileDesc, handleDesc, session, sessionItem } from './sitzung.js';
import { renderSession } from './sitzungsliste.js';

// ---- Sources: folders (picker, drag & drop, fallback input) and ZIP archives. ----
async function addZip(file, bag, prefix = '') {
  try {
    const zip = await Zip.open(file);
    if (zip.entries.some(entry => entry.dir === '' && entry.name === 'spa-backup.json')) { bag.backups.push(file); return; }
    const root = (prefix ? prefix + '/' : '') + file.name.replace(ZIP_NAME, ''), found = [];
    let bytes = 0;
    for (const entry of zip.entries) {
      if (/(^|\/)__MACOSX(\/|$)/.test(entry.raw.replace(/\\/g, '/')) || /^\._|^\.DS_Store$|^Thumbs\.db$/i.test(entry.name)) continue;
      if (!TOUCHSTONE_NAME.test(entry.name)) { bag.unsupported++; continue; }
      bytes += entry.size;
      found.push({ path: root + (entry.dir ? '/' + entry.dir : ''), name: entry.name, size: entry.size, problem: entry.problem, read: entry.read });
    }
    if (bytes > Zip.LIMITS.totalBytes) throw new Error('Das Archiv würde entpackt mehr als 2 GiB belegen und wird nicht geladen.');
    if (!found.length) throw new Error('Das Archiv enthält keine Touchstone- oder SPICE-Dateien.');
    bag.files.push(...found);
    bag.packs.push(file.name);
  } catch (error) {
    bag.errors.push(file.name + ' · ' + error.message);
  }
}

async function walkDirectory(dir, path, bag, depth = 0) {
  for await (const [name, handle] of dir.entries()) {
    if (bag.files.length >= MAX_SESSION) return;
    if (handle.kind === 'file') {
      if (TOUCHSTONE_NAME.test(name)) bag.files.push(handleDesc(handle, path));
    } else if (depth < 8) await walkDirectory(handle, path + '/' + name, bag, depth + 1);
  }
}

async function walkEntry(entry, path, bag, top = false) {
  if (bag.files.length >= MAX_SESSION) return;
  if (entry.isFile) {
    const zip = ZIP_NAME.test(entry.name);
    if (!TOUCHSTONE_NAME.test(entry.name) && !(top && zip)) { if (top) bag.unsupported++; return; }
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    if (zip) await addZip(file, bag, path);
    else bag.files.push(fileDesc(file, path));
    return;
  }
  const reader = entry.createReader(), here = path ? path + '/' + entry.name : entry.name;
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, here, bag);
  }
}

async function expandFiles(files, strict = false) {
  const bag = newBag();
  for (const file of files) {
    const rel = file.webkitRelativePath || '';
    if (ZIP_NAME.test(file.name) && !strict) await addZip(file, bag);
    else if (!strict || TOUCHSTONE_NAME.test(file.name)) bag.files.push(fileDesc(file, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''));
  }
  return bag;
}

async function sourcesFromDrop(transfer) {
  // Handles and entries must be requested synchronously while the drop event is alive.
  const items = [...(transfer.items || [])].filter(item => item.kind === 'file');
  const files = [...transfer.files];
  const entries = items.map(item => item.webkitGetAsEntry?.() ?? null);
  const handles = items.map(item => item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null);
  const bag = newBag();
  try {
    const resolved = await Promise.all(handles);
    if (resolved.length && resolved.every(Boolean)) {
      for (const handle of resolved) {
        if (handle.kind === 'directory') await walkDirectory(handle, handle.name, bag);
        else if (ZIP_NAME.test(handle.name)) await addZip(await handle.getFile(), bag);
        else bag.files.push(handleDesc(handle));
      }
      return bag;
    }
    if (entries.length && entries.every(Boolean)) {
      for (const entry of entries) await walkEntry(entry, '', bag, true);
      return bag;
    }
  } catch (error) {
    toast(error.message);
  }
  return expandFiles(files);
}

async function openFolder(startIn = null) {
  if (!window.showDirectoryPicker) {
    $('folder-input').click();
    return;
  }
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'spa-folder', mode: 'read', ...(startIn ? { startIn } : {}) });
  } catch { return; }
  const bag = newBag();
  try { await walkDirectory(dir, dir.name, bag); } catch (error) { toast(error.message); return; }
  const loose = startIn && sessionItem(session.current);
  if (!loose) { ingest(bag, { kind: 'folder', name: dir.name }); return; }
  // The opened file stays in view; it is replaced by its entry inside the folder.
  await ingest(bag, { kind: 'folder', name: dir.name, open: false });
  const twin = session.items.find(item => item !== loose && item.name === loose.name && item.path === dir.name);
  if (twin && sessionItem(loose.id)) {
    Object.assign(twin, { dataset: loose.dataset, settings: loose.settings, profile: loose.profile });
    session.parsed = session.parsed.map(id => id === loose.id ? twin.id : id);
    session.current = twin.id;
    rememberCurrent(twin);
    await dropItems([loose]);
    persistSettings();
  }
  renderSession();
}

registerActions({
  'open-file': () => { const input = $('file-input'); input.removeAttribute('accept'); input.click(); },
  'open-zip': () => { const input = $('file-input'); input.accept = '.zip,application/zip,application/x-zip-compressed'; input.click(); },
  'open-folder': () => openFolder(),
  'open-siblings': () => openFolder(sessionItem(session.current)?.handle),
});

$('file-input').addEventListener('change', async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) ingest(await expandFiles(files));
});
$('folder-input').addEventListener('change', async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) ingest(await expandFiles(files, true), { kind: 'folder', name: (files[0].webkitRelativePath || '').split('/')[0] });
});

export { addZip, expandFiles, sourcesFromDrop };
