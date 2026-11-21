  // ---- Library: files the user keeps on purpose. Several libraries, folders and subfolders, search and filters. ----
  const shelf = { libId: Store.MAIN_LIBRARY, form: false, naming: false, confirm: '', edit: '', query: '', ports: '', type: '', sort: 'name', open: new Set(), entries: [], libs: [], job: 0 };
  const libLabel = lib => lib && lib.id === Store.MAIN_LIBRARY && lib.name === 'Bibliothek' ? window.I18N.t('Bibliothek') : lib?.name ?? '';
  const cleanFolder = text => String(text ?? '').split(/[\\/]/).map(part => part.replace(/[:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(part => part && part !== '.' && part !== '..').join('/');
  const sessionFiles = items => new Set(items.map(item => item.entryId ?? item.id)).size;
  const typeOf = item => item.profile?.name || item.settings?.profileName || item.saved?.profileName || '';

  function shelfScopes() {
    const current = sessionItem(session.current), out = [['one', 'Nur die geöffnete Datei']];
    const pack = current?.importId ? session.items.filter(item => item.importId === current.importId) : [];
    const packCount = sessionFiles(pack), all = sessionFiles(session.items);
    if (packCount > 1) out.unshift(['pack', (ZIP_NAME.test(current.pack) ? 'Gesamtes ZIP „' : 'Gesamtes Importpaket „') + current.pack + '“ übernehmen · ' + packCount + ' Dateien']);
    const picked = session.items.filter(item => session.picked.has(item.id));
    if (picked.length) out.push(['picked', sessionFiles(picked) + ' ausgewählte Dateien']);
    if (all > 1) out.push(['all', 'Alle ' + all + ' Dateien der Sitzung'], ['type', 'Alle Dateien nach Bauteiltyp einsortieren']);
    return out;
  }
  function shelfFolder(scope) {
    const current = sessionItem(session.current);
    if (scope === 'pack') return cleanFolder((current?.pack || '').replace(ZIP_NAME, '')) || 'Import';
    if (scope === 'one') return state.profile.name || 'Unsortiert';
    return scope === 'type' ? 'Unsortiert' : '';
  }
  function shelfSuggest(form) {
    const input = form?.elements.folder;
    if (input && !input.dataset.touched) input.value = shelfFolder(form.elements.scope.value);
  }

  async function renderShelf() {
    const box = $('shelf'), job = ++shelf.job;
    if (!Store.persistent()) {
      box.hidden = false;
      insertHtml(box, '<h4>Bibliothek</h4><p class="note" id="shelf-unavailable">Die Bibliothek braucht dauerhaften Browserspeicher. Er ist hier nicht verfügbar; Einzelheiten stehen unter „Speicher &amp; Sicherung“.</p>');
      return;
    }
    let libs, entries;
    try {
      libs = await Store.libraries();
      if (!libs.some(lib => lib.id === shelf.libId)) shelf.libId = libs[0].id;
      entries = await Store.entries('library', shelf.libId);
    } catch (error) {
      if (job !== shelf.job) return;
      box.hidden = false;
      insertHtml(box, '<h4>Bibliothek</h4><p class="inline-notice">Die Bibliothek lässt sich nicht lesen: ' + esc(error.message) + '</p>');
      return;
    }
    if (job !== shelf.job) return;
    shelf.libs = libs; shelf.entries = entries;
    const order = { name: (a, b) => collator.compare(a.name, b.name), new: (a, b) => b.addedAt - a.addedAt || collator.compare(a.name, b.name),
      ports: (a, b) => (a.ports || 0) - (b.ports || 0) || collator.compare(a.name, b.name), size: (a, b) => b.size - a.size || collator.compare(a.name, b.name) }[shelf.sort] ?? ((a, b) => collator.compare(a.name, b.name));
    entries.sort((a, b) => collator.compare(a.path, b.path) || order(a, b));
    box.hidden = false;
    box.dataset.count = String(entries.length);
    const lib = libs.find(item => item.id === shelf.libId);
    const real = !!state.dataset && !state.dataset.demo && !!sessionItem(session.current);
    const scopes = real ? shelfScopes() : [], scope = scopes[0]?.[0] ?? 'one';
    const folders = [...new Set(entries.map(entry => entry.path).filter(Boolean))];
    const form = shelf.form && real ? '<form id="shelf-form" class="shelf-form">' +
      (scopes.length > 1 ? '<label class="control"><span>Umfang</span><select id="shelf-scope" name="scope">' + options(scopes, scope) + '</select></label>' : '<input type="hidden" name="scope" value="one">') +
      '<label class="control"><span class="field-label">Ordner in „' + esc(libLabel(lib)) + '“</span><input class="field-input" name="folder" list="shelf-folders" value="' + esc(shelfFolder(scope)) +
      '" placeholder="z. B. LAN-Übertrager oder CMC/0805" autocomplete="off"></label><datalist id="shelf-folders">' + folders.map(folder => '<option value="' + esc(folder) + '">').join('') + '</datalist>' +
      '<p class="note">Unterordner mit „/“. Bei mehreren Dateien bleibt die Ordnerstruktur des Imports erhalten.</p>' +
      '<div class="shelf-form-actions"><button class="button primary" type="submit">In Bibliothek übernehmen</button>' + actionButton('Abbrechen', 'shelf-cancel', '', 'quiet-button') + '</div></form>' : '';
    const naming = shelf.naming ? '<form id="lib-new-form" class="shelf-form"><label class="control"><span class="field-label">Name der neuen Bibliothek</span>' +
      '<input class="field-input" name="name" maxlength="60" placeholder="z. B. CMC Automotive" autocomplete="off"></label>' +
      '<div class="shelf-form-actions"><button class="button primary" type="submit">Anlegen</button>' + actionButton('Abbrechen', 'lib-new', '', 'quiet-button') + '</div></form>' : '';
    const libKey = 'lib:' + shelf.libId;
    const bar = '<div class="lib-bar"><select id="lib-select" aria-label="Bibliothek wählen">' + options(libs.map(item => [item.id, item.name]), shelf.libId) + '</select>' +
      actionButton('Neu', 'lib-new', '', 'quiet-button', 'plus', ' title="Neue Bibliothek erstellen"') +
      '<button type="button" class="session-compare" data-action="lib-edit" data-value="' + esc(libKey) + '" aria-pressed="' + (shelf.edit === libKey) + '" title="Bibliothek umbenennen" aria-label="Bibliothek ' + esc(libLabel(lib)) + ' umbenennen">✎</button>' +
      (shelf.confirm === libKey
        ? '<button type="button" class="session-compare shelf-confirm" data-action="lib-delete" data-value="' + esc(libKey) + '" title="Wirklich löschen" aria-label="Bibliothek ' + esc(libLabel(lib)) + ' wirklich löschen">!</button>'
        : '<button type="button" class="session-compare" data-action="lib-ask" data-value="' + esc(libKey) + '" title="Bibliothek leeren oder löschen" aria-label="Bibliothek ' + esc(libLabel(lib)) + ' leeren oder löschen"' + disabled(!entries.length && shelf.libId === Store.MAIN_LIBRARY) + '>×</button>') + '</div>' +
      (shelf.edit === libKey ? '<form id="lib-edit-form" class="shelf-form lib-edit"><input type="hidden" name="key" value="' + esc(libKey) + '">' +
        '<label class="control"><span class="field-label">Name der Bibliothek</span><input class="field-input" name="name" maxlength="60" value="' + esc(libLabel(lib)) + '" autocomplete="off"></label>' +
        '<div class="shelf-form-actions"><button class="button primary" type="submit">Speichern</button>' + actionButton('Abbrechen', 'lib-edit', libKey, 'quiet-button') + '</div></form>' : '');
    const portOptions = [...new Set(entries.map(entry => entry.ports).filter(Boolean))].sort((a, b) => a - b);
    const typeOptions = [...new Set(entries.map(entry => entry.type).filter(Boolean))].sort(collator.compare);
    const query = shelf.query.trim().toLowerCase();
    if (shelf.ports && !portOptions.includes(Number(shelf.ports))) shelf.ports = '';
    if (shelf.type && !typeOptions.includes(shelf.type)) shelf.type = '';
    const filtering = !!(query || shelf.ports || shelf.type);
    const shown = entries.filter(entry => (!query || Store.keyOf(entry).toLowerCase().includes(query)) && (!shelf.ports || String(entry.ports) === shelf.ports) && (!shelf.type || entry.type === shelf.type));
    const filters = entries.length > 6 || filtering ? '<div class="lib-filters">' +
      '<input id="lib-query" class="field-input" type="search" placeholder="Bibliothek durchsuchen …" aria-label="Bibliothek durchsuchen" value="' + esc(shelf.query) + '">' +
      '<select id="lib-ports" aria-label="Nach Portzahl filtern">' + options([['', 'Ports'], ...portOptions.map(n => [n, n + 'P'])], shelf.ports) + '</select>' +
      '<select id="lib-type" aria-label="Nach Bauteiltyp filtern">' + options([['', 'Typ'], ...typeOptions.map(name => [name, name])], shelf.type) + '</select>' +
      '<select id="lib-sort" aria-label="Sortierung der Dateien">' + options([['name', 'Sortiert nach Name'], ['new', 'Neueste zuerst'], ['ports', 'Nach Portzahl'], ['size', 'Größte zuerst']], shelf.sort) + '</select></div>' : '';
    const top = box.querySelector('.lib-tree')?.scrollTop ?? null;
    insertHtml(box, '<h4>Bibliothek <small>' + entries.length + '</small><span class="session-tools">' +
      actionButton('In Bibliothek', 'shelf-add', '', 'quiet-button', 'plus', disabled(!real) + ' title="Dateien der Sitzung dauerhaft in die Bibliothek übernehmen"') + '</span></h4>' +
      bar + naming + form + filters +
      (entries.length ? '<div class="lib-tree">' + libraryTree(shown, filtering) + '</div>' + (filtering && !shown.length ? '<p class="note">Kein Treffer.</p>' : '')
        : '<p class="note">Noch leer. „In Bibliothek“ legt Dateien der Sitzung dauerhaft hier ab: einzeln, als ganzes ZIP oder als Auswahl.</p>'));
    const tree = box.querySelector('.lib-tree');
    if (tree && top !== null) tree.scrollTop = top;
    if (shelf.naming) box.querySelector('#lib-new-form input')?.focus({ preventScroll: true });
    const editing = box.querySelector('#lib-edit-form input[name="name"], #lib-edit-form input[name="folder"]');
    if (editing && shelf.editFocus !== shelf.edit) { shelf.editFocus = shelf.edit; editing.focus({ preventScroll: true }); editing.select?.(); }
    if (!shelf.edit) shelf.editFocus = '';
  }

  function libraryTree(entries, expandAll) {
    const files = new Map([['', []]]), totals = new Map();
    for (const entry of entries) {
      const parts = entry.path ? entry.path.split('/') : [];
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join('/');
        totals.set(path, (totals.get(path) || 0) + 1);
        if (!files.has(path)) files.set(path, []);
      }
      files.get(entry.path || '').push(entry);
    }
    const paths = [...files.keys()].filter(Boolean).sort(collator.compare), depthOf = path => path.split('/').length;
    let rows = 0;
    const out = [];
    const remove = (key, label) => shelf.confirm === key
      ? '<button type="button" class="session-compare shelf-confirm" data-action="lib-delete" data-value="' + esc(key) + '" title="Wirklich löschen" aria-label="' + esc(label) + ' wirklich löschen">!</button>'
      : '<button type="button" class="session-compare" data-action="lib-ask" data-value="' + esc(key) + '" title="Aus der Bibliothek löschen" aria-label="' + esc(label) + ' aus der Bibliothek löschen">×</button>';
    const edit = (key, label) => '<button type="button" class="session-compare" data-action="lib-edit" data-value="' + esc(key) + '" aria-pressed="' + (shelf.edit === key) + '" title="Umbenennen oder verschieben" aria-label="' + esc(label) + ' umbenennen oder verschieben">✎</button>';
    const folderList = '<datalist id="lib-folders">' + [...new Set(shelf.entries.map(entry => entry.path).filter(Boolean))].sort(collator.compare).map(folder => '<option value="' + esc(folder) + '">').join('') + '</datalist>';
    const editForm = (key, depth, entry, path) => shelf.edit !== key ? '' : '<form id="lib-edit-form" class="shelf-form lib-edit" style="--depth:' + depth + '"><input type="hidden" name="key" value="' + esc(key) + '">' +
      (entry ? '<label class="control"><span class="field-label">Dateiname</span><input class="field-input" name="name" maxlength="200" value="' + esc(entry.name) + '" autocomplete="off"></label>' : '') +
      '<label class="control"><span class="field-label">' + (entry ? 'Ordner' : 'Ordnerpfad') + '</span><input class="field-input" name="folder" list="lib-folders" value="' + esc(entry ? entry.path : path) + '" placeholder="' + (entry ? 'leer = oberste Ebene' : 'z. B. CMC/0805') + '" autocomplete="off"></label>' + folderList +
      '<p class="note">' + (entry ? 'Die Dateiendung bleibt erhalten. Unterordner mit „/“.' : 'Ein neuer Pfad benennt den Ordner um oder verschiebt ihn samt Inhalt. Ein vorhandener Ordner als Ziel führt beide zusammen.') + '</p>' +
      '<div class="shelf-form-actions"><button class="button primary" type="submit">Speichern</button>' + actionButton('Abbrechen', 'lib-edit', key, 'quiet-button') + '</div></form>';
    const fileRow = (entry, depth) => '<div class="lib-row is-file" style="--depth:' + depth + '"><button type="button" class="session-open" data-action="lib-open-file" data-value="' + esc(entry.id) +
      '" data-key="' + esc(Store.keyOf(entry)) + '" title="In die Sitzung laden und öffnen"><span>' + esc(entry.name) + '</span>' + (entry.ports ? '<small>' + entry.ports + 'P</small>' : '') + '</button>' + edit('file:' + entry.id, entry.name) + remove('file:' + entry.id, entry.name) + '</div>' + editForm('file:' + entry.id, depth, entry);
    function walk(parent, depth) {
      for (const path of paths) {
        if (depthOf(path) !== depth + 1 || (parent && !path.startsWith(parent + '/'))) continue;
        if (++rows > 600) return;
        const open = expandAll || shelf.open.has(path), name = path.slice(parent ? parent.length + 1 : 0);
        out.push('<div class="lib-row" style="--depth:' + depth + '"><button type="button" class="lib-folder" data-action="lib-toggle" data-value="' + esc(path) + '" aria-expanded="' + open + '" title="' + esc(path) + '">' +
          icon('chevron') + '<span>' + esc(name) + '</span><small>' + totals.get(path) + '</small></button>' +
          '<button type="button" class="session-compare" data-action="lib-open-folder" data-value="' + esc(path) + '" title="Ordner in die Sitzung laden und durchblättern" aria-label="Ordner ' + esc(name) + ' in die Sitzung laden">▸</button>' +
          edit('folder:' + path, 'Ordner ' + name) + remove('folder:' + path, 'Ordner ' + name) + '</div>' + editForm('folder:' + path, depth, null, path));
        if (!open) continue;
        walk(path, depth + 1);
        for (const entry of files.get(path)) { if (++rows > 600) return; out.push(fileRow(entry, depth + 1)); }
      }
    }
    walk('', 0);
    for (const entry of files.get('')) { if (++rows > 600) break; out.push(fileRow(entry, 0)); }
    if (rows > 600) out.push('<p class="note">Mehr als 600 Zeilen · Suche oder Filter nutzen</p>');
    return out.join('');
  }

  function commonDir(dirs) {
    if (!dirs.length) return '';
    let parts = dirs[0] ? dirs[0].split('/') : [];
    for (const dir of dirs.slice(1)) {
      const other = dir ? dir.split('/') : [];
      let n = 0;
      while (n < parts.length && n < other.length && parts[n] === other[n]) n++;
      parts = parts.slice(0, n);
    }
    return parts.join('/');
  }

  // Copies session files into the library. Stored files are referenced by their hash, so nothing is written twice,
  // but every file is read back and compared before the library shows it.
  async function shelfStore(form) {
    const data = new FormData(form), scope = data.get('scope') || 'one', folder = cleanFolder(data.get('folder'));
    const current = sessionItem(session.current);
    if (!current) return;
    if (current.dataset === state.dataset) { current.profile = state.profile; current.settings = snapshotSettings(); }
    const items = scope === 'one' ? [current] : scope === 'pack' ? session.items.filter(item => item.importId === current.importId)
      : scope === 'picked' ? session.items.filter(item => session.picked.has(item.id)) : session.items;
    const groups = new Map();
    for (const item of items) {
      const key = item.entryId ?? item.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const lists = [...groups.values()], prefix = commonDir(lists.map(group => group[0].filePath ?? group[0].path ?? ''));
    const files = [];
    for (const group of lists) {
      const item = group[0], type = typeOf(item), dir = item.filePath ?? item.path ?? '';
      const rel = dir.slice(prefix.length).replace(/^\//, '');
      const path = scope === 'one' ? folder || 'Unsortiert' : scope === 'type' ? cleanFolder(type) || folder || 'Unsortiert' : [folder, rel].filter(Boolean).join('/');
      const extra = { type, ports: item.make ? null : item.ports, source: item.pack || '',
        settings: item.make ? null : item.settings, subs: item.make ? Object.fromEntries(group.filter(sub => sub.settings).map(sub => [sub.name, sub.settings])) : null };
      let stored = null;
      try { stored = item.entryId ? await Store.entry(item.entryId) : null; } catch { stored = null; }
      const name = item.fileName ?? item.name;
      files.push(stored ? { path, name, hash: stored.hash, size: stored.size, extra } : { path, name, size: item.size, read: item.getFile, extra });
    }
    shelf.form = false;
    renderShelf();
    await shelfRun(files, shelf.libId);
  }

  async function shelfRun(files, libId) {
    const lib = shelf.libs.find(item => item.id === libId) ?? { name: 'Bibliothek' };
    try { await Store.requestPersist(); } catch { /* best effort */ }
    const signal = Progress.begin('In die Bibliothek übernehmen', libLabel(lib) || lib.name, files.length);
    let result;
    try {
      result = await Store.importBatch({ name: lib.name, kind: 'library', scope: 'library', libId, files, resolveConflict: Progress.askConflict, onProgress: Progress.update, signal });
    } catch (error) {
      Progress.finish({ bad: true, headline: 'Übernahme fehlgeschlagen', lines: [error.message, 'Die Bibliothek ist unverändert.'], data: { ok: false, added: 0, total: files.length, error: error.code || 'error' } });
      return;
    }
    if (result.cancelled) {
      Progress.finish({ quiet: true, data: { ok: false, cancelled: true, added: 0, total: files.length } });
      toast('Übernahme abgebrochen. Die Bibliothek ist unverändert.');
      return;
    }
    // Count what is really in the library now instead of trusting the import result.
    const ids = new Set((await Store.entries('library', libId)).map(entry => entry.id));
    const present = result.entries.filter(entry => ids.has(entry.id)).length, lines = [];
    if (result.identical) lines.push(plural(result.identical, 'Datei war', 'Dateien waren') + ' bereits unverändert vorhanden.');
    if (result.renamed) lines.push(plural(result.renamed, 'Datei wurde', 'Dateien wurden') + ' unter neuem Namen abgelegt.');
    if (result.replaced) lines.push(plural(result.replaced, 'vorhandene Datei wurde', 'vorhandene Dateien wurden') + ' ersetzt.');
    if (result.skipped) lines.push(plural(result.skipped, 'Datei wurde', 'Dateien wurden') + ' übersprungen, die vorhandene Fassung bleibt.');
    lines.push('Kontrolle nach dem Speichern: ' + plural(present, 'Datei ist', 'Dateien sind') + ' in der Bibliothek vorhanden und stimmen mit dem Original überein.');
    const retryable = result.failed.filter(item => Number.isInteger(item.index));
    const ok = !result.failed.length && present === files.length;
    Progress.finish({
      bad: !ok, headline: present + ' von ' + files.length + ' Dateien in der Bibliothek „' + (libLabel(lib) || lib.name) + '“ gespeichert und geprüft', lines, failed: result.failed,
      retry: retryable.length ? () => shelfRun(retryable.map(item => files[item.index]), libId) : null,
      data: { ok, total: files.length, present, added: result.added, identical: result.identical, renamed: result.renamed, replaced: result.replaced, skipped: result.skipped, failed: result.failed.length }
    });
    session.selecting = false;
    session.picked.clear();
    renderSession();
    renderShelf();
  }

  // Library files open in the session; the library itself never changes by browsing it.
  async function libraryOpen(value, folder) {
    const lib = shelf.libs.find(item => item.id === shelf.libId);
    const list = folder ? shelf.entries.filter(entry => entry.path === value || entry.path.startsWith(value + '/')) : shelf.entries.filter(entry => entry.id === value);
    if (!list.length || !lib) return;
    const files = list.map(entry => ({ path: ['Bibliothek', lib.name, entry.path].filter(Boolean).join('/'), name: entry.name, hash: entry.hash, size: entry.size,
      extra: { settings: entry.settings ?? null, subs: entry.subs ?? null, type: entry.type ?? '', ports: entry.ports ?? null, source: lib.name + (folder ? ' / ' + value : '') } }));
    await ingest({ ...newBag(), files }, { name: lib.name + (folder ? ' / ' + value : ''), kind: 'library' });
  }

  async function libraryDelete(value) {
    shelf.confirm = '';
    const [kind, ...rest] = value.split(':'), key = rest.join(':');
    try {
      if (kind === 'lib') {
        await Store.removeLibrary(key);
        toast(key === Store.MAIN_LIBRARY ? 'Bibliothek geleert.' : 'Bibliothek gelöscht.');
      } else {
        const ids = kind === 'file' ? [key] : shelf.entries.filter(entry => entry.path === key || entry.path.startsWith(key + '/')).map(entry => entry.id);
        await Store.removeEntries(ids);
        toast(plural(ids.length, 'Datei', 'Dateien') + ' aus der Bibliothek gelöscht. Die Sitzung bleibt unverändert.');
      }
    } catch (error) { toast(error.message); }
    renderShelf();
  }

  // Renames or moves a file, a folder with everything below it, or renames the library itself.
  async function libraryEdit(form) {
    const data = new FormData(form), value = String(data.get('key') || ''), [kind, ...rest] = value.split(':'), key = rest.join(':');
    try {
      if (kind === 'lib') {
        const lib = await Store.renameLibrary(key, data.get('name'));
        toast('Bibliothek heißt jetzt „' + lib.name + '“.');
      } else if (kind === 'file') {
        const entry = shelf.entries.find(item => item.id === key);
        if (!entry) throw new Error('Die Datei gibt es in der Bibliothek nicht mehr.');
        let name = String(data.get('name') ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!name) throw new Error('Gib einen Dateinamen ein.');
        const ext = (entry.name.match(/\.[^.]+$/) || [''])[0];
        if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name = name.replace(/\.+$/, '') + ext;
        const path = cleanFolder(data.get('folder'));
        const moved = await Store.moveEntries([{ id: entry.id, path, name }]);
        if (moved) { if (path) for (let parts = path.split('/'), i = 1; i <= parts.length; i++) shelf.open.add(parts.slice(0, i).join('/')); toast(path !== entry.path ? '„' + name + '“ nach ' + (path ? '„' + path + '“' : 'oberste Ebene') + ' verschoben.' : 'Datei heißt jetzt „' + name + '“.'); }
      } else {
        const target = cleanFolder(data.get('folder'));
        if (!target) throw new Error('Gib einen Ordnerpfad ein.');
        if (target === key) { shelf.edit = ''; renderShelf(); return; }
        if (target.startsWith(key + '/')) throw new Error('Ein Ordner kann nicht in sich selbst verschoben werden.');
        const list = shelf.entries.filter(entry => entry.path === key || entry.path.startsWith(key + '/'));
        const moved = await Store.moveEntries(list.map(entry => ({ id: entry.id, name: entry.name, path: target + entry.path.slice(key.length) })));
        for (const open of [...shelf.open]) if (open === key || open.startsWith(key + '/')) { shelf.open.delete(open); shelf.open.add(target + open.slice(key.length)); }
        for (let parts = target.split('/'), i = 1; i < parts.length; i++) shelf.open.add(parts.slice(0, i).join('/'));
        toast('Ordner „' + key + '“ heißt jetzt „' + target + '“ · ' + plural(moved, 'Datei', 'Dateien') + ' verschoben.');
      }
      shelf.edit = '';
    } catch (error) { toast(error.message); return; }   // the form stays as typed so the name can be corrected
    renderShelf();
  }

  async function libraryCreate(form) {
    try {
      const lib = await Store.createLibrary(new FormData(form).get('name'));
      shelf.libId = lib.id;
      shelf.naming = false;
      shelf.open.clear();
      toast('Bibliothek „' + lib.name + '“ angelegt.');
    } catch (error) { toast(error.message); }
    renderShelf();
  }

