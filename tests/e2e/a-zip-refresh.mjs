// Pflicht-Regressionstest A: ZIP mit 100 Dateien importieren, Einstellungen ändern, F5 – alles muss wieder da sein.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, bigPackage, waitIdle, importResult, sessionKeys, Report } from './lib.mjs';

const report = new Report('A · ZIP und Refresh');
const srv = await serve(), profile = tempDir('spa-a-'), work = tempDir('spa-a-files-');
const files = bigPackage(100), zipPath = path.join(work, 'Messpaket.zip');
fs.writeFileSync(zipPath, makeZip(files));
const expected = files.map(f => 'Messpaket/' + f.name).sort();
const { context, page, errors } = await launch(profile);
try {
  await page.goto(srv.url);
  await page.waitForSelector('#session-files', { state: 'attached' });
  await page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);

  // 1–3: import through the real file input and wait for the reported result
  await page.setInputFiles('#file-input', zipPath);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '' , null, { timeout: 120000 });
  await waitIdle(page);
  const result = await importResult(page);
  report.check('Import als erfolgreich gemeldet', result?.ok === true && result.added === 100 && result.failed === 0, JSON.stringify(result));
  report.check('Sitzung als dauerhaft gespeichert gekennzeichnet', await page.getAttribute('#session-state', 'data-saved') === '1');

  // 4: count and paths
  report.equal('100 Dateien mit unveränderten Pfaden im Speicher', await sessionKeys(page), expected);
  report.equal('Dateiliste zeigt 100 Einträge', await page.getAttribute('#session-files', 'data-count'), '100');
  report.check('Gleiche Dateinamen in verschiedenen Ordnern bleiben getrennt', expected.filter(k => k.endsWith('/Messung.s1p')).length >= 2);

  // 5: a file from the middle (4 ports)
  const target = expected.filter(k => /\.s4p$/.test(k))[20];
  await page.fill('#session-filter', path.basename(target));
  await page.click('.session-open[data-key="' + target + '"]');
  await page.waitForFunction(key => document.getElementById('session-files').dataset.current === key, target);
  await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));

  // 6: change port configuration and diagram
  await page.click('#tab-ports');
  await page.click('button[data-action="pair-preset"][data-value="cross"]');
  await page.waitForFunction(() => !document.querySelector('#status-bar .status-dot.warn'));
  await page.click('#tab-z');
  await page.selectOption('#control-z-format', 're');
  await page.fill('#marker-0', '42 MHz');
  await page.press('#marker-0', 'Enter');
  await page.waitForTimeout(900); // settings are written 300 ms after the last change
  const before = await page.evaluate(async key => {
    const entry = (await Store.entries('session')).find(e => Store.keyOf(e) === key);
    return { settings: entry.settings, marker: document.getElementById('marker-0').value, tab: document.querySelector('[role=tab][aria-selected=true]').id, format: document.getElementById('control-z-format').value };
  }, target);
  report.check('Geänderte Einstellungen stehen im Speicher', before.settings?.tab === 'z' && before.settings.config.pairs.length === 2 && before.settings.z.format === 're', JSON.stringify(before.settings?.config?.pairs));
  report.equal('Paarzuordnung gekreuzt (1,3)(2,4)', before.settings.config.pairs.map(p => [p.p, p.q]), [[0, 2], [1, 3]]);

  // 7: F5
  await page.reload();
  await page.waitForFunction(key => document.getElementById('session-files').dataset.current === key, target, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.id === 'tab-z' && document.getElementById('control-z-format'));
  await page.waitForFunction(() => !document.querySelector('#status-bar .status-dot.warn'));

  // 8–10
  report.equal('Nach F5: alle 100 Dateien vorhanden', await sessionKeys(page), expected);
  report.equal('Nach F5: Liste zeigt 100 Einträge', await page.getAttribute('#session-files', 'data-count'), '100');
  report.equal('Nach F5: vorherige Datei wieder geöffnet', await page.getAttribute('#session-files', 'data-current'), target);
  const after = await page.evaluate(async key => {
    const entry = (await Store.entries('session')).find(e => Store.keyOf(e) === key);
    return { settings: entry.settings, marker: document.getElementById('marker-0').value, tab: document.querySelector('[role=tab][aria-selected=true]').id, format: document.getElementById('control-z-format').value };
  }, target);
  report.equal('Nach F5: Tab wiederhergestellt', after.tab, 'tab-z');
  report.equal('Nach F5: Darstellung wiederhergestellt', after.format, 're');
  report.equal('Nach F5: Marker wiederhergestellt', after.marker, before.marker);
  report.equal('Nach F5: Portzuordnung wiederhergestellt', after.settings.config, before.settings.config);
  await page.click('#tab-ports');
  report.check('Nach F5: Ports-Ansicht zeigt zwei Paare', await page.locator('[data-action="swap-pair"]').count() === 2);

  // every file still opens without the ZIP: read all 100 from the store and compare with the originals
  const hashes = await page.evaluate(async () => {
    const out = {};
    for (const e of await Store.entries('session')) out[Store.keyOf(e)] = await Store.hashOf(new Uint8Array(await (await Store.fileOf(e)).arrayBuffer()));
    return out;
  });
  const crypto = await import('node:crypto');
  const wrong = files.filter(f => hashes['Messpaket/' + f.name] !== crypto.createHash('sha256').update(f.data).digest('hex'));
  report.equal('Alle 100 gespeicherten Inhalte sind bytegleich mit den Originalen', wrong.length, 0);
  // open another file through the UI after the reload
  const other = expected.find(k => /\.s2p$/.test(k));
  await page.fill('#session-filter', path.basename(other));
  await page.click('.session-open[data-key="' + other + '"]');
  await page.waitForFunction(() => /2 Ports/.test(document.getElementById('status-bar').textContent));
  report.check('Weitere Datei lässt sich ohne ZIP öffnen', true);

  // repeated import of the same ZIP: nothing is stored twice
  await page.setInputFiles('#file-input', zipPath);
  await page.waitForFunction(() => { const r = document.getElementById('store-dialog').dataset.result; return r && JSON.parse(r).identical === 100; }, null, { timeout: 120000 });
  report.equal('Wiederholter Import: weiterhin genau 100 Dateien', (await sessionKeys(page)).length, 100);
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 400));
  await page.screenshot({ path: path.join(work, 'fail-a.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-a.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
