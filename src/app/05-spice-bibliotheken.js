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

  function exportModel(mode) {
    const form = $('model-form');
    if (form) modelApply(form);
    const model = currentElement()?.model;
    if (!model) return;
    const name = state.dataset.name.replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') + '_ESB';
    const file = new File([RF.modelNetlist(model, name)], name + '.lib', { type: 'text/plain' });
    if (mode === 'save') saveBlob(file, file.name);
    else ingest({ ...newBag(), files: [fileDesc(file)] });
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

