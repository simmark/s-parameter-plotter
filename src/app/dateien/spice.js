// dateien/spice – SPICE-Bibliotheken: Teilschaltungen als Einträge und Frequenz-Sweep.
import { toast } from '../basis/dom.js';
import { registerForms } from '../basis/erweiterung.js';
import { parseHz } from '../basis/format.js';
import { decodeText } from '../basis/rechnen.js';
import { state } from '../basis/zustand.js';
import { snapshotSettings } from './einstellungen.js';
import { SPICE_NAME, compareCache, openItem, session, sessionItem } from './sitzung.js';

// ---- SPICE libraries: every top-level subcircuit becomes an entry that is simulated on demand. ----
const spiceSweep = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('spa-sweep')) || {}; } catch { saved = {}; }
  return { f1: saved.f1 > 0 ? saved.f1 : 1e4, f2: saved.f2 > saved.f1 ? saved.f2 : 6e9, n: 401 };
};
const spiceStore = () => { try { return JSON.parse(localStorage.getItem('spa-spice')) || {}; } catch { return {}; } };

async function expandModels(sources) {
  const out = [];
  for (const source of sources) {
    if (!SPICE_NAME.test(source.name)) { out.push(source); continue; }
    try {
      const file = await source.getFile();
      if (file.size > 20 * 1024 * 1024) throw new Error('Die Bibliothek überschreitet 20 MiB.');
      const lib = Spice.parse(decodeText(await file.arrayBuffer()), source.name);
      const folder = (source.path ? source.path + '/' : '') + source.name;
      for (const sub of lib.tops) {
        out.push({ name: sub.label, path: folder, size: null, handle: null, ports: sub.pins.length, getFile: source.getFile, make: () => Spice.dataset(lib, sub, spiceSweep()),
          entryId: source.entryId ?? null, importId: source.importId ?? null, pack: source.pack ?? '', volatile: !!source.volatile,
          filePath: source.filePath ?? source.path ?? '', fileName: source.fileName ?? source.name, saved: source.subs?.[sub.label] ?? null });
      }
      if (!lib.tops.length) throw new Error('Keine eigenständigen Subcircuits gefunden.');
    } catch (error) {
      toast(source.name + ' · ' + error.message);
    }
  }
  return out;
}

function applySweep(form) {
  const data = new FormData(form), f1 = parseHz(data.get('start')), f2 = parseHz(data.get('stop'));
  if (!(f1 > 0 && f2 > f1)) {
    toast('Gib einen positiven, aufsteigenden Frequenzbereich ein.');
    return;
  }
  try { localStorage.setItem('spa-sweep', JSON.stringify({ f1, f2 })); } catch { /* not persisted */ }
  const current = sessionItem(session.current);
  if (current && current.dataset === state.dataset) { current.settings = snapshotSettings(); current.profile = state.profile; }
  for (const item of session.items) if (item.make) item.dataset = null;
  compareCache.clear();
  if (current) openItem(current.id);
}


registerForms({
  'sweep-form': applySweep,
});

export { spiceStore, expandModels };
