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

  function compareLetter(id) {
    const ids = state.compare.ids.filter(other => other !== session.current);
    if (!ids.length) return '';
    if (id === session.current) return 'A';
    const index = ids.indexOf(id);
    return index < 0 ? '' : 'BCDEFGH'[index];
  }

  // Storage notices: no durable storage, interrupted imports, results of the one-time migration.
  function renderStorageNotice() {
    const box = $('storage-notice'), parts = [];
    const real = session.items.length > 0;
    if (!Store.persistent()) {
      parts.push('<p class="inline-notice" id="notice-volatile"><span>' + (Store.info.blocked
        ? 'Die Datenbank wird von einem anderen Tab mit einer älteren Version blockiert. Schließe die anderen Tabs der App und lade neu. Bis dahin wird nichts dauerhaft gespeichert.'
        : 'Dieser Browser erlaubt hier keinen dauerhaften Speicher (z. B. privater Modus). Geladene Dateien gehen beim Neuladen verloren.') + '</span></p>');
    } else if (real && session.items.some(item => item.volatile)) {
      parts.push('<p class="inline-notice" id="notice-volatile"><span>Ein Teil der Dateien ist nicht dauerhaft gespeichert und geht beim Neuladen verloren.</span></p>');
    }
    for (const note of session.notices) {
      parts.push('<p class="inline-notice' + (note.neutral ? ' neutral' : '') + '" data-notice="' + esc(note.id) + '"><span>' + esc(note.text) + '</span>' +
        actionButton('Verstanden', 'notice-dismiss', note.id, 'quiet-button') + '</p>');
    }
    box.hidden = !parts.length;
    insertHtml(box, parts.join(''));
  }

  function dismissNotice(id) {
    const note = session.notices.find(item => item.id === id);
    session.notices = session.notices.filter(item => item.id !== id);
    if (note?.importId) Store.dismissImport(note.importId).catch(() => {});
    renderStorageNotice();
  }

  function renderSession() {
    const items = session.items, box = $('session-files');
    const index = items.findIndex(item => item.id === session.current);
    $('file-nav').hidden = items.length < 2;
    $('file-nav-count').textContent = (index + 1) + '/' + items.length;
    $('file-pager').hidden = items.length < 2;
    $('file-pager-count').textContent = (index + 1) + ' / ' + items.length;
    $('file-pager-name').textContent = items[index]?.name || '';
    document.querySelectorAll('[data-action="session-step"]').forEach(button => {
      button.disabled = button.dataset.value === '-1' ? index <= 0 : index < 0 || index >= items.length - 1;
    });
    const current = items[index];
    const sibling = items.length === 1 && current?.handle && window.showDirectoryPicker;
    box.hidden = !items.length;
    box.dataset.count = String(items.length);
    box.dataset.current = current?.key ?? '';
    if (box.hidden) { box.innerHTML = ''; return; }
    const filter = session.filter.trim().toLowerCase();
    const shown = filter ? items.filter(item => item.key.toLowerCase().includes(filter)) : items;
    const volatile = items.filter(item => item.volatile).length;
    const top = box.querySelector('.session-list')?.scrollTop ?? null;
    let folder = null;
    const rows = shown.slice(0, 300).map(item => {
      const letter = compareLetter(item.id), k = 'BCDEFGH'.indexOf(letter);
      const head = item.path !== folder ? '<div class="session-folder" title="' + esc(item.path) + '">' + esc(item.path || 'Einzelne Dateien') + '</div>' : '';
      folder = item.path;
      return head + '<div class="session-row' + (item.id === session.current ? ' is-current' : '') + (item.error ? ' has-error' : '') + (session.selecting ? ' is-selecting' : '') + '"' +
        (k >= 0 ? ' style="--fc:' + FILE_COLORS[k % FILE_COLORS.length] + '"' : '') + '>' +
        (session.selecting ? '<label class="session-pick" title="Auswählen"><input type="checkbox" value="' + item.id + '" aria-label="' + esc(item.name) + ' auswählen"' + checked(session.picked.has(item.id)) + '></label>' : '') +
        '<button type="button" class="session-open" id="session-' + item.id + '" data-action="session-open" data-value="' + item.id + '" data-key="' + esc(item.key) + '" title="' + esc(item.error || item.key) + '">' +
        '<span>' + esc(item.name) + '</span>' + (item.ports ? '<small>' + item.ports + 'P</small>' : '') + '</button>' +
        '<button type="button" class="session-compare" data-action="session-compare" data-value="' + item.id + '"' + pressed(!!letter) +
        ' title="Im Diagramm vergleichen" aria-label="' + esc(item.name) + ' vergleichen">' + (letter || '+') + '</button></div>';
    }).join('');
    insertHtml(box, '<h4>Aktuelle Sitzung <small>' + items.length + '</small><span class="session-tools">' +
      (items.length > 1 ? iconButton('Vorherige Datei (Bild↑)', 'session-step', -1, 'chevron', ' data-flip' + disabled(index <= 0)) +
        iconButton('Nächste Datei (Bild↓)', 'session-step', 1, 'chevron', disabled(index >= items.length - 1)) +
        actionButton('Stapel', 'batch-open', '', 'quiet-button', '', ' title="Alle Dateien analysieren und Fingerabdrücke lernen"') +
        actionButton(session.selecting ? 'Fertig' : 'Auswählen', 'session-select', '', 'quiet-button', '', ' title="Mehrere Dateien für die Bibliothek auswählen"' + pressed(session.selecting)) +
        actionButton('Leeren', 'session-clear', '', 'quiet-button', '', ' title="Alle anderen Dateien aus der Sitzung entfernen. Die Bibliothek bleibt unverändert."') : '') + '</span></h4>' +
      '<p class="session-state' + (volatile ? ' is-volatile' : '') + '" id="session-state" data-saved="' + (volatile ? '0' : '1') + '">' +
      (volatile ? 'Nur im Arbeitsspeicher · geht beim Neuladen verloren' : 'Dauerhaft gespeichert · bleibt nach dem Neuladen erhalten') + '</p>' +
      (items.length > 8 ? '<input id="session-filter" class="field-input session-filter" type="search" placeholder="Filtern …" aria-label="Dateien filtern" value="' + esc(session.filter) + '">' : '') +
      '<div class="session-list">' + rows + '</div>' +
      (shown.length > 300 ? '<p class="note">+' + (shown.length - 300) + ' weitere · Filter nutzen</p>' : '') +
      (!shown.length ? '<p class="note">Kein Treffer.</p>' : '') +
      (sibling ? actionButton('Nachbardateien aus dem Ordner laden', 'open-siblings', '', 'quiet-button', 'network') : ''));
    // Keep the scroll position of the list; only bring the open file into view inside the list, never scroll the page.
    const list = box.querySelector('.session-list'), row = list?.querySelector('.is-current');
    if (list && top !== null) list.scrollTop = top;
    if (list && row) {
      const a = row.offsetTop - list.offsetTop, b = a + row.offsetHeight;
      if (a < list.scrollTop) list.scrollTop = a;
      else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight;
    }
  }

