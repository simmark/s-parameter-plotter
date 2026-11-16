// Pflicht-Regressionstest C: Import während des Speicherns unterbrechen (Reload, Browser-Ende, Abbrechen).
// Erwartung: nichts Halbes wird sichtbar, vorhandene Daten bleiben unverändert, die App meldet den Abbruch.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, bigPackage, touchstone, waitIdle, importResult, sessionKeys, libraryKeys, Report } from './lib.mjs';

const report = new Report('C · Unvollständige Importe');
const srv = await serve(), profile = tempDir('spa-c-'), work = tempDir('spa-c-files-');
const small = Array.from({ length: 10 }, (_, i) => ({ name: 'Basis/Datei_' + i + '.s2p', data: touchstone(2, 500 + i) }));
const smallZip = path.join(work, 'Bestand.zip'), bigZip = path.join(work, 'Gross.zip');
fs.writeFileSync(smallZip, makeZip(small));
fs.writeFileSync(bigZip, makeZip(bigPackage(100)));
const baseline = small.map(f => 'Bestand/' + f.name).sort();
const ready = page => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
const intact = page => page.evaluate(async () => {
  let bad = 0;
  for (const scope of ['session', 'library']) for (const e of await Store.entries(scope)) if (await Store.verifyContent(e.hash, e.size)) bad++;
  return bad;
});
const orphans = page => page.evaluate(async () => {
  await navigator.locks.request('spa-store', () => {}); // the clean-up at start may still be running
  await Store.sweep();
  const used = new Set([...(await Store.entries('session')), ...(await Store.entries('library'))].map(e => e.hash));
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('inhalt');
  let extra = 0;
  for await (const [name] of dir.entries()) if (!used.has(name)) extra++;
  return extra;
});
let { context, page, errors } = await launch(profile);
try {
  await page.goto(srv.url); await ready(page);
  await page.setInputFiles('#file-input', smallZip);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '');
  await waitIdle(page);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current);
  await page.click('button[data-action="shelf-add"]');
  await page.click('#shelf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done');
  await page.click('button[data-action="store-close"]');
  report.equal('Ausgangslage: 10 Dateien in Sitzung und Bibliothek', [(await sessionKeys(page)).length, (await libraryKeys(page)).length], [10, 10]);

  // --- 1: page reload in the middle of writing (file 41 of 100) ---
  await page.evaluate(() => { Store.hooks.afterWrite = i => i === 40 ? (location.reload(), new Promise(() => {})) : null; });
  await page.setInputFiles('#file-input', bigZip);
  await page.waitForSelector('#storage-notice [data-notice]', { timeout: 60000 });
  await ready(page);
  const notice = await page.textContent('#storage-notice [data-notice]');
  report.check('Reload mitten im Schreiben: App meldet den unterbrochenen Import', /Gross\.zip/.test(notice) && /unterbrochen/.test(notice), notice.slice(0, 140));
  report.equal('Reload: Sitzung enthält nur den alten Bestand', await sessionKeys(page), baseline);
  report.equal('Reload: Bibliothek unverändert', (await libraryKeys(page)).length, 10);
  report.equal('Reload: kein Eintrag des abgebrochenen Imports sichtbar', (await sessionKeys(page)).filter(k => k.startsWith('Gross/')).length, 0);
  report.equal('Reload: vorhandene Dateien unbeschädigt', await intact(page), 0);
  report.equal('Reload: Reste des abgebrochenen Imports werden entfernt', await orphans(page), 0);
  await page.click('#storage-notice button[data-action="notice-dismiss"]');
  await page.waitForFunction(async () => (await Store.interrupted()).length === 0);
  report.check('Meldung lässt sich bestätigen', true);

  // --- 2: interruption after everything was written and verified, right before the commit ---
  await page.evaluate(() => { Store.hooks.beforeCommit = () => (location.reload(), new Promise(() => {})); });
  await page.setInputFiles('#file-input', bigZip);
  await page.waitForSelector('#storage-notice [data-notice]', { timeout: 120000 });
  await ready(page);
  report.equal('Abbruch direkt vor dem Abschluss: weiterhin nur der alte Bestand', await sessionKeys(page), baseline);
  report.equal('Abbruch direkt vor dem Abschluss: Reste entfernt', await orphans(page), 0);
  await page.click('#storage-notice button[data-action="notice-dismiss"]');

  // --- 3: the browser ends while the import is running ---
  await page.evaluate(() => { Store.hooks.afterWrite = i => i === 60 ? new Promise(() => {}) : null; });
  await page.setInputFiles('#file-input', bigZip);
  await page.waitForFunction(() => Number(document.getElementById('store-stored')?.textContent) >= 60, null, { timeout: 60000 });
  await context.close();
  ({ context, page, errors } = await launch(profile));
  await page.goto(srv.url); await ready(page);
  await page.waitForSelector('#storage-notice [data-notice]', { timeout: 30000 });
  report.check('Browser-Ende während des Imports: Abbruch wird nach dem Neustart gemeldet', /unterbrochen/.test(await page.textContent('#storage-notice [data-notice]')));
  report.equal('Browser-Ende: Sitzung enthält nur den alten Bestand', await sessionKeys(page), baseline);
  report.equal('Browser-Ende: Bibliothek unverändert und unbeschädigt', [(await libraryKeys(page)).length, await intact(page)], [10, 0]);
  report.equal('Browser-Ende: Reste entfernt', await orphans(page), 0);
  await page.click('#storage-notice button[data-action="notice-dismiss"]');

  // --- 4: the user cancels ---
  await page.evaluate(() => { Store.hooks.afterWrite = () => new Promise(r => setTimeout(r, 25)); });
  await page.setInputFiles('#file-input', bigZip);
  await page.waitForFunction(() => Number(document.getElementById('store-stored')?.textContent) >= 15, null, { timeout: 60000 });
  await page.click('button[data-action="store-cancel"]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'idle');
  report.check('Abbrechen: Ergebnis ist „abgebrochen“', (await importResult(page))?.cancelled === true);
  report.equal('Abbrechen: Sitzung unverändert', await sessionKeys(page), baseline);
  report.equal('Abbrechen: nichts bleibt als unterbrochen zurück, keine Reste', [await page.evaluate(async () => (await Store.interrupted()).length), await orphans(page)], [0, 0]);

  // --- 5: afterwards the same import works completely ---
  await page.evaluate(() => { Store.hooks.afterWrite = null; Store.hooks.beforeCommit = null; });
  await page.setInputFiles('#file-input', bigZip);
  await page.waitForFunction(() => { const r = document.getElementById('store-dialog').dataset.result; return r && JSON.parse(r).added === 100; }, null, { timeout: 120000 });
  report.equal('Danach gelingt derselbe Import vollständig', (await sessionKeys(page)).length, 110);
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 400));
  await page.screenshot({ path: path.join(work, 'fail-c.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-c.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
