// Zeitmessung (kein Bestehen/Durchfallen): Import, Neuladen und Übernahme in die Bibliothek bei 100 und 1000 Dateien.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, touchstone, until } from './lib.mjs';

const srv = await serve(), work = tempDir('spa-perf-');
for (const [count, points] of [[100, 201], [1000, 201]]) {
  const { context, page } = await launch(tempDir('spa-perf-p-'));
  const zip = path.join(work, 'p' + count + '.zip');
  fs.writeFileSync(zip, makeZip(Array.from({ length: count }, (_, i) => ({ name: 'g' + (i % 20) + '/f' + i + '.s4p', data: touchstone(4, i + 1, points) }))));
  await page.goto(srv.url);
  await page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
  let t = Date.now();
  await page.setInputFiles('#file-input', zip);
  await page.waitForFunction(n => document.getElementById('session-files').dataset.count === String(n) && document.getElementById('session-files').dataset.current, count, { timeout: 600000 });
  const imported = Date.now() - t;
  t = Date.now();
  await page.reload();
  await page.waitForFunction(n => document.getElementById('session-files').dataset.count === String(n) && /4 Ports/.test(document.getElementById('status-bar').textContent), count, { timeout: 600000 });
  const reloaded = Date.now() - t;
  await page.click('button[data-action="shelf-add"]'); await page.waitForSelector('#shelf-form');
  t = Date.now();
  await page.click('#shelf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done', null, { timeout: 600000 });
  const stored = Date.now() - t;
  const d = await page.evaluate(() => Store.diagnose());
  console.log(count + ' Dateien (' + (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB ZIP, ' + (d.bytes / 1048576).toFixed(1) + ' MB entpackt): Import ' + (imported / 1000).toFixed(1) + ' s · Neuladen bis Diagramm ' + (reloaded / 1000).toFixed(1) + ' s · gesamtes ZIP in die Bibliothek ' + (stored / 1000).toFixed(1) + ' s');
  await context.close();
}
await srv.close();
