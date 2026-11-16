// Pflicht-Regressionstest B: gesamtes ZIP in die Bibliothek übernehmen, Browser vollständig neu starten, alles prüfen.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve, launch, tempDir, makeZip, bigPackage, waitIdle, importResult, sessionKeys, libraryKeys, Report } from './lib.mjs';

const report = new Report('B · Gesamtes ZIP in Bibliothek');
const srv = await serve(), profile = tempDir('spa-b-'), work = tempDir('spa-b-files-');
const files = bigPackage(100), zipPath = path.join(work, 'Messpaket.zip');
fs.writeFileSync(zipPath, makeZip(files));
const expected = files.map(f => 'Messpaket/' + f.name).sort();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const done = page => page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 120000 });
let { context, page, errors } = await launch(profile);
try {
  await page.goto(srv.url);
  await page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
  // 1
  await page.setInputFiles('#file-input', zipPath);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '', null, { timeout: 120000 });
  await waitIdle(page);
  report.check('ZIP mit 100 Dateien importiert', (await importResult(page))?.added === 100);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current);

  // 2–3: "Gesamtes ZIP in Bibliothek übernehmen"
  await page.click('button[data-action="shelf-add"]');
  await page.waitForSelector('#shelf-form');
  const scopes = await page.$$eval('#shelf-scope option', nodes => nodes.map(n => [n.value, n.textContent]));
  report.check('Auswahl bietet: geöffnete Datei, gesamtes ZIP, alle Dateien', ['one', 'pack', 'all'].every(v => scopes.some(s => s[0] === v)), scopes.map(s => s[1]).join(' | '));
  report.equal('„Gesamtes ZIP“ ist vorausgewählt', await page.inputValue('#shelf-scope'), 'pack');
  report.equal('Ordnervorschlag ist der ZIP-Name', await page.inputValue('#shelf-form input[name=folder]'), 'Messpaket');
  await page.click('#shelf-form button[type=submit]');
  await done(page);
  const stored = await importResult(page);
  report.check('Ergebnis: 100 von 100 gespeichert und geprüft', stored?.ok === true && stored.present === 100 && stored.added === 100 && stored.failed === 0, JSON.stringify(stored));
  report.check('Zusammenfassung nennt 100 von 100', /100 von 100/.test(await page.textContent('#store-headline')));
  report.equal('Fortschrittsanzeige: zu speichern / gespeichert / fehlgeschlagen / Prozent', await page.evaluate(() => ['store-total', 'store-stored', 'store-failed-count', 'store-percent'].map(id => document.getElementById(id).textContent)), ['100', '100', '0', '100 %']);
  await page.click('button[data-action="store-close"]');
  report.equal('Bibliothek enthält 100 Dateien (nicht nur die geöffnete)', await libraryKeys(page), expected);

  // only the open file: the count rises by exactly one
  await page.click('button[data-action="shelf-add"]');
  await page.selectOption('#shelf-scope', 'one');
  await page.fill('#shelf-form input[name=folder]', 'Einzeln');
  await page.click('#shelf-form button[type=submit]');
  await done(page);
  await page.click('button[data-action="store-close"]');
  report.equal('„Nur die geöffnete Datei“ legt genau eine Datei ab', (await libraryKeys(page)).length, 101);

  // several selected files
  await page.click('button[data-action="session-select"]');
  for (const i of [3, 4, 5]) await page.locator('.session-pick input').nth(i).check();
  await page.click('button[data-action="shelf-add"]');
  await page.selectOption('#shelf-scope', 'picked');
  await page.fill('#shelf-form input[name=folder]', 'Auswahl');
  await page.click('#shelf-form button[type=submit]');
  await done(page);
  const picked = await importResult(page);
  await page.click('button[data-action="store-close"]');
  report.check('„Ausgewählte Dateien“ legt genau die 3 gewählten ab', picked?.present === 3 && (await libraryKeys(page)).filter(k => k.startsWith('Auswahl/')).length === 3, JSON.stringify(picked));

  // clearing the session must not touch the library
  await page.click('button[data-action="session-clear"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1');
  await page.waitForFunction(async () => (await Store.entries('session')).length === 1);
  report.equal('Sitzung leeren löscht keine Bibliotheksdateien', (await libraryKeys(page)).length, 104);

  // 4–5: close the library, restart the browser completely
  await context.close();
  ({ context, page, errors } = await launch(profile));
  await page.goto(srv.url);
  await page.waitForFunction(() => document.getElementById('shelf').dataset.count === '104', null, { timeout: 30000 });

  // 6–8
  const keys = await libraryKeys(page);
  report.equal('Nach Browser-Neustart: 104 Dateien in der Bibliothek', keys.length, 104);
  report.equal('Nach Browser-Neustart: Unterordner und Dateinamen des ZIPs korrekt', keys.filter(k => k.startsWith('Messpaket/')), expected);
  report.equal('Nach Browser-Neustart: Sitzung mit der zuletzt geöffneten Datei wiederhergestellt', await page.getAttribute('#session-files', 'data-count'), '1');
  const read = await page.evaluate(async () => {
    const out = {};
    for (const e of await Store.entries('library')) {
      const text = new TextDecoder().decode(await (await Store.fileOf(e)).arrayBuffer());
      out[Store.keyOf(e)] = { hash: await Store.hashOf(new TextEncoder().encode(text)), n: RF.parseTouchstone(text, e.name).n };
    }
    return out;
  });
  report.equal('Alle 100 Dateien lesbar und bytegleich mit dem Original', files.filter(f => read['Messpaket/' + f.name]?.hash !== sha(f.data)).length, 0);

  // 9: parse samples in the app and compare the numbers with the originals
  const samples = [0, 17, 42, 63, 99].map(i => files[i]);
  const mismatch = await page.evaluate(async samples => {
    const all = await Store.entries('library');
    let bad = 0;
    for (const s of samples) {
      const e = all.find(x => Store.keyOf(x) === 'Messpaket/' + s.name);
      const a = RF.parseTouchstone(new TextDecoder().decode(await (await Store.fileOf(e)).arrayBuffer()), e.name), b = RF.parseTouchstone(s.data, e.name);
      if (a.n !== b.n || a.freq.length !== b.freq.length || a.freq.some((f, i) => f !== b.freq[i]) || a.samples.some((row, i) => row.some((v, k) => v !== b.samples[i][k]))) bad++;
    }
    return bad;
  }, samples);
  report.equal('Stichprobe: 5 Dateien geparst, Frequenzen und S-Werte identisch', mismatch, 0);

  // tree in the UI: folder opens, sub folder is listed, folder loads into the session
  await page.click('.lib-folder[data-value="Messpaket"]');
  await page.click('.lib-folder[data-value="Messpaket/CMC"]');
  await page.waitForSelector('.lib-folder[data-value="Messpaket/CMC/0805"]', { timeout: 5000 });
  await page.click('.lib-folder[data-value="Messpaket/CMC/0805"]');
  await page.waitForSelector('.lib-row.is-file .session-open[data-key^="Messpaket/CMC/0805/"]', { timeout: 5000 });
  report.check('Verzeichnisbaum klappt Unterordner und Dateien auf', true);
  await page.click('.lib-folder[data-value="Messpaket/CMC"]');
  await page.waitForSelector('.lib-folder[data-value="Messpaket/CMC/0805"]', { state: 'detached', timeout: 5000 });
  report.check('Verzeichnisbaum klappt wieder zu', true);
  await page.fill('#lib-query', 'Größe');
  await page.waitForFunction(() => document.querySelectorAll('.lib-row.is-file').length > 0 && document.querySelectorAll('.lib-row.is-file').length < 30);
  report.check('Suche findet Dateien mit Umlaut im Namen', (await page.$$eval('.lib-row.is-file .session-open', n => n.every(b => /Größe/.test(b.dataset.key)))));
  await page.fill('#lib-query', '');
  await page.selectOption('#lib-ports', '4');
  await page.waitForFunction(() => [...document.querySelectorAll('.lib-row.is-file small')].every(n => n.textContent === '4P') && document.querySelectorAll('.lib-row.is-file').length > 10);
  report.check('Filter nach Portzahl', true);
  await page.selectOption('#lib-ports', '');
  await page.click('button[data-action="lib-open-folder"][data-value="Messpaket/Kondensatoren"]');
  await page.waitForFunction(() => Number(document.getElementById('session-files').dataset.count) === 21, null, { timeout: 60000 });
  report.check('Bibliotheksordner lässt sich in die Sitzung laden', true);

  // deleting from the library must not damage files the session still uses
  const sessionBefore = await sessionKeys(page);
  await page.click('button[data-action="lib-ask"][data-value="folder:Messpaket"]');
  await page.click('button[data-action="lib-delete"][data-value="folder:Messpaket"]');
  await page.waitForFunction(() => document.getElementById('shelf').dataset.count === '4');
  const sessionOk = await page.evaluate(async () => {
    let ok = 0;
    for (const e of await Store.entries('session')) if (!(await Store.verifyContent(e.hash, e.size))) ok++;
    return ok;
  });
  report.equal('Löschen aus der Bibliothek beschädigt keine Sitzungsdateien', sessionOk, sessionBefore.length);
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 400));
  await page.screenshot({ path: path.join(work, 'fail-b.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-b.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
