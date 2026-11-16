// Pflicht-Regressionstest D: mobile Ansicht (emuliertes Pixel 7 und kleines iPhone-Format) mit echten Touch-Ereignissen über das DevTools-Protokoll.
// Eine Emulation ersetzt keinen Gerätetest – siehe docs/geraetetests.md.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, bigPackage, sessionKeys, libraryKeys, Report, until } from './lib.mjs';

const report = new Report('D · Mobile Ansicht');
const srv = await serve(), profile = tempDir('spa-d-'), work = tempDir('spa-d-files-');
const zipPath = path.join(work, 'Mobil.zip');
fs.writeFileSync(zipPath, makeZip(bigPackage(40)));
let { context, page, errors } = await launch(profile, { mobile: true });
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
const drawerOpen = () => page.evaluate(() => { const r = document.getElementById('sidebar').getBoundingClientRect(); return r.right > 10 && getComputedStyle(document.getElementById('sidebar')).visibility === 'visible'; });
const settle = () => page.waitForTimeout(350);
const overflow = () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - window.innerWidth }));
const dataFingerprint = () => page.evaluate(async () => {
  const out = [];
  for (const e of await Store.entries('session')) out.push(e.hash + ':' + e.size);
  return out.sort().join('|');
});
async function touch(client, type, points) { await client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i })) }); }
async function swipe(client, from, to, steps = 8) {
  await touch(client, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) { await touch(client, 'touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await page.waitForTimeout(16); }
  await touch(client, 'touchEnd', []);
}
try {
  const client = await context.newCDPSession(page);
  await page.goto(srv.url); await ready();
  report.equal('Start: kein horizontales Überlaufen', await overflow(), { doc: 0, body: 0 });
  report.check('Start: Drawer geschlossen', !(await drawerOpen()));
  const toggle = await page.locator('#drawer-toggle').boundingBox();
  report.check('Ordnersymbol steht links oben', toggle && toggle.x < 20 && toggle.y < 20 && toggle.width >= 40 && toggle.height >= 40, JSON.stringify(toggle));
  report.equal('Es gibt genau einen sichtbaren Zugang zur Dateiverwaltung in der Kopfzeile', await page.evaluate(() => [...document.querySelectorAll('[data-action="toggle-sidebar"]')].filter(b => b.offsetParent !== null).length), 1);

  // drawer opens from the left
  await page.tap('#drawer-toggle'); await settle();
  const box = await page.locator('#sidebar').boundingBox();
  report.check('Drawer öffnet vom linken Bildschirmrand', (await drawerOpen()) && box.x === 0 && box.y === 0 && box.width < 390 && box.height >= 800, JSON.stringify(box));
  report.check('Drawer enthält Bereiche „Bibliothek“ und Importknöpfe', await page.locator('#sidebar #shelf').isVisible() && await page.locator('#sidebar [data-action="open-zip"]').isVisible() && await page.locator('#sidebar [data-action="open-folder"]').isVisible() && await page.locator('#dropzone').isVisible());
  // close by X
  await page.tap('#drawer-close'); await settle();
  report.check('Schließen mit X', !(await drawerOpen()));
  // close by tapping outside
  await page.tap('#drawer-toggle'); await settle();
  await page.touchscreen.tap(375, 500); await settle();
  report.check('Schließen durch Tippen außerhalb', !(await drawerOpen()));
  // close by swiping left
  await page.tap('#drawer-toggle'); await settle();
  await swipe(client, [260, 420], [60, 428]); await settle();
  report.check('Schließen durch Wischen nach links', !(await drawerOpen()));
  // Android back button closes the drawer first and stays in the app
  await page.tap('#drawer-toggle'); await settle();
  const urlBefore = page.url();
  await page.goBack().catch(() => {}); await settle();
  report.check('Zurück-Taste schließt zuerst den Drawer, die App bleibt offen', !(await drawerOpen()) && page.url() === urlBefore && await page.locator('#plot').isVisible());

  // import through the drawer
  await page.tap('#drawer-toggle'); await settle();
  await page.setInputFiles('#file-input', zipPath);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '' && document.getElementById('store-dialog').dataset.state !== 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '40');
  await settle();
  report.check('Nach dem Import zeigt die App das Diagramm, der Drawer ist zu', !(await drawerOpen()) && await page.locator('#plot').isVisible());
  report.equal('Nach dem Import: kein horizontales Überlaufen', await overflow(), { doc: 0, body: 0 });
  const fingerprint = await dataFingerprint();

  // touch targets
  await page.tap('#drawer-toggle'); await settle();
  const small = await page.evaluate(() => [...document.querySelectorAll('#sidebar button, #sidebar select, #sidebar input:not([type=file]):not([type=hidden])')].filter(el => el.offsetParent !== null).map(el => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 34 || r.width < 34).map(({ el, r }) => (el.dataset.action || el.id || el.className) + ' ' + Math.round(r.width) + '×' + Math.round(r.height)));
  report.equal('Alle Bedienelemente im Drawer sind mit dem Finger treffbar (mindestens 34 px)', small, []);

  // scroll inside the drawer, select a file → diagram → drawer closed
  const scrolled = await page.evaluate(() => { const s = document.getElementById('sidebar'); s.scrollTop = 420; return s.scrollTop; });
  report.check('Scrollen im Drawer funktioniert', scrolled > 200, 'scrollTop ' + scrolled);
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  const key = await page.evaluate(() => { const rows = [...document.querySelectorAll('.session-open')]; const b = rows.find(r => /\.s4p$/.test(r.dataset.key)); b.scrollIntoView({ block: 'center' }); return b.dataset.key; });
  await page.tap('.session-open[data-key="' + key + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, key);
  await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));
  await settle();
  report.check('Datei auswählen → Diagramm anzeigen → Drawer schließt', !(await drawerOpen()) && await page.locator('#plot').isVisible());
  report.equal('Kein Sprung an den Seitenanfang beim Auswählen', await page.evaluate(() => window.scrollY), pageScrollBefore);
  // scroll position of the file manager is kept
  const kept0 = await page.evaluate(() => document.getElementById('sidebar').scrollTop);
  await page.tap('#drawer-toggle'); await settle();
  const kept1 = await page.evaluate(() => document.getElementById('sidebar').scrollTop);
  report.check('Beim erneuten Öffnen bleibt die Scrollposition des Dateimanagers', kept1 > 100 && Math.abs(kept1 - kept0) < 2, kept0 + ' → ' + kept1);
  await page.tap('#drawer-close'); await settle();

  // ---- plot gestures (a short viewport so that the page really has room to scroll) ----
  await page.setViewportSize({ width: 390, height: 600 });
  await page.evaluate(() => document.getElementById('plot').scrollIntoView({ block: 'start' }));
  await settle();
  const plot = await page.locator('#plot').boundingBox();
  const marker = () => page.inputValue('#marker-0');
  const m0 = await marker();
  await page.touchscreen.tap(plot.x + plot.width * 0.75, plot.y + plot.height * 0.5); await settle();
  const m1 = await marker();
  report.check('Marker durch Tippen setzen', m1 !== m0, m0 + ' → ' + m1);
  // vertical swipe over the plot scrolls the page and must not move the marker or the frequency range
  const y0 = await page.evaluate(() => window.scrollY);
  await swipe(client, [plot.x + plot.width * 0.4, plot.y + plot.height * 0.35], [plot.x + plot.width * 0.42, plot.y + plot.height * 0.35 + 150], 12);
  await settle();
  const y1 = await page.evaluate(() => window.scrollY);
  report.check('Vertikales Wischen über dem Diagramm scrollt die Seite', Math.abs(y1 - y0) > 80, y0 + ' → ' + y1);
  report.equal('Vertikales Scrollen verändert den Marker nicht', await marker(), m1);
  const axes = () => page.evaluate(async key => (await Store.entries('session')).find(e => Store.keyOf(e) === key)?.settings?.axes?.s?.xRange ?? null, key);
  await page.waitForTimeout(500);
  report.equal('Vertikales Scrollen verändert den Frequenzbereich nicht', await axes(), null);
  await page.evaluate(y => window.scrollTo(0, y), y0); await settle();
  // horizontal swipe drags the marker
  await swipe(client, [plot.x + plot.width * 0.35, plot.y + plot.height * 0.5], [plot.x + plot.width * 0.6, plot.y + plot.height * 0.52]); await settle();
  const m2 = await marker();
  report.check('Marker durch waagerechtes Ziehen verschieben', m2 !== m1, m1 + ' → ' + m2);
  // two-finger zoom
  const cy = plot.y + plot.height * 0.5, cx = plot.x + plot.width * 0.55;
  await touch(client, 'touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 8; i++) { await touch(client, 'touchMove', [[cx - 30 - i * 9, cy], [cx + 30 + i * 9, cy]]); await page.waitForTimeout(16); }
  await touch(client, 'touchEnd', []);
  await page.waitForTimeout(900);
  const zoomed = await axes();
  report.check('Zwei-Finger-Zoom ändert den Frequenzbereich', Array.isArray(zoomed) && zoomed[1] > zoomed[0], JSON.stringify(zoomed));
  report.equal('Zoom verändert den Marker nicht', await marker(), m2);

  await page.setViewportSize({ width: 390, height: 844 });
  // full screen view and back without losing settings
  await page.tap('button[data-action="view-mode"]'); await settle();
  await page.tap('button[data-action="view-mode"]'); await settle();
  report.check('Vollbildansicht aktiv', await page.evaluate(() => document.body.classList.contains('view-full')));
  await page.keyboard.press('Escape'); await settle();
  await page.waitForTimeout(700);
  report.check('Zurück aus dem Vollbild: Marker und Zoom bleiben', !(await page.evaluate(() => document.body.classList.contains('view-focus'))) && await marker() === m2 && JSON.stringify(await axes()) === JSON.stringify(zoomed));
  // switch files with the pager below the plot
  const cur = await page.getAttribute('#session-files', 'data-current');
  await page.tap('#file-pager button[data-value="1"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current !== k, cur);
  report.check('Umschalten zwischen Dateien unter dem Diagramm', true);
  await page.tap('#file-pager button[data-value="-1"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, cur);
  await page.waitForFunction(() => /4 Ports/.test(document.getElementById('status-bar').textContent));
  await settle();
  report.equal('Nach dem Zurückblättern: Marker der Datei erhalten', await marker(), m2);

  // library on the phone: whole ZIP
  await page.tap('#drawer-toggle'); await settle();
  await page.tap('button[data-action="shelf-add"]');
  await page.waitForSelector('#shelf-form');
  await page.tap('#shelf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done', null, { timeout: 60000 });
  const dialog = await page.locator('#store-dialog').boundingBox();
  report.check('Ergebnisdialog passt auf den Bildschirm', dialog.x >= 0 && dialog.x + dialog.width <= 390 && dialog.y >= 0 && dialog.y + dialog.height <= 844, JSON.stringify(dialog));
  await page.tap('button[data-action="store-close"]');
  report.equal('Gesamtes ZIP am Handy in die Bibliothek übernommen', (await libraryKeys(page)).length, 40);
  report.equal('Mobile Navigation hat keine Messdaten verändert', await dataFingerprint(), fingerprint);
  report.equal('Mit geöffnetem Drawer: kein horizontales Überlaufen', await overflow(), { doc: 0, body: 0 });

  // refresh (pull to refresh is a reload) restores library and session
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '40' && document.getElementById('shelf').dataset.count === '40', null, { timeout: 30000 });
  report.check('Nach Refresh: Sitzung (40) und Bibliothek (40) wiederhergestellt, Drawer zu', !(await drawerOpen()));
  report.equal('Nach Refresh: zuletzt geöffnete Datei wieder offen', await page.getAttribute('#session-files', 'data-current'), cur);

  // every tab and the small phone format without horizontal overflow
  const tabsOverflow = [];
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    for (const id of await page.$$eval('[role=tab]', n => n.map(t => t.id))) {
      await page.tap('#' + id); await page.waitForTimeout(250);
      const o = await overflow();
      if (o.doc > 0 || o.body > 0) tabsOverflow.push(size.width + ' ' + id + ' ' + JSON.stringify(o));
    }
  }
  report.equal('Kein horizontales Überlaufen in allen Tabs (390 px und 320 px breit)', tabsOverflow, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.tap('#settings-button'); await page.tap('.menu-item[data-value="storage"]');
  await page.waitForSelector('#storage-content .storage-table');
  const sd = await page.locator('#storage-dialog').boundingBox();
  report.check('Speicherdialog passt auf den Bildschirm', sd.x >= 0 && sd.x + sd.width <= 390, JSON.stringify(sd));
  await page.tap('#storage-dialog button[data-action="close-dialog"] >> nth=0');
  await page.tap('#settings-button'); await page.tap('.menu-item[data-value="license"]');
  report.check('Lizenz am Handy aufrufbar', /Proprietäre Software/.test(await page.textContent('#license-text')) && /Proprietary Software/.test(await page.textContent('#license-text')));
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-d.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-d.png'));
}
await page.screenshot({ path: '/tmp/mobile-last.png' }).catch(() => {});
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
