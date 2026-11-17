// Kernglieder im CMC-Editor: eine Drossel mit zwei Dispersionsbereichen (0,6 mH bis 2 MHz, 0,4 mH bis 100 kHz) als SPICE-Netzliste.
// „Anzahl prüfen“ muss 2 Glieder finden und ihre Werte treffen, die Auswahl setzt Startwerte, SPICE-Export und Schaltbild folgen.
// Die Rechnung läuft im Worker: die Seite bleibt bedienbar. Synthetische Daten.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, Report, spiceTouchstone, optimize } from './lib.mjs';

const report = new Report('ESB · Kernglieder der CMC');
const srv = await serve(), work = process.env.SPA_SHOTS || tempDir('spa-core-files-');
let { context, page, errors } = await launch(tempDir('spa-core-'));
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6 };
const num = text => { const m = String(text).replace(/\s/g, '').replace(',', '.').match(/^([\d.eE+-]+)(f|p|n|µ|m|k|M)?/); return m ? Number(m[1]) * (SI[m[2]] ?? 1) : NaN; };
const value = async key => num(await page.inputValue('#model-' + key));
const TAU = 2 * Math.PI, R1 = 2 * TAU * 0.6e-3 * 2e6, R2 = 2 * TAU * 0.4e-3 * 1e5;
// pins 1 IN+ 2 IN− 3 OUT+ 4 OUT− (windings 1→3, 2→4, as REF_CMC); per winding R_w, Lσ ∥ R_σ, then two coupled sections M ∥ R (k = 1)
const NET = '.subckt CMC2 1 2 3 4\n' +
  'Rwa 1 a1 0.05\nLsa a1 a2 3u\nRsa a1 a2 3k\nLma a2 a3 0.6m\nRfa a2 a3 ' + R1 + '\nLma2 a3 3 0.4m\nRfa2 a3 3 ' + R2 + '\n' +
  'Rwb 2 b1 0.05\nLsb b1 b2 3u\nRsb b1 b2 3k\nLmb b2 b3 0.6m\nRfb b2 b3 ' + R1 + '\nLmb2 b3 4 0.4m\nRfb2 b3 4 ' + R2 + '\n' +
  'K1 Lma Lmb 1\nK2 Lma2 Lmb2 1\nCt1 1 3 2p\nCt2 2 4 2p\nCw1 1 2 6p\nCw2 3 4 6p\nCxa 1 4 1p\nCxb 2 3 1p\nCg1 1 0 1.5p\nCg2 2 0 1.5p\nCg3 3 0 1.5p\nCg4 4 0 1.5p\n.ends\n';
