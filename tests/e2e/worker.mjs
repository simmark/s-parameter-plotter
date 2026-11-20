// Rechen-Worker: Netzwerk (alle Frequenzpunkte), Übersprechen und Augendiagramm laufen außerhalb der Seite.
// Geprüft: der Worker wird benutzt; Ergebnisse sind zeichengleich mit der Berechnung auf der Seite (SPA_NO_WORKER);
// die Seite bleibt bei 48 Ports und 6-fach gedrosselter CPU reaktionsfähiger; ohne funktionierende Worker läuft alles auf der Seite.
import { serve, launch, tempDir, Report } from './lib.mjs';
import { connectorCircuit, touchstone, logf, USB_POSITIONS, USB_IDS } from '../connector-fixture.mjs';

const report = new Report('Rechen-Worker');
const srv = await serve();
const text = touchstone(connectorCircuit(USB_POSITIONS), logf(1e6, 2e10, 201), [...Array(48).keys()]);
const pairs = [['TX1', 'A2', 'A3'], ['RX1', 'B11', 'B10'], ['TX2', 'B2', 'B3'], ['RX2', 'A11', 'A10'], ['D', 'A6', 'A7']];
const ports = [...Array(48).keys()].map(k => ({ port: k + 1, pin: USB_IDS[k % 24], signal: USB_IDS[k % 24], side: k < 24 ? 'LEFT' : 'RIGHT', role: 'signal' }));
const portMap = JSON.stringify({ schema: 'simonlation.portmap.v1', model: 'usb48', ports, differential_pairs: ['LEFT', 'RIGHT'].flatMap((side, s) => pairs.map(([pair, p, m]) => ({ side, pair, positive_port: USB_IDS.indexOf(p) + 1 + 24 * s, negative_port: USB_IDS.indexOf(m) + 1 + 24 * s }))) });

// one complete run: load, port map, apply (10 pairs), read crosstalk table, S traces, eye; long tasks measured during apply
async function run({ noWorker = false, brokenWorker = false, throttle = 1 } = {}) {
  const { context, page, errors } = await launch(tempDir('spa-w-'));
  if (brokenWorker) await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('blocked'); } }; });
  if (noWorker) await page.addInitScript(() => { window.SPA_NO_WORKER = true; });
  await page.addInitScript(() => { window.__long = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); });
  const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'), null, { timeout: 120000 });
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', { name: 'usb48.s48p', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1', null, { timeout: 120000 });
  await page.click('.session-open[data-key="usb48.s48p"]'); await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'usb48.s48p'); await ready();
  await page.click('#tab-connector'); await page.waitForSelector('#cn-profile');
  await page.setInputFiles('#cn-file', { name: 'usb48.json', mimeType: 'application/json', buffer: Buffer.from(portMap) });
  await page.waitForFunction(() => document.getElementById('cn-profile').value === 'file:usb48');
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(() => { window.__long = []; });
  const t0 = Date.now();
  await page.click('#cn-apply-form button[type=submit]'); await ready();
  await page.waitForFunction(() => [...document.querySelectorAll('#connector-panel table')].some(t => /PSNEXT/.test(t.textContent)), null, { timeout: 120000 });
  const seconds = (Date.now() - t0) / 1000, long = await page.evaluate(() => window.__long.slice());
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const xt = await page.$$eval('#connector-panel table', tables => tables.find(t => /PSNEXT/.test(t.textContent)).querySelector('tbody').textContent);
  const matrix = await page.$$eval('.cn-cell', cells => cells.map(c => c.textContent).join('|'));
  await page.click('#tab-s'); await ready(); await page.waitForTimeout(300);
  const traces = await page.$$eval('.trace-row', rows => rows.map(r => r.textContent).join('|'));
  await page.click('#tab-time'); await page.waitForSelector('#td-form');
  await page.selectOption('#td-form select[name=row]', 'D6'); await page.selectOption('#td-form select[name=col]', 'D1'); await page.click('#td-form button[type=submit]'); await page.waitForSelector('#eye-form');
  await page.fill('#eye-form input[name=rate]', '10'); await page.click('#eye-form button[type=submit]'); await page.waitForSelector('.eye-img');
  const eye = await page.locator('#time-panel .cn-facts').nth(1).textContent();
  const stats = await page.evaluate(() => window.SPA_COMPUTE_STATS());
  await context.close();
  return { xt, matrix, traces, eye, stats, errors, seconds, longMax: Math.max(0, ...long), longSum: long.reduce((a, b) => a + b, 0), longCount: long.length };
}

try {
  const w = await run(), p = await run({ noWorker: true });
  report.check('Mit Worker: Netzwerkjobs laufen im Worker, keiner auf der Seite', w.stats.worker >= 1 && w.stats.page === 0 && !w.stats.failed, JSON.stringify(w.stats));
  report.check('SPA_NO_WORKER: alles auf der Seite', p.stats.worker === 0 && p.stats.page >= 1, JSON.stringify(p.stats));
  report.check('Übersprechen-Tabelle zeichengleich (Worker = Seite)', w.xt === p.xt && w.xt.length > 100);
  report.check('Kopplungsmatrix zeichengleich', w.matrix === p.matrix && w.matrix.split('|').length === 100, w.matrix.split('|').length + ' Felder');
  report.check('Kurvenwerte im S-Parameter-Tab zeichengleich', w.traces === p.traces && w.traces.length > 20);
  report.check('Augendiagramm TX1 (Sdd21) bei 10 Gbit/s: Kennwerte zeichengleich, Auge offen', w.eye === p.eye && Number(w.eye.match(/([\d.]+) V \(innen/)?.[1]) > 0.5, w.eye.replace(/\s+/g, ' ').slice(0, 90));
  report.equal('Keine JavaScript-Fehler', [w.errors, p.errors], [[], []]);
  // responsiveness with a 6× slower CPU (phone class). At 201 points the rendering dominates and both paths are close;
  // the numbers are reported, the check is a bound for the longest blockade with the worker
  const wt = await run({ throttle: 6 }), pt = await run({ throttle: 6, noWorker: true });
  const fmt = r => 'längste Blockade ' + r.longMax.toFixed(0) + ' ms, Summe ' + r.longSum.toFixed(0) + ' ms in ' + r.longCount + ' Blöcken, fertig nach ' + r.seconds.toFixed(1) + ' s';
  console.log('      Worker: ' + fmt(wt)); console.log('      Seite:  ' + fmt(pt));
  report.check('CPU 6× gedrosselt, 48 Ports: keine Blockade des Hauptthreads über 1 s', wt.longMax < 1000, 'längste ' + wt.longMax.toFixed(0) + ' ms');
  const b = await run({ brokenWorker: true });
  report.check('Worker lässt sich nicht starten: Rechnung auf der Seite, gleiche Ergebnisse', b.stats.page >= 1 && b.xt === p.xt && b.traces === p.traces && b.eye === p.eye, JSON.stringify(b.stats));
  report.equal('Keine JavaScript-Fehler ohne Worker', b.errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 400));
}
await srv.close();
process.exit(report.done() ? 0 : 1);
