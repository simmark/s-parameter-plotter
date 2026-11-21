  // ---- Import pipeline UI: progress, conflicts and result. A file only counts as saved once the store has verified it. ----
  const fileSize = bytes => bytes == null ? '—' : bytes >= 1073741824 ? (bytes / 1073741824).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + ' GB'
    : bytes >= 1048576 ? (bytes / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + ' MB' : Math.max(bytes ? 1 : 0, Math.round(bytes / 1024)) + ' kB';
  const Progress = (() => {
    const box = () => $('store-dialog');
    let controller = null, timer = null, pending = null, now = null, space = { usage: null, quota: null }, again = null;
    const show = () => { clearTimeout(timer); timer = null; openDialog('store-dialog'); };
    const setState = value => { box().dataset.state = value; };
    function begin(title, subtitle, total) {
      controller = new AbortController();
      now = { total, written: 0, verified: 0, stored: 0, failed: 0, bytes: 0 };
      again = null;
      $('store-title').textContent = title;
      $('store-subtitle').textContent = subtitle;
      box().dataset.result = '';
      footKind = '';
      setState('running');
      paint();
      Store.estimate().then(value => { space = value; if (box().dataset.state === 'running') paint(); });
      clearTimeout(timer);
      if (total > 3) show(); else timer = setTimeout(show, 450);
      return controller.signal;
    }
    function update(p) {
      if (!now) return;
      if (p.phase === 'verify') { now.verified = p.done; now.written = now.total; } else { now.total = p.total; now.verified = 0; now.written = p.done; }
      now.stored = p.stored; now.failed = p.failed; now.bytes = p.bytes;
      paint();
    }
    function stats(percent) {
      return '<div class="store-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><span style="width:' + percent + '%"></span></div>' +
        '<dl class="store-stats">' +
        '<div><dt>Zu speichern</dt><dd class="mono" id="store-total">' + now.total + '</dd></div>' +
        '<div><dt>Gespeichert</dt><dd class="mono" id="store-stored">' + now.stored + '</dd></div>' +
        '<div><dt>Fehlgeschlagen</dt><dd class="mono" id="store-failed-count">' + now.failed + '</dd></div>' +
        '<div><dt>Fortschritt</dt><dd class="mono" id="store-percent">' + percent + ' %</dd></div>' +
        '<div><dt>Datenmenge</dt><dd class="mono">' + esc(fileSize(now.bytes)) + '</dd></div>' +
        '<div><dt>Speicher belegt</dt><dd class="mono">' + esc(space.usage === null ? '—' : fileSize(space.usage) + (space.quota ? ' / ' + fileSize(space.quota) : '')) + '</dd></div></dl>';
    }
    function paint() {
      const percent = now.total ? Math.min(99, Math.round(50 * (now.written + now.verified) / now.total)) : 0;
      insertHtml($('store-content'), stats(percent) + '<p class="note">' + (now.verified || now.written >= now.total ? 'Gespeicherte Dateien werden geprüft …' : 'Dateien werden gelesen und gespeichert …') + '</p>');
      // The button is only replaced when the state changes; a click must never hit a node that was just re-rendered.
      foot('run', actionButton('Abbrechen', 'store-cancel', '', 'button'));
    }
    let footKind = '';
    function foot(kind, html) {
      if (footKind === kind) return;
      footKind = kind;
      insertHtml($('store-foot'), html);
    }
    function askConflict(keys) {
      return new Promise(resolve => {
        pending = resolve;
        setState('conflict');
        insertHtml($('store-content'), '<p class="store-result">' + keys.length + (keys.length === 1 ? ' Datei gibt es' : ' Dateien gibt es') + ' an dieser Stelle schon mit anderem Inhalt.</p>' +
          '<ul class="store-failed">' + keys.slice(0, 8).map(key => '<li class="mono" data-no-i18n>' + esc(key) + '</li>').join('') + '</ul>' +
          (keys.length > 8 ? '<p class="note">+' + (keys.length - 8) + ' weitere</p>' : '') +
          '<p class="note">Überspringen behält die vorhandenen Dateien. Ersetzen tauscht sie aus. Umbenennen legt die neuen Dateien zusätzlich unter neuem Namen ab.</p>');
        foot('conflict', actionButton('Abbrechen', 'store-cancel', '', 'button') + actionButton('Überspringen', 'store-conflict', 'skip', 'button') +
          actionButton('Ersetzen', 'store-conflict', 'replace', 'button') + actionButton('Umbenennen', 'store-conflict', 'rename', 'button primary'));
        show();
      });
    }
    function answer(value) {
      const resolve = pending;
      pending = null;
      if (!resolve) return;
      setState('running');
      paint();
      resolve(value);
    }
    function cancel() {
      controller?.abort();
      if (pending) answer('cancel');
    }
    // summary: { quiet, bad, headline, lines, failed, retry, data }
    function finish({ quiet = false, bad = false, headline = '', lines = [], failed = [], retry = null, data = null } = {}) {
      clearTimeout(timer); timer = null;
      controller = null; pending = null;
      box().dataset.result = data ? JSON.stringify(data) : '';
      if (quiet) {
        setState('idle');
        if (box().open) box().close();
        return;
      }
      again = retry;
      if (now) { now.written = now.verified = now.total; }
      insertHtml($('store-content'), (now ? stats(100) : '') + '<p class="store-result' + (bad ? ' is-bad' : '') + '" id="store-headline">' + esc(headline) + '</p>' +
        lines.map(line => '<p class="note">' + esc(line) + '</p>').join('') +
        (failed.length ? '<p class="note">Nicht gespeichert:</p><ul class="store-failed" id="store-failed-list">' + failed.slice(0, 200).map(item =>
          '<li><span class="mono" data-no-i18n>' + esc(descKey(item)) + '</span> <small>' + esc(item.reason) + '</small></li>').join('') + '</ul>' +
          (failed.length > 200 ? '<p class="note">+' + (failed.length - 200) + ' weitere</p>' : '') : ''));
      footKind = '';
      foot('done', (retry ? actionButton('Erneut versuchen', 'store-retry', '', 'button') : '') + actionButton('Fertig', 'store-close', '', 'button primary'));
      setState(bad ? 'failed' : 'done');
      show();
    }
    function close() {
      setState('idle');
      if (box().open) box().close();
    }
    return { begin, update, askConflict, answer, cancel, finish, close, retry: () => { const run = again; close(); run?.(); }, closable: () => !['running', 'conflict'].includes(box().dataset.state) };
  })();

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const newBag = () => ({ files: [], unsupported: 0, errors: [], packs: [], backups: [] });
  let ingestQueue = Promise.resolve();
  // Imports run one after another: a second import waits instead of interleaving with the first.
  function ingest(bag, options = {}) {
    const run = ingestQueue.then(() => runIngest(bag, options));
    ingestQueue = run.catch(error => { toast(error?.message || String(error)); });
    return run;
  }

  async function runIngest(bag, { name = '', kind = '', open = true } = {}) {
    for (const backup of bag.backups) await backupImport(backup);
    if (!bag.files.length) {
      if (!bag.backups.length) toast(bag.errors[0] || 'Keine Touchstone-Dateien gefunden.');
      return null;
    }
    name ||= bag.packs.length === 1 ? bag.packs[0] : bag.files.length === 1 ? bag.files[0].name : plural(bag.files.length, 'Datei', 'Dateien');
    kind ||= bag.packs.length ? 'zip' : 'files';
    const notes = [...bag.errors];
    const room = Math.max(0, MAX_SESSION - new Set(session.items.map(item => item.entryId ?? item.id)).size);
    let files = bag.files;
    if (files.length > room) {
      notes.push('Eine Sitzung fasst höchstens ' + MAX_SESSION + ' Dateien. ' + (files.length - room) + ' Dateien wurden nicht geladen.');
      files = files.slice(0, room);
      if (!files.length) { Progress.finish({ bad: true, headline: 'Import nicht möglich', lines: notes }); return null; }
    }
    const signal = Progress.begin('Import', name, files.length);
    let result;
    try {
      result = await Store.importBatch({ name, kind, scope: 'session', files, resolveConflict: Progress.askConflict, onProgress: Progress.update, signal });
    } catch (error) {
      Progress.finish({ bad: true, headline: 'Import fehlgeschlagen', lines: [error.message, 'Es wurde nichts übernommen. Bereits gespeicherte Dateien sind unverändert.'], data: { ok: false, added: 0, total: files.length, error: error.code || 'error' } });
      return null;
    }
    if (result.cancelled) {
      Progress.finish({ quiet: true, data: { ok: false, cancelled: true, added: 0, total: files.length } });
      toast('Import abgebrochen. Es wurde nichts übernommen.');
      return null;
    }
    let sources;
    if (result.persisted) {
      const handles = new Map(files.filter(file => file.handle).map(file => [descKey(file), file.handle]));
      sources = result.entries.map(entry => entrySource(entry, handles.get(Store.keyOf(entry)) ?? null));
    } else {
      sources = files.filter(file => !file.problem).map(volatileSource);
      result.failed = files.filter(file => file.problem).map(file => ({ path: file.path, name: file.name, reason: file.problem }));
    }
    const good = result.added + result.identical + result.skipped, data = { ok: result.persisted && !result.failed.length, persisted: result.persisted, total: files.length,
      added: result.added, identical: result.identical, renamed: result.renamed, replaced: result.replaced, skipped: result.skipped, failed: result.failed.length, unsupported: bag.unsupported };
    if (result.identical) notes.unshift(plural(result.identical, 'Datei war', 'Dateien waren') + ' bereits unverändert vorhanden.');
    if (result.renamed) notes.unshift(plural(result.renamed, 'Datei wurde', 'Dateien wurden') + ' unter neuem Namen abgelegt.');
    if (result.replaced) notes.unshift(plural(result.replaced, 'vorhandene Datei wurde', 'vorhandene Dateien wurden') + ' ersetzt.');
    if (result.skipped) notes.unshift(plural(result.skipped, 'Datei wurde', 'Dateien wurden') + ' übersprungen, die vorhandene Fassung bleibt.');
    if (bag.unsupported) notes.push(plural(bag.unsupported, 'nicht unterstützte Datei', 'nicht unterstützte Dateien') + ' im Archiv ausgelassen.');
    const retryable = result.failed.filter(item => Number.isInteger(item.index) && !files[item.index].problem);
    const retry = retryable.length ? () => ingest({ ...newBag(), files: retryable.map(item => files[item.index]) }, { name, kind, open }) : null;
    if (!result.persisted) {
      session.volatile = true;
      Progress.finish({ quiet: !result.failed.length && !bag.errors.length, bad: true, headline: plural(sources.length, 'Datei', 'Dateien') + ' geladen, aber nicht dauerhaft gespeichert', lines: notes, failed: result.failed, data });
      toast('Nicht dauerhaft gespeichert: Dieser Browser erlaubt hier keinen dauerhaften Speicher.');
    } else if (result.failed.length || bag.errors.length || files.length < bag.files.length) {
      Progress.finish({ bad: !good, headline: good + ' von ' + files.length + ' Dateien dauerhaft gespeichert und geprüft', lines: notes, failed: result.failed, retry, data });
    } else {
      Progress.finish({ quiet: true, data });
      if (files.length > 1 || notes.length || bag.unsupported) toast(plural(good, 'Datei', 'Dateien') + ' dauerhaft gespeichert' + (files.length > 1 ? ' · ← / → blättert' : '') + (result.identical ? ' · ' + result.identical + ' bereits vorhanden' : '') +
        (bag.unsupported ? ' · ' + plural(bag.unsupported, 'nicht unterstützte Datei', 'nicht unterstützte Dateien') + ' ausgelassen' : ''));
    }
    renderStorageNotice();
    if (open && sources.length) await openSources(sources);
    else renderSession();
    renderShelf();
    return result;
  }

