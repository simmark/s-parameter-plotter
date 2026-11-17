// Diagramme und Achsen: vorzeichenbehaftete Ersatzwerte, ±Log-Achse, Y-Achse mit der Maus, gemeinsamer Tab „Z“ mit CISPR 17.
// Referenz ist eine synthetische Drossel 10 µH ∥ 5 pF (Eigenresonanz 22,5 MHz) in einer Serien-Fixture.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, Report, until, logFreqs, inductorZ, capacitorZ, fixtureS2P, touchstone } from './lib.mjs';

const report = new Report('Achsen und Z-Tab');
const srv = await serve(), profile = tempDir('spa-ax-'), work = tempDir('spa-ax-files-');
const L = 10e-6, C = 5e-12, fres = 1 / (2 * Math.PI * Math.sqrt(L * C));
const freqs = logFreqs(1e5, 1e9, 241);
const { context, page, errors } = await launch(profile);
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
async function csv() {
  await page.click('#export-button');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="download"][data-value="csv"]')]);
  const file = path.join(work, 'export-' + Date.now() + '.csv'); await download.saveAs(file);
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
  return { head: rows[0], rows: rows.slice(1).map(r => r.map(v => v === '' ? NaN : Number(v))) };
}
const stored = () => page.evaluate(async () => (await Store.entries('session')).find(e => e.name === 'Drossel.s2p').settings);
const scaleButtons = () => page.$$eval('[data-action="y-scale"]', n => n.filter(b => !b.hidden && b.offsetParent).map(b => b.dataset.value + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'Drossel.s2p', mimeType: 'text/plain', buffer: Buffer.from(fixtureS2P(inductorZ({ L, C, R: 0.2, Rp: 30e3 }), freqs, 'series')) },
    { name: 'Vierpol.s4p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(4, 77)) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '2');
  await page.click('.session-open[data-key="Drossel.s2p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Drossel.s2p'); await ready();

  // ---- one main tab "Z" ----
  report.equal('Es gibt einen Haupttab „Z“, keinen eigenen CISPR-Tab mehr', await page.$$eval('[role=tab]', n => n.map(t => t.id)), ['tab-s', 'tab-ports', 'tab-smith', 'tab-z', 'tab-cmc']);
  await page.click('#tab-z'); await ready();
  const evals = await page.$$eval('#control-z-eval option', n => n.map(o => o.value));
  report.equal('Auswertungen im Z-Tab: Impedanz und CISPR 17', evals, ['z:reflection', 'z:zmatrix', 'z:ymatrix', 'z:txseries', 'z:txshunt', 'cispr:one', 'cispr:series', 'cispr:shunt', 'cispr:four']);
  report.equal('Darstellungen: |Z|, R/ESR, X, Phase, L, C, Q', await page.$$eval('#control-z-format option', n => n.map(o => o.value)), ['mag', 're', 'im', 'phase', 'ls', 'cs', 'lp', 'cp', 'q']);

  // ---- series impedance, |Z|: log axis offered, symmetric log not ----
  await page.selectOption('#control-z-eval', 'z:txseries'); await ready();
  report.equal('|Z|: Y-Achse Log (gewählt) und Lin', await scaleButtons(), ['log*', 'linear']);
  let data = await csv();
  const peak = data.rows.reduce((best, r) => r[1] > best[1] ? r : best, [0, 0]);
  report.check('|Z| hat sein Maximum an der Eigenresonanz 22,5 MHz', Math.abs(peak[0] / fres - 1) < 0.03 && peak[1] > 2e4, (peak[0] / 1e6).toFixed(2) + ' MHz · ' + Math.round(peak[1]) + ' Ω');

  // ---- L series with sign ----
  await page.selectOption('#control-z-format', 'ls'); await ready();
  data = await csv();
  const scale = /µH/.test(data.head[1]) ? 1e-6 : /nH/.test(data.head[1]) ? 1e-9 : /mH/.test(data.head[1]) ? 1e-3 : 1;
  const low = data.rows.filter(r => r[0] < 2e6).map(r => r[1] * scale), high = data.rows.filter(r => r[0] > 1.3 * fres).map(r => r[1] * scale);
  report.check('L(f) unterhalb der Resonanz: +10 µH', low.every(v => Math.abs(v / L - 1) < 0.02), (low[0] * 1e6).toFixed(3) + ' µH');
  report.check('L(f) oberhalb der Resonanz: negativ, nicht abgeschnitten', high.length > 20 && high.every(v => v < 0), 'kleinster Wert ' + (Math.min(...high) * 1e6).toFixed(3) + ' µH');
  report.equal('L(f) hat keine Lücken mehr am Vorzeichenwechsel', data.rows.filter(r => !Number.isFinite(r[1])).length, 0);
  const expected = f => { const w = 2 * Math.PI * f, z = inductorZ({ L, C, R: 0.2, Rp: 30e3 })(f); return z[1] / w; };
  const worst = Math.max(...data.rows.map(r => Math.abs(r[1] * scale - expected(r[0])) / Math.max(1e-9, Math.abs(expected(r[0])))));
  report.check('L(f) stimmt über den ganzen Bereich mit der Referenz X/ω überein', worst < 1e-3, 'größte relative Abweichung ' + worst.toExponential(2));
  report.equal('Vorzeichenbehaftete Werte: ±Log (gewählt) und Lin, keine einfache Log-Achse', await scaleButtons(), ['symlog*', 'linear']);
  await page.screenshot({ path: '/tmp/ax-symlog.png', clip: await page.locator('#chart-card').boundingBox() });
  await page.selectOption('#control-z-format', 'cs'); await ready();
  data = await csv();
  const cScale = /pF/.test(data.head[1]) ? 1e-12 : /nF/.test(data.head[1]) ? 1e-9 : /µF/.test(data.head[1]) ? 1e-6 : /fF/.test(data.head[1]) ? 1e-15 : 1;
  const cHigh = data.rows.filter(r => r[0] > 5 * fres).map(r => r[1] * cScale), cLow = data.rows.filter(r => r[0] < 0.5 * fres).map(r => r[1] * cScale);
  report.check('C(f): oberhalb der Resonanz +5 pF, darunter negativ', cHigh.every(v => Math.abs(v / C - 1) < 0.06) && cLow.every(v => v < 0), (cHigh.at(-1) * 1e12).toFixed(3) + ' pF');
  await page.selectOption('#control-z-format', 'q'); await ready();
  data = await csv();
  const q1 = data.rows.find(r => r[0] >= 1e6);
  const zq = inductorZ({ L, C, R: 0.2, Rp: 30e3 })(q1[0]);
  report.check('Güte Q = |X|/R', Math.abs(q1[1] / (Math.abs(zq[1]) / zq[0]) - 1) < 1e-3, 'Q(' + (q1[0] / 1e6).toFixed(2) + ' MHz) = ' + q1[1].toFixed(2));
  await page.selectOption('#control-z-format', 'ls'); await ready();

  // ---- vertical axis with the mouse ----
  const box = await page.locator('#plot').boundingBox();
  const sx = box.x + 30, sy = box.y + box.height * 0.45;
  await page.mouse.move(sx, sy);
  await page.mouse.wheel(0, -300); await page.waitForTimeout(700);
  const r1 = (await stored()).axes.z.yRange;
  report.check('Mausrad auf der Y-Skala zoomt die vertikale Achse', Array.isArray(r1) && r1[1] > r1[0], JSON.stringify(r1));
  report.equal('…und lässt den Frequenzbereich in Ruhe', (await stored()).axes.z.xRange ?? null, null);
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx, sy + 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(700);
  const r2 = (await stored()).axes.z.yRange;
  report.check('Ziehen auf der Y-Skala verschiebt die Achse', r2[0] !== r1[0] && r2[1] !== r1[1] && r2[1] > r2[0], JSON.stringify(r2));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift'); await page.waitForTimeout(700);
  const r3 = (await stored()).axes.z.yRange;
  report.check('Umschalt + Mausrad im Diagramm zoomt ebenfalls vertikal', JSON.stringify(r3) !== JSON.stringify(r2) && (await stored()).axes.z.xRange == null, JSON.stringify(r3));
  await page.mouse.dblclick(sx, sy); await page.waitForTimeout(700);
  report.equal('Doppelklick auf die Y-Skala setzt sie zurück', (await stored()).axes.z.yRange, null);

  // ---- manual minimum / maximum, kept per file and view across a reload ----
  await page.click('#axes-button');
  report.equal('Achsendialog bietet für L(f): ±Log und Linear', await page.$$eval('#axes-form select[name="y-scale"] option', n => n.map(o => o.value)), ['symlog', 'linear']);
  await page.selectOption('#axes-form select[name="y-scale"]', 'linear');
  await page.fill('#axes-form input[name="y-start"]', '-25');
  await page.fill('#axes-form input[name="y-stop"]', '25');
  await page.click('#axes-form button[type=submit]'); await page.waitForTimeout(700);
  report.equal('Manuelles Minimum/Maximum mit negativen Werten', (await stored()).axes.z, { x: 'log', xRange: null, y: 'linear', yRange: [-25, 25] });
  await page.screenshot({ path: '/tmp/ax-linear.png', clip: await page.locator('#chart-card').boundingBox() });
  await page.click('.session-open[data-key="Vierpol.s4p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Vierpol.s4p'); await ready();
  report.check('Andere Datei hat ihre eigene Achse (kein übertragener Bereich)', await page.evaluate(async () => { const s = (await Store.entries('session')).find(e => e.name === 'Vierpol.s4p').settings; return !s?.axes?.z?.yRange; }));
  await page.waitForTimeout(600);
  await page.click('.session-open[data-key="Drossel.s2p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Drossel.s2p'); await ready();
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Drossel.s2p' && document.getElementById('control-z-format'));
  report.equal('Nach F5: Achseneinstellung dieser Datei und Ansicht wiederhergestellt', [(await stored()).axes.z, await scaleButtons()], [{ x: 'log', xRange: null, y: 'linear', yRange: [-25, 25] }, ['symlog', 'linear*']]);
  await page.click('button[data-action="reset-plot"]'); await page.waitForTimeout(700);
  report.equal('Zurücksetzen der Achse', (await stored()).axes.z.yRange, null);

  // ---- CISPR 17 inside the Z tab, settings saved under the old tab name migrate ----
  await page.click('.session-open[data-key="Vierpol.s4p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Vierpol.s4p'); await ready();
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="cross"]'); await ready();
  await page.click('#tab-z'); await ready();
  await page.selectOption('#control-z-eval', 'cispr:four'); await ready();
  data = await csv();
  report.check('CISPR 17 Vierport liefert CM- und DM-Impedanz im Z-Tab', data.head.length >= 3 && data.rows.every(r => Number.isFinite(r[1]) && Number.isFinite(r[2])), data.head.slice(1).join(' | ').slice(0, 120));
  // reference: the CISPR 17 four-port value straight from the RF core for the same file and pairs
  await page.waitForTimeout(700);
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById('control-z-eval'));
  report.equal('Nach F5: Z-Tab mit CISPR-17-Auswertung wiederhergestellt', [await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id), await page.inputValue('#control-z-eval')], ['tab-z', 'cispr:four']);
  // a file saved by the previous version: tab "cispr", no zFamily field
  await page.evaluate(async () => { const e = (await Store.entries('session')).find(x => x.name === 'Vierpol.s4p'); const settings = { ...e.settings, tab: 'cispr', cispr: { ...e.settings.cispr, method: 'series' } }; delete settings.zFamily; delete settings.axes; await Store.updateEntry(e.id, { settings }); });
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById('control-z-eval'));
  report.equal('Alte Einstellung „Tab CISPR 17 · Zweitor Serie“ wird in den Z-Tab übernommen', [await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id), await page.inputValue('#control-z-eval')], ['tab-z', 'cispr:series']);
  await page.click('#tab-s'); await page.click('#tab-z'); await ready();
  report.equal('Z-Tab merkt sich die zuletzt genutzte Auswertung', await page.inputValue('#control-z-eval'), 'cispr:series');
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-ax.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-ax.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
