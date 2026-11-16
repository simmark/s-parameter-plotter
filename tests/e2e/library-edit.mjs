// Bibliothek: Dateien und Ordner umbenennen und verschieben, Bibliothek umbenennen. Inhalte bleiben bytegleich,
// ein belegtes Ziel wird abgelehnt, ohne dass sich etwas ändert, und alles übersteht einen Browser-Neustart.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve, launch, tempDir, makeZip, touchstone, waitIdle, libraryKeys, Report } from './lib.mjs';

const report = new Report('Bibliothek · Umbenennen und Verschieben');
const srv = await serve(), profile = tempDir('spa-le-'), work = tempDir('spa-le-files-');
const files = [
  { name: 'CMC/0805/a.s2p', data: Buffer.from(touchstone(2, 1)) }, { name: 'CMC/0805/b.s2p', data: Buffer.from(touchstone(2, 2)) },
  { name: 'CMC/1206/a.s2p', data: Buffer.from(touchstone(2, 3)) }, { name: 'CMC/1206/tief/c.s4p', data: Buffer.from(touchstone(4, 4)) },
  { name: 'LAN/x.s4p', data: Buffer.from(touchstone(4, 5)) }, { name: 'oben.s1p', data: Buffer.from(touchstone(1, 6)) }
];
const zipPath = path.join(work, 'Paket.zip');
fs.writeFileSync(zipPath, makeZip(files));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const hashes = page => page.evaluate(async () => Object.fromEntries((await Store.entries('library')).map(e => [Store.keyOf(e), e.hash])));
const toastText = page => page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
const edit = async (page, key, fields) => {
  await page.click('button[data-action="lib-edit"][data-value="' + key + '"]');
  await page.waitForSelector('#lib-edit-form');
  for (const [name, value] of Object.entries(fields)) await page.fill('#lib-edit-form input[name=' + name + ']', value);
  await page.click('#lib-edit-form button[type=submit]');
  await page.waitForTimeout(250);
};
const idOf = (page, key) => page.evaluate(async key => (await Store.entries('library')).find(e => Store.keyOf(e) === key)?.id, key);
const cancel = async page => { await page.click('#lib-edit-form [data-action="lib-edit"]'); await page.waitForSelector('#lib-edit-form', { state: 'detached' }); };
let { context, page, errors } = await launch(profile);
try {
  await page.goto(srv.url);
  await page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
  await page.setInputFiles('#file-input', zipPath);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '', null, { timeout: 60000 });
  await waitIdle(page);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current);
  await page.click('button[data-action="shelf-add"]');
  await page.waitForSelector('#shelf-form');
  await page.selectOption('#shelf-scope', 'pack');
  await page.fill('#shelf-form input[name=folder]', '');
  await page.click('#shelf-form button[type=submit]');
  await page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state));
  await page.click('button[data-action="store-close"]');
  const start = await libraryKeys(page);
  report.equal('Ausgangslage: 6 Dateien mit Ordnerstruktur', start, files.map(f => f.name).sort());
  const before = await hashes(page);
  report.check('Inhalte stimmen mit den Quelldateien überein', files.every(f => before[f.name] === sha(f.data)));

  // expand everything so that the rows exist
  for (const folder of ['CMC', 'CMC/0805', 'CMC/1206', 'CMC/1206/tief', 'LAN']) await page.click('button[data-action="lib-toggle"][data-value="' + folder + '"]');
  report.check('Jede Zeile hat einen Knopf zum Umbenennen', await page.$$eval('.lib-tree .lib-row', rows => rows.length > 0 && rows.every(row => row.querySelector('[data-action="lib-edit"]'))));

  // 1 rename a file, extension kept
  let id = await idOf(page, 'CMC/0805/a.s2p');
  await edit(page, 'file:' + id, { name: 'Drossel 744' });
  report.check('Datei umbenannt, Endung ergänzt', (await libraryKeys(page)).includes('CMC/0805/Drossel 744.s2p'), await toastText(page));
  report.equal('Kennung und Inhalt der Datei bleiben', await page.evaluate(async id => { const e = await Store.entry(id); return [Store.keyOf(e), e.hash]; }, id), ['CMC/0805/Drossel 744.s2p', sha(files[0].data)]);

  // 2 move a file to another (new) folder
  id = await idOf(page, 'oben.s1p');
  await edit(page, 'file:' + id, { folder: 'Einzel/Reflexion' });
  report.check('Datei in neuen Unterordner verschoben', (await libraryKeys(page)).includes('Einzel/Reflexion/oben.s1p'));
  report.check('Zielordner ist aufgeklappt und zeigt die Datei', await page.$('.session-open[data-key="Einzel/Reflexion/oben.s1p"]') !== null);

  // 3 conflict: target taken → nothing changes
  id = await idOf(page, 'CMC/0805/b.s2p');
  const pre = await libraryKeys(page);
  await edit(page, 'file:' + id, { name: 'a.s2p', folder: 'CMC/1206' });
  report.check('Belegtes Ziel wird mit Meldung abgelehnt', /schon eine Datei/.test(await toastText(page)), await toastText(page));
  report.equal('Nach der Ablehnung ist die Bibliothek unverändert', await libraryKeys(page), pre);
  report.check('Formular bleibt zur Korrektur offen', await page.$('#lib-edit-form') !== null);
  report.equal('Die Eingabe bleibt zur Korrektur stehen', await page.inputValue('#lib-edit-form input[name=folder]'), 'CMC/1206');
  await cancel(page);
  report.check('Abbrechen schließt das Formular', await page.$('#lib-edit-form') === null);

  // 4 rename a folder with sub folders
  await edit(page, 'folder:CMC/1206', { folder: 'CMC/Bauform 1206' });
  let keys = await libraryKeys(page);
  report.check('Ordner umbenannt, Unterordner ziehen mit', keys.includes('CMC/Bauform 1206/a.s2p') && keys.includes('CMC/Bauform 1206/tief/c.s4p') && !keys.some(k => k.startsWith('CMC/1206/')), keys.join(' | '));
  report.check('Aufgeklappte Ordner bleiben aufgeklappt', await page.$('.session-open[data-key="CMC/Bauform 1206/tief/c.s4p"]') !== null);

  // 5 move folder to another parent
  await edit(page, 'folder:LAN', { folder: 'Übertrager/LAN' });
  keys = await libraryKeys(page);
  report.check('Ordner unter neuen Oberordner verschoben', keys.includes('Übertrager/LAN/x.s4p') && !keys.some(k => k.startsWith('LAN/')));

  // 6 folder into itself is refused
  await edit(page, 'folder:CMC', { folder: 'CMC/innen' });
  report.check('Ordner in sich selbst wird abgelehnt', /in sich selbst/.test(await toastText(page)) && (await libraryKeys(page)).join() === keys.join());
  await cancel(page);

  // 7 merge with conflict is atomic, merge without conflict works
  await edit(page, 'folder:CMC/0805', { folder: 'CMC/Bauform 1206' });   // b.s2p + Drossel 744.s2p → no clash with a.s2p
  keys = await libraryKeys(page);
  report.check('Zusammenführen ohne Namensgleichheit gelingt', keys.includes('CMC/Bauform 1206/b.s2p') && keys.includes('CMC/Bauform 1206/Drossel 744.s2p') && keys.includes('CMC/Bauform 1206/a.s2p'));
  id = await idOf(page, 'CMC/Bauform 1206/b.s2p');
  await edit(page, 'file:' + id, { folder: 'Neu' });
  id = await idOf(page, 'CMC/Bauform 1206/Drossel 744.s2p');
  await edit(page, 'file:' + id, { name: 'b.s2p', folder: 'Alt' });
  id = await idOf(page, 'Einzel/Reflexion/oben.s1p');
  await edit(page, 'file:' + id, { folder: 'Alt' });
  const preMerge = await libraryKeys(page);
  await edit(page, 'folder:Alt', { folder: 'Neu' });
  report.check('Zusammenführen mit Namensgleichheit wird abgelehnt', /schon eine Datei/.test(await toastText(page)));
  report.equal('… und verschiebt dabei keine einzige Datei (alles oder nichts)', await libraryKeys(page), preMerge);
  await cancel(page);

  // 8 invalid names
  id = await idOf(page, 'Neu/b.s2p');
  await edit(page, 'file:' + id, { name: '   ' });
  report.check('Leerer Name wird abgelehnt', /Dateinamen/.test(await toastText(page)));
  await page.fill('#lib-edit-form input[name=name]', '../../etc/passwd');
  await page.fill('#lib-edit-form input[name=folder]', '../..//x/./y');
  await page.click('#lib-edit-form button[type=submit]');
  await page.waitForTimeout(250);
  keys = await libraryKeys(page);
  report.check('Pfadzeichen im Namen werden entschärft, kein Ausbruch aus dem Baum', keys.every(k => !k.startsWith('/') && k.split('/').every(part => part && part !== '..' && part !== '.')) && keys.some(k => k.startsWith('x/y/') && k.endsWith('.s2p')), keys.join(' | '));

  // 9 rename the library, create a second one with the old name is allowed, duplicate refused
  await page.click('.lib-bar button[data-action="lib-edit"]');
  await page.fill('#lib-edit-form input[name=name]', 'Bauteile 2026');
  await page.click('#lib-edit-form button[type=submit]');
  await page.waitForTimeout(250);
  report.equal('Bibliothek umbenannt', await page.$eval('#lib-select', el => el.selectedOptions[0].textContent), 'Bauteile 2026');
  report.equal('Die Dateien bleiben in der umbenannten Bibliothek', (await libraryKeys(page)).length, 6);

  // content untouched by all of it
  const after = await page.evaluate(async () => (await Store.entries('library')).map(e => e.hash).sort());
  report.equal('Alle sechs Inhalte sind bytegleich geblieben', after, files.map(f => sha(f.data)).sort());
  const verify = await page.evaluate(async () => { const out = []; for (const e of await Store.entries('library')) out.push(await Store.verifyContent(e.hash, e.size)); return out.filter(Boolean); });
  report.equal('Rücklesen aller Inhalte ohne Fehler', verify, []);

  // open a moved file
  await page.click('button[data-action="clear-session"]').catch(() => {});
  const finalKeys = await libraryKeys(page);
  const target = finalKeys.find(k => k.endsWith('c.s4p'));
  await page.evaluate(() => { for (const b of document.querySelectorAll('.lib-folder[aria-expanded="false"]')) b.click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { for (const b of document.querySelectorAll('.lib-folder[aria-expanded="false"]')) b.click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { for (const b of document.querySelectorAll('.lib-folder[aria-expanded="false"]')) b.click(); });
  await page.waitForTimeout(200);
  await page.click('.session-open[data-key="' + target + '"]');
  await waitIdle(page);
  await page.waitForFunction(() => /c\.s4p/.test(document.getElementById('session-files').dataset.current || '') || /c\.s4p/.test(document.title + document.body.textContent.slice(0, 4000)), null, { timeout: 15000 });
  report.check('Verschobene Datei lässt sich öffnen und wird als 4-Port gelesen', await page.evaluate(() => /4/.test(document.getElementById('status-bar').textContent)), await page.textContent('#status-bar'));

  // restart
  await context.close();
  ({ context, page, errors } = await launch(profile));
  await page.goto(srv.url);
  await page.waitForFunction(() => document.getElementById('shelf').dataset.count === '6', null, { timeout: 30000 });
  report.equal('Nach Browser-Neustart: gleiche Pfade', await libraryKeys(page), finalKeys);
  report.equal('Nach Browser-Neustart: Name der Bibliothek', await page.$eval('#lib-select', el => el.selectedOptions[0].textContent), 'Bauteile 2026');
  report.equal('Keine Fehler in der Konsole', errors, []);
} catch (error) {
  report.check('Ablauf ohne Ausnahme', false, error.stack);
} finally {
  await context.close().catch(() => {});
  srv.close();
}
process.exit(report.done() ? 0 : 1);