try {
  const file = { name: 'cmc_zwei_glieder.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(NET, { f1: 1e3, f2: 3e8, n: 241 })) };
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [file]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1'); await ready();
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
  await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');
  report.check('Editor: Auswahl „Kernglieder“ steht auf 1, Knopf „Anzahl prüfen“ da', await page.inputValue('#control-model-sections') === '1' && await page.locator('button[data-action="model-sections-check"]').count() === 1);

  // the check runs in a worker: the page answers while it works
  await page.click('button[data-action="model-sections-check"]');
  const busy = await page.evaluate(() => !!document.querySelector('#model-editor[data-busy]'));
  let slowest = 0;
  while (await page.evaluate(() => !!document.querySelector('#model-editor[data-busy]'))) { const t = Date.now(); await page.evaluate(() => 1); slowest = Math.max(slowest, Date.now() - t); await page.waitForTimeout(100); }
  report.check('Anzahl prüfen läuft im Hintergrund, die Seite bleibt bedienbar', busy && slowest < 500, 'längste Antwort ' + slowest + ' ms');
  const best = await page.getAttribute('#model-sections-report', 'data-best');
  report.check('Anzahl prüfen: die Messung trägt 2 Kernglieder', best === '2' && await page.inputValue('#control-model-sections') === '2', (await page.textContent('#model-sections-report')).slice(0, 160));
  const keys = await page.$$eval('.model-row', n => n.map(r => r.dataset.key));
  report.check('Editor: Zeilen für M₂ und R_Fe2', keys.includes('m2') && keys.includes('rfe2') && !keys.includes('m3'), keys.join(' '));
  const got = { m: await value('m'), rfe: await value('rfe'), m2: await value('m2'), rfe2: await value('rfe2') };
  const near = (v, t) => Math.abs(v / t - 1) < 0.03;
  report.check('Werte der Glieder auf 3 % (0,6 mH ∥ ' + R1.toFixed(0) + ' Ω, 0,4 mH ∥ ' + R2.toFixed(1) + ' Ω)', near(got.m, 0.6e-3) && near(got.rfe, R1) && near(got.m2, 0.4e-3) && near(got.rfe2, R2), JSON.stringify(got));
  report.check('Modellkopf nennt 2 Kernglieder', /2 Kernglieder/.test(await page.textContent('#model-editor .fit-summary small')));
  const table = await page.$$eval('.metric', n => n.map(m => m.textContent.replace(/\s+/g, ' ')).join(' | '));
  report.check('Schaltbild-Tabelle listet beide Glieder und die Summe', /Kernglied 1/.test(table) && /Kernglied 2/.test(table) && /Summe der Kernglieder/.test(table));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#model-form button[data-action="esb-spice"][data-value="save"]')]);
  const lib = path.join(work, 'cmc2.lib'); await download.saveAs(lib);
  const text = fs.readFileSync(lib, 'utf8');
  report.check('SPICE-Export enthält beide Glieder (Lma, Lma2, Kab, Kab2)', /^Lma /m.test(text) && /^Lma2 /m.test(text) && /^Kab /m.test(text) && /^Kab2 /m.test(text));

  // the number of sections and the report survive a reload (session state)
  await page.waitForTimeout(600);
  await page.reload(); await ready();
  await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');
  report.check('Nach dem Neuladen: 2 Glieder, Werte und Bericht noch da', await page.inputValue('#control-model-sections') === '2' && Math.abs(await value('m2') / 0.4e-3 - 1) < 0.03 && await page.getAttribute('#model-sections-report', 'data-best') === '2');
  // phone width: the row fits without horizontal scrolling
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => { const row = document.getElementById('model-sections-row'); const r = row.getBoundingClientRect(); return { right: r.right, width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
  await page.locator('#model-sections-row').screenshot({ path: path.join(work, 'sections-phone.png') });
  report.check('Handy (390 px): Zeile „Kernglieder“ passt, kein waagrechtes Scrollen', overflow.right <= overflow.width + 1 && !overflow.scroll, JSON.stringify(overflow));
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200);
  // choosing 3 sets start values; optimising keeps the deviation small
  await page.selectOption('#control-model-sections', '3'); await ready(); await page.waitForTimeout(150);
  report.check('Auswahl 3: drei Glieder mit Startwerten aus den Relaxationszeiten', (await page.$$eval('.model-row', n => n.map(r => r.dataset.key))).includes('m3') && /3 Kernglieder: Startwerte/.test(await page.textContent('#toast')));
  await optimize(page);
  report.check('Optimieren mit 3 Gliedern: Abweichung bleibt unter 0,1 dB', Number(await page.getAttribute('#model-summary', 'data-err')) < 0.1, await page.getAttribute('#model-summary', 'data-err'));
  await page.click('button[data-action="model-reset"]'); await ready();
  report.check('„Automatik“ setzt auf 1 Glied zurück', await page.inputValue('#control-model-sections') === '1' && await page.locator('#model-sections-report').count() === 0);
  report.check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 2).join(' | '));

  // English
  await context.close();
  ({ context, page, errors } = await launch(tempDir('spa-core-en-')));
  await page.addInitScript(() => localStorage.setItem('spa-lang', 'en'));
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [file]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1'); await ready();
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
  await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');
  await optimize(page, 'model-sections-check');
  const en = await page.textContent('#model-sections-report');
  report.check('Englisch: Bericht übersetzt, ohne deutsche Reste', /The measurement supports 2 core sections\./.test(en) && /Core sections checked/.test(en) && !/Glied|Messung|trägt/.test(en), en.slice(0, 200));
  report.check('Englisch: Knopf und Auswahl', (await page.textContent('button[data-action="model-sections-check"]')).trim() === 'Check number' && /Core sections/.test(await page.textContent('#model-sections-row')));
} catch (error) {
  report.check('Ablauf ohne Ausnahme', false, error.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  srv.close?.();
}
process.exit(report.done() ? 0 : 1);
