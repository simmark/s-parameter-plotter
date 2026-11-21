  // ---- Storage: diagnosis, self test and backup. ----
  async function openStorage() {
    openDialog('storage-dialog');
    const box = $('storage-content');
    if (!box.innerHTML) box.innerHTML = '<p class="note">Speicher wird geprüft …</p>';
    let d;
    try { d = await Store.diagnose(); } catch (error) { box.innerHTML = '<p class="inline-notice">' + esc(error.message) + '</p>'; return; }
    const yes = value => value ? 'Ja' : 'Nein', when = value => value ? new Date(value).toLocaleString(LOCALE) : '—';
    const active = sessionItem(session.current);
    const rows = [
      ['Browser unterstützt OPFS', yes(d.opfs) + (d.opfs && !d.opfsWrite ? ' · Schreiben nur über IndexedDB' : ''), 'opfs'],
      ['Dateiablage', d.backend === 'opfs' ? 'OPFS (privates Dateisystem der App)' : d.backend === 'idb' ? 'IndexedDB' : 'Nur Arbeitsspeicher', 'backend'],
      ['Verwendeter Speicher', d.usage === null ? 'unbekannt' : fileSize(d.usage), 'usage'],
      ['Geschätzter verfügbarer Speicher', d.quota === null || d.usage === null ? 'unbekannt' : fileSize(Math.max(0, d.quota - d.usage)), 'free'],
      ['Persistente Speicherung', d.persisted === true ? 'gewährt' : d.persisted === false ? 'nicht gewährt' : 'unbekannt', 'persisted'],
      ['Gespeicherte Dateien', d.files + ' · ' + fileSize(d.bytes), 'files'],
      ['Bibliotheken', d.libraries + ' · ' + plural(d.libraryFiles, 'Datei', 'Dateien'), 'libraries'],
      ['Aktive Sitzung', plural(d.sessionFiles, 'Datei', 'Dateien') + (active ? ' · geöffnet: ' + active.name : ''), 'session'],
      ['Letzte erfolgreiche Sicherung im Browserspeicher', when(d.lastSaved), 'saved']
    ];
    box.innerHTML = (d.backend === 'memory' ? '<p class="inline-notice">Dauerhafter Speicher ist hier nicht verfügbar' + (d.error ? ': ' + esc(d.error) : '.') + '</p>' : '') +
      '<table class="storage-table"><tbody>' + rows.map(([label, value, key]) => '<tr><th scope="row">' + esc(label) + '</th><td data-storage="' + key + '">' + esc(value) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="storage-actions">' + actionButton('Funktionstest', 'storage-test', '', 'button') +
      (d.persisted === false ? actionButton('Dauerhafte Speicherung anfordern', 'storage-persist', '', 'button') : '') +
      actionButton('Sicherung exportieren', 'backup-export', '', 'button', 'export', disabled(d.backend === 'memory' || !d.files)) +
      actionButton('Sicherung importieren', 'backup-import', '', 'button', 'upload', disabled(d.backend === 'memory')) + '</div>' +
      '<div id="storage-test-result"></div>' +
      '<p class="note">Importierte Dateien liegen im Speicher dieses Browsers auf diesem Gerät. Sie überstehen Neuladen, Neustart und App-Updates. Sie sind aber nicht unzerstörbar: Wer die Browserdaten oder Websitedaten löscht, die App deinstalliert oder im privaten Modus arbeitet, entfernt sie. Ohne gewährte persistente Speicherung darf der Browser sie bei Platzmangel auch selbst bereinigen.</p>' +
      '<p class="note">Die Sicherung ist eine ZIP-Datei mit allen Dateien der Bibliotheken und der Sitzung, ihren Ordnern, Portzuordnungen, Vorlagen und Einstellungen. Bewahre sie außerhalb des Browsers auf. Beim Einspielen wird nichts Vorhandenes überschrieben.</p>';
  }

  async function storageTest() {
    const box = $('storage-test-result');
    box.innerHTML = '<p class="note">Test läuft …</p>';
    let r;
    try { r = await Store.selfTest(); } catch (error) { r = { ok: false, steps: [{ name: 'Funktionstest', ok: false, detail: error.message }] }; }
    box.dataset.ok = String(r.ok);
    box.innerHTML = '<p class="store-result' + (r.ok ? '' : ' is-bad') + '">' + (r.ok ? 'Funktionstest bestanden: Schreiben, Lesen, Vergleichen und Entfernen funktionieren.' : 'Funktionstest fehlgeschlagen.') + '</p>' +
      '<ul class="storage-steps">' + r.steps.map(step => '<li' + (step.ok ? '' : ' class="is-bad"') + '>' + esc(step.name) + (step.detail ? ' <small>' + esc(step.detail) + '</small>' : '') + '</li>').join('') + '</ul>';
  }

  async function backupExport() {
    toast('Sicherung wird erstellt …');
    try {
      const local = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
      const { blob, files, entries } = await Store.exportBackup({ templates: Templates.all(), prefs: Prefs.all(), spice: spiceStore(), sweep: local('spa-sweep') });
      const name = 'S-Parameter-Analyzer-Sicherung-' + new Date().toISOString().slice(0, 10) + '.zip';
      saveBlob(blob, name);
      toast(name + ' gespeichert · ' + plural(entries, 'Eintrag', 'Einträge') + ', ' + plural(files, 'Datei', 'Dateien') + '.');
    } catch (error) {
      toast('Sicherung fehlgeschlagen: ' + error.message);
    }
  }

  async function backupImport(file) {
    let backup;
    try { backup = await Store.readBackup(file); } catch (error) { toast(file.name + ' · ' + error.message); return; }
    if (!backup) { toast(file.name + ' ist keine Sicherung des S-Parameter Analyzers.'); return; }
    if (!Store.persistent()) { toast('Die Sicherung lässt sich nicht einspielen: Dauerhafter Speicher ist hier nicht verfügbar.'); return; }
    const total = backup.manifest.entries.length, signal = Progress.begin('Sicherung einspielen', file.name, total);
    let summary;
    try { summary = await Store.importBackup(backup, { onProgress: Progress.update, signal }); }
    catch (error) { Progress.finish({ bad: true, headline: 'Sicherung nicht eingespielt', lines: [error.message], data: { ok: false } }); return; }
    const lines = [];
    const s = summary.settings;
    if (s && typeof s === 'object') {
      const merged = Templates.merge(s.templates), curves = Prefs.merge(s.prefs);
      if (merged.added) lines.push(plural(merged.added, 'Vorlage', 'Vorlagen') + ' übernommen.');
      if (curves) lines.push(plural(curves, 'Kurvenwahl', 'Kurvenwahlen') + ' übernommen.');
      if (s.spice && typeof s.spice === 'object') {
        const store = { ...s.spice, ...spiceStore() };
        try { localStorage.setItem('spa-spice', JSON.stringify(store)); } catch { /* storage full */ }
      }
    }
    if (summary.identical) lines.unshift(plural(summary.identical, 'Datei war', 'Dateien waren') + ' bereits unverändert vorhanden.');
    if (summary.renamed) lines.unshift(plural(summary.renamed, 'Datei wurde', 'Dateien wurden') + ' unter neuem Namen abgelegt, weil es am selben Ort schon eine andere Fassung gab.');
    Progress.finish({ bad: summary.failed.length > 0 && !summary.added, headline: summary.cancelled ? 'Einspielen abgebrochen' : plural(summary.added, 'Datei', 'Dateien') + ' aus der Sicherung eingespielt und geprüft',
      lines, failed: summary.failed, data: { ok: !summary.failed.length && !summary.cancelled, added: summary.added, identical: summary.identical, renamed: summary.renamed, failed: summary.failed.length } });
    await restoreSession(false);
    renderShelf();
    if ($('storage-dialog').open) openStorage();
  }

