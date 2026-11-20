// Speicher: Diagnose und Funktionstest, Sicherung, Migration von Version 1, Betrieb ohne OPFS, ohne IndexedDB und bei vollem Speicher.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, launch, tempDir, makeZip, touchstone, sessionKeys, libraryKeys, Report, until, ROOT } from './lib.mjs';

const report = new Report('Speicher, Sicherung, Migration');
const work = tempDir('spa-st-files-');
const ready = page => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
const imported = page => page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '' && !['running', 'conflict'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 120000 });
const reset = page => page.evaluate(() => { const d = document.getElementById('store-dialog'); d.dataset.result = ''; if (d.open) d.close(); d.dataset.state = 'idle'; });
const pack = (name, n, seed) => { const file = path.join(work, name); fs.writeFileSync(file, makeZip(Array.from({ length: n }, (_, i) => ({ name: 'ordner' + (i % 3) + '/d' + i + '.s' + (i % 2 ? 4 : 2) + 'p', data: touchstone(i % 2 ? 4 : 2, seed + i, 15) })))); return file; };
let open = [];
const start = async (profile, options) => { const s = await launch(profile, options); open.push(s.context); return s; };

try {
  // ---------- 1. diagnosis, self test, backup round trip ----------
  {
    const srv = await serve(), profile = tempDir('spa-st1-');
    const { context, page, errors } = await start(profile);
    await page.goto(srv.url); await ready(page);
    await page.setInputFiles('#file-input', pack('Sicherungspaket.zip', 12, 1000)); await imported(page);
    await page.waitForFunction(() => document.getElementById('session-files').dataset.current);
    // port configuration that has to survive the backup
    await page.fill('#session-filter', 'd1.s4p'); await page.click('.session-open[data-key$="/d1.s4p"]');
    await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));
    await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="cross"]');
    await page.waitForTimeout(800);
    await page.click('button[data-action="shelf-add"]');
    await page.selectOption('#shelf-scope', 'pack');
    await page.click('#shelf-form button[type=submit]');
    await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done');
    await page.click('button[data-action="store-close"]');

    await page.click('#storage-button');
    await page.waitForSelector('#storage-content .storage-table');
    const table = await page.$$eval('#storage-content td[data-storage]', cells => Object.fromEntries(cells.map(c => [c.dataset.storage, c.textContent])));
    report.check('Diagnose: OPFS Ja', /^Ja/.test(table.opfs), table.opfs);
    report.check('Diagnose: verwendeter und verfügbarer Speicher', /\d/.test(table.usage) && /\d/.test(table.free), table.usage + ' · ' + table.free);
    report.check('Diagnose: persistente Speicherung gewährt / nicht gewährt / unbekannt', /^(gewährt|nicht gewährt|unbekannt)$/.test(table.persisted), table.persisted);
    report.check('Diagnose: Anzahl gespeicherter Dateien', /^12 ·/.test(table.files), table.files);
    report.check('Diagnose: Anzahl Bibliotheken', /^1 · 12 Dateien/.test(table.libraries), table.libraries);
    report.check('Diagnose: aktive Sitzung mit geöffneter Datei', /^12 Dateien · geöffnet: d1\.s4p/.test(table.session), table.session);
    report.check('Diagnose: Zeitpunkt der letzten erfolgreichen Sicherung', /\d{4}/.test(table.saved), table.saved);
    report.check('Hinweis: Browserspeicher ist nicht unzerstörbar', /nicht unzerstörbar/.test(await page.textContent('#storage-content')));
    await page.click('button[data-action="storage-test"]');
    await page.waitForFunction(() => document.getElementById('storage-test-result').dataset.ok);
    report.equal('Funktionstest: schreiben, lesen, vergleichen, entfernen', await page.$$eval('#storage-test-result li', n => n.map(li => li.className + li.textContent.replace(/ (OPFS|IndexedDB)$/, ''))), ['IndexedDB öffnen', 'Testdatei schreiben', 'Testdatei lesen und vergleichen', 'Metadaten schreiben', 'Testdatei entfernen']);
    report.equal('Funktionstest hinterlässt keine Testdatei', await page.evaluate(async () => { await navigator.locks.request('spa-store', () => {}); return Store.sweep(); }), 0);

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="backup-export"]')]);
    const backupPath = path.join(work, download.suggestedFilename());
    await download.saveAs(backupPath);
    report.check('Sicherung exportiert', /^S-Parameter-Analyzer-Sicherung-\d{4}-\d\d-\d\d\.zip$/.test(download.suggestedFilename()) && fs.statSync(backupPath).size > 10000, download.suggestedFilename() + ' · ' + fs.statSync(backupPath).size + ' Bytes');
    const expectLib = await libraryKeys(page), expectSession = await sessionKeys(page);
    const expectPairs = await page.evaluate(async () => (await Store.entries('library')).find(e => e.name === 'd1.s4p').settings.config.pairs);
    report.equal('Portzuordnung wurde mit in die Bibliothek übernommen', expectPairs.map(p => [p.p, p.q]), [[0, 2], [1, 3]]);
    report.equal('Keine JavaScript-Fehler (Diagnose)', errors, []);
    await context.close();

    // a completely fresh browser profile gets everything back from the backup file
    const fresh = await start(tempDir('spa-st1b-'));
    await fresh.page.goto(srv.url); await ready(fresh.page);
    report.equal('Frisches Profil ist leer', [(await sessionKeys(fresh.page)).length, (await libraryKeys(fresh.page)).length], [0, 0]);
    await fresh.page.click('#storage-button');
    await fresh.page.waitForSelector('#storage-content .storage-table');
    await fresh.page.setInputFiles('#backup-input', backupPath);
    await fresh.page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 120000 });
    const restored = await fresh.page.evaluate(() => JSON.parse(document.getElementById('store-dialog').dataset.result));
    report.check('Sicherung eingespielt', restored.ok && restored.added === 24 && restored.failed === 0, JSON.stringify(restored));
    report.equal('Bibliothek aus der Sicherung: gleiche Ordner und Dateien', await libraryKeys(fresh.page), expectLib);
    report.equal('Sitzung aus der Sicherung', await sessionKeys(fresh.page), expectSession);
    report.equal('Portzuordnung aus der Sicherung', await fresh.page.evaluate(async () => (await Store.entries('library')).find(e => e.name === 'd1.s4p').settings.config.pairs.map(p => [p.p, p.q])), [[0, 2], [1, 3]]);
    report.equal('Inhalte nach dem Einspielen unbeschädigt', await fresh.page.evaluate(async () => { let bad = 0; for (const s of ['session', 'library']) for (const e of await Store.entries(s)) if (await Store.verifyContent(e.hash, e.size)) bad++; return bad; }), 0);
    await fresh.page.click('button[data-action="store-close"]');
    // importing the same backup twice changes nothing
    await reset(fresh.page);
    await fresh.page.setInputFiles('#backup-input', backupPath);
    await fresh.page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 120000 });
    report.equal('Sicherung doppelt eingespielt: keine Duplikate', [(await libraryKeys(fresh.page)).length, (await sessionKeys(fresh.page)).length], [12, 12]);
    // a damaged backup is refused as a whole file or per entry, never silently
    const broken = fs.readFileSync(backupPath); broken[Math.floor(broken.length * 0.6)] ^= 0xff; broken[Math.floor(broken.length * 0.6) + 1] ^= 0xff;
    const brokenPath = path.join(work, 'defekt.zip'); fs.writeFileSync(brokenPath, broken);
    await fresh.page.click('button[data-action="store-close"]'); await reset(fresh.page);
    await fresh.page.evaluate(async () => { await Store.removeLibrary('lib-main'); });
    await fresh.page.setInputFiles('#backup-input', brokenPath);
    await fresh.page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state) || document.getElementById('toast').textContent.includes('defekt.zip'), null, { timeout: 120000 });
    const damaged = await fresh.page.evaluate(() => ({ r: document.getElementById('store-dialog').dataset.result, t: document.getElementById('toast').textContent }));
    report.check('Beschädigte Sicherung: Schaden wird gemeldet, keine defekte Datei übernommen', (damaged.r && JSON.parse(damaged.r).failed >= 1) || /defekt\.zip/.test(damaged.t), (damaged.r || damaged.t).slice(0, 160));
    report.equal('Nach beschädigter Sicherung: alle vorhandenen Inhalte unbeschädigt', await fresh.page.evaluate(async () => { let bad = 0; for (const s of ['session', 'library']) for (const e of await Store.entries(s)) if (await Store.verifyContent(e.hash, e.size)) bad++; return bad; }), 0);
    report.equal('Keine JavaScript-Fehler (Sicherung)', fresh.errors, []);
    await fresh.context.close(); await srv.close();
  }

  // ---------- 2. update from the published version 1 (branch main): library and "last files" migrate ----------
  {
    const oldRoot = tempDir('spa-old-');
    let haveOld = true;
    try {
      for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png', 'icons/apple-180.png']) {
        fs.mkdirSync(path.dirname(path.join(oldRoot, f)), { recursive: true });
        fs.writeFileSync(path.join(oldRoot, f), execFileSync('git', ['-C', ROOT, 'show', (process.env.SPA_OLD_REF || '5384472') + ':' + f], { maxBuffer: 64 * 1024 * 1024 }));
      }
    } catch { haveOld = false; }
    if (!haveOld) report.check('Migration: alte Version 7 aus Git lesbar (5384472)', false, 'git show fehlgeschlagen – Test übersprungen');
    else {
      const srv = await serve(oldRoot), profile = tempDir('spa-st2-');
      let { context, page } = await start(profile);
      await page.goto(srv.url); await ready(page);
      // passed as buffers: a headless Chrome with a C locale cannot read non-ASCII file names from disk
      await page.setInputFiles('#file-input', [{ name: 'Übertrager_A.s4p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(4, 2001)) }, { name: 'Drossel_B.s2p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(2, 2002)) }]);
      await page.waitForFunction(() => /Ports/.test(document.getElementById('status-bar').textContent) && document.querySelectorAll('.session-open').length === 2);
      await page.click('.session-open:has-text("Übertrager_A.s4p")');
      await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));
      await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="cross"]');
      await page.waitForTimeout(1200);
      await page.click('button[data-action="shelf-add"]');
      await page.selectOption('#control-scope', 'all');
      await page.fill('#shelf-form input[name=folder]', 'LAN-Übertrager');
      await page.click('#shelf-form button[type=submit]');
      await page.waitForFunction(() => /in der Bibliothek abgelegt/.test(document.getElementById('toast').textContent));
      // The reported defect, reproduced on the published version: "Alle 2 Dateien" stores only the open one,
      // because the scope <select> has no name attribute and never reaches the form data.
      report.check('Version 1 zeigt den gemeldeten Fehler: „Alle 2 Dateien“ legt nur die geöffnete ab', /^1 Datei in der Bibliothek abgelegt/.test(await page.textContent('#toast')), await page.textContent('#toast'));
      await page.click('.session-open:has-text("Drossel_B.s2p")');
      await page.waitForFunction(() => /2 Ports/.test(document.getElementById('status-bar').textContent));
      await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
      await page.click('button[data-action="shelf-add"]');
      await page.fill('#shelf-form input[name=folder]', 'LAN-Übertrager');
      await page.click('#shelf-form button[type=submit]');
      await page.waitForFunction(() => /in der Bibliothek abgelegt/.test(document.getElementById('toast').textContent));
      const oldState = await page.evaluate(async () => {
        const db = await new Promise(r => { const q = indexedDB.open('s-parameter-analyzer'); q.onsuccess = () => r(q.result); });
        const files = await new Promise(r => { const q = db.transaction('files').objectStore('files').getAll(); q.onsuccess = () => r(q.result); });
        db.close();
        return { version: db.version, recent: files.map(f => f.name).sort(), pairs: files.find(f => f.name.endsWith('.s4p'))?.settings?.config?.pairs?.map(p => [p.p, p.q]) };
      });
      report.equal('Version 1 hat Daten angelegt (Zuletzt geöffnet + Bibliothek)', oldState, { version: 1, recent: ['Drossel_B.s2p', 'Übertrager_A.s4p'], pairs: [[0, 2], [1, 3]] });
      await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
      await context.close();

      srv.setRoot(ROOT); // the new version is deployed on the same address
      ({ context, page } = await start(profile));
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(srv.url);
      // the installed service worker still shows the old page first; the update arrives and offers a reload
      await page.waitForFunction(() => document.getElementById('license-dialog') || !document.getElementById('update-banner').hidden, null, { timeout: 30000 });
      const viaBanner = !(await page.evaluate(() => !!document.getElementById('license-dialog')));
      if (viaBanner) { await page.click('#update-reload'); }
      await page.waitForSelector('#license-dialog', { state: 'attached', timeout: 30000 });
      await ready(page);
      report.check('Update von Version 1: neue Version wird über den Service Worker geladen', true, viaBanner ? 'über „Neue Version verfügbar · Neu laden“' : 'direkt');
      await until(page, async () => (await Store.entries('library')).length === 2);
      report.equal('Migration: alte Bibliothek vollständig übernommen', await libraryKeys(page), ['LAN-Übertrager/Drossel_B.s2p', 'LAN-Übertrager/Übertrager_A.s4p']);
      report.equal('Migration: „Zuletzt geöffnet“ ist jetzt die Sitzung', await sessionKeys(page), ['Drossel_B.s2p', 'Übertrager_A.s4p']);
      await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Drossel_B.s2p', null, { timeout: 20000 });
      report.check('Migration: zuletzt geöffnete Datei ist wieder offen', true);
      await page.click('.session-open[data-key="Übertrager_A.s4p"]');
      await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));
      await page.click('#tab-ports');
      report.equal('Migration: gespeicherte Portzuordnung bleibt erhalten', await page.locator('[data-action="swap-pair"]').count(), 2);
      report.check('Migration: Hinweis für den Anwender', /bisherige Bibliothek wurde in den neuen Speicher übernommen: 2 Dateien/.test(await page.textContent('#storage-notice')));
      const after = await page.evaluate(async () => {
        let oldDir = true;
        try { await (await navigator.storage.getDirectory()).getDirectoryHandle('bibliothek'); } catch { oldDir = false; }
        const db = await new Promise(r => { const q = indexedDB.open('s-parameter-analyzer'); q.onsuccess = () => r(q.result); });
        const n = await new Promise(r => { const q = db.transaction('files').objectStore('files').count(); q.onsuccess = () => r(q.result); });
        db.close();
        let bad = 0;
        for (const s of ['session', 'library']) for (const e of await Store.entries(s)) if (await Store.verifyContent(e.hash, e.size)) bad++;
        return { oldDir, oldRecent: n, bad };
      });
      report.equal('Migration: alter Ordner erst nach Prüfung entfernt, alter Datensatz bleibt als Rückfall, Inhalte geprüft', after, { oldDir: false, oldRecent: 2, bad: 0 });
      await page.reload(); await ready(page);
      report.equal('Migration läuft nur einmal: nach erneutem Laden keine Duplikate', [(await libraryKeys(page)).length, (await sessionKeys(page)).length], [2, 2]);
      report.equal('Keine JavaScript-Fehler (Migration)', errors, []);
      await context.close(); await srv.close();
    }
  }

  // ---------- 3. browser without OPFS: IndexedDB keeps the files ----------
  {
    const srv = await serve(), profile = tempDir('spa-st3-');
    const { context, page, errors } = await start(profile);
    await context.addInitScript(() => { Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true }); });
    await page.goto(srv.url); await ready(page);
    await page.setInputFiles('#file-input', pack('OhneOpfs.zip', 20, 3000)); await imported(page);
    const d = await page.evaluate(() => Store.diagnose());
    report.equal('Ohne OPFS: Ablage in IndexedDB', [d.opfs, d.backend, d.sessionFiles], [false, 'idb', 20]);
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '20', null, { timeout: 30000 });
    report.equal('Ohne OPFS: nach F5 alle 20 Dateien vorhanden und unbeschädigt', await page.evaluate(async () => { let bad = 0; const list = await Store.entries('session'); for (const e of list) if (await Store.verifyContent(e.hash, e.size)) bad++; return [list.length, bad]; }), [20, 0]);
    await page.click('#storage-button');
    await page.waitForSelector('#storage-content .storage-table');
    report.check('Ohne OPFS: Diagnose sagt es verständlich', /^Nein/.test(await page.textContent('td[data-storage="opfs"]')) && /IndexedDB/.test(await page.textContent('td[data-storage="backend"]')));
    report.equal('Keine JavaScript-Fehler (ohne OPFS)', errors, []);
    await context.close(); await srv.close();
  }

  // ---------- 4. no durable storage at all (e.g. private mode): the app says so and never claims "saved" ----------
  {
    const srv = await serve(), profile = tempDir('spa-st4-');
    const { context, page, errors } = await start(profile);
    await context.addInitScript(() => {
      Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });
      indexedDB.open = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    });
    await page.goto(srv.url); await ready(page);
    report.check('Ohne Speicher: Hinweis schon beim Start', /keinen dauerhaften Speicher/.test(await page.textContent('#storage-notice')));
    report.check('Ohne Speicher: Bibliothek erklärt, warum sie fehlt', await page.locator('#shelf-unavailable').count() === 1);
    await page.setInputFiles('#file-input', pack('Fluechtig.zip', 8, 4000)); await imported(page);
    const r = await page.evaluate(() => JSON.parse(document.getElementById('store-dialog').dataset.result));
    report.check('Ohne Speicher: Import wird nicht als gespeichert gemeldet', r.persisted === false && r.ok === false, JSON.stringify(r));
    await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '8');
    report.equal('Ohne Speicher: Dateien sind benutzbar, Liste sagt „nur im Arbeitsspeicher“', [await page.getAttribute('#session-state', 'data-saved'), /Nur im Arbeitsspeicher/.test(await page.textContent('#session-state'))], ['0', true]);
    report.check('Ohne Speicher: Toast nennt das Problem', /Nicht dauerhaft gespeichert/.test(await page.textContent('#toast')));
    await page.click('#storage-button');
    await page.waitForSelector('#storage-content .storage-table');
    report.check('Ohne Speicher: Diagnose nennt die Ursache', /Nur Arbeitsspeicher/.test(await page.textContent('td[data-storage="backend"]')) && /insecure/.test(await page.textContent('#storage-content .inline-notice')));
    await page.click('button[data-action="storage-test"]');
    await page.waitForFunction(() => document.getElementById('storage-test-result').dataset.ok);
    report.equal('Ohne Speicher: Funktionstest schlägt verständlich fehl', await page.getAttribute('#storage-test-result', 'data-ok'), 'false');
    report.equal('Keine JavaScript-Fehler (ohne Speicher)', errors, []);
    await context.close(); await srv.close();
  }

  // ---------- 5. storage full ----------
  {
    const srv = await serve(), profile = tempDir('spa-st5-');
    const { context, page, errors } = await start(profile);
    await page.goto(srv.url); await ready(page);
    await page.setInputFiles('#file-input', pack('Vorher.zip', 5, 5000)); await imported(page);
    const before = await sessionKeys(page);
    // a) the browser reports too little free space before the import starts
    await page.evaluate(() => { navigator.storage.estimate = async () => ({ usage: 1000, quota: 2000 }); });
    await reset(page);
    await page.setInputFiles('#file-input', pack('ZuGross.zip', 10, 5100));
    await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'failed', null, { timeout: 60000 });
    report.check('Platzmangel vor dem Import: verständliche Meldung, nichts übernommen', /Speicherplatz des Browsers reicht für diesen Import nicht aus/.test(await page.textContent('#store-content')) && (await sessionKeys(page)).length === before.length, (await page.textContent('#store-headline')));
    await page.click('button[data-action="store-close"]');
    // b) the disk runs full while writing: from the 5th file on every write fails
    await page.evaluate(() => {
      navigator.storage.estimate = async () => ({ usage: 1000, quota: 1e12 });
      let n = 0; const real = FileSystemFileHandle.prototype.createWritable;
      window.__restore = () => { FileSystemFileHandle.prototype.createWritable = real; };
      FileSystemFileHandle.prototype.createWritable = function (...a) { if (++n > 4) return Promise.reject(new DOMException('Quota exceeded.', 'QuotaExceededError')); return real.apply(this, a); };
    });
    await reset(page);
    await page.setInputFiles('#file-input', pack('Voll.zip', 10, 5200));
    await page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 60000 });
    const full = await page.evaluate(() => JSON.parse(document.getElementById('store-dialog').dataset.result));
    report.check('Speicher läuft während des Imports voll: 4 gespeichert, 6 als fehlgeschlagen gelistet, nicht als Erfolg gemeldet', full.ok === false && full.added === 4 && full.failed === 6 && /4 von 10/.test(await page.textContent('#store-headline')), JSON.stringify(full));
    report.equal('Fehlgeschlagene Dateien sind einzeln aufgelistet', await page.locator('#store-failed-list li').count(), 6);
    report.check('Grund ist verständlich', /Speicherplatz des Browsers reicht nicht aus/.test(await page.textContent('#store-failed-list')));
    report.equal('Nur wirklich gespeicherte Dateien sind in der Sitzung', (await sessionKeys(page)).filter(k => k.startsWith('Voll/')).length, 4);
    // "Erneut versuchen" after space was freed
    await page.evaluate(() => { window.__restore(); document.getElementById('store-dialog').dataset.result = ''; });
    await page.click('button[data-action="store-retry"]');
    await imported(page);
    report.equal('„Erneut versuchen“ speichert die fehlenden 6 Dateien nach', (await sessionKeys(page)).filter(k => k.startsWith('Voll/')).length, 10);
    report.equal('Bestand von vorher unverändert und alles unbeschädigt', [(await sessionKeys(page)).filter(k => k.startsWith('Vorher/')).length, await page.evaluate(async () => { let bad = 0; for (const e of await Store.entries('session')) if (await Store.verifyContent(e.hash, e.size)) bad++; return bad; })], [5, 0]);
    report.equal('Keine JavaScript-Fehler (voller Speicher)', errors, []);
    await context.close(); await srv.close();
  }
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 600));
  for (const c of open) for (const p of c.pages?.() ?? []) await p.screenshot({ path: path.join(work, 'fail-storage.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-storage.png'));
}
for (const c of open) await c.close().catch(() => {});
process.exit(report.done() ? 0 : 1);
