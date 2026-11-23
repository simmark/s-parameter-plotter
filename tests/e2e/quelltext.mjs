// Tab „Quelltext“ (module/quelltext): Datei als Text öffnen, Ansichten, Fehlerstelle, Wert ersetzen, Entwurf über Neuladen,
// Formatwechsel ohne Wertänderung, Sprung vom Marker, Übernahme als neue Analyse. Prüft gegen den RF-Kern in Node.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, touchstone, waitIdle, Report } from './lib.mjs';
import { load } from '../load.mjs';

const { RF } = load();
const report = new Report('Quelltext');
const profile = tempDir('spa-src-'), work = tempDir('spa-src-files-');
const original = touchstone(2, 3, 20).replace(/\n/g, '\r\n');   // CRLF must survive editing
fs.writeFileSync(path.join(work, 'messung.s2p'), original);

const srv = await serve();
let { context, page, errors } = await launch(profile);
const text = sel => page.textContent(sel);
const status = () => text('#src-status');
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const statusIs = re => until(source => new RegExp(source).test(document.getElementById('src-status')?.textContent || ''), re.source);
async function download(button) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
  return fs.readFileSync(await file.path(), 'latin1');
}
const sameNetwork = (a, b, tol) => {
  const x = RF.parseTouchstone(a, 'a.s2p'), y = RF.parseTouchstone(b, 'b.s2p');
  if (x.freq.length !== y.freq.length) return 'Punktzahl ' + x.freq.length + ' / ' + y.freq.length;
  let worst = 0;
  x.samples.forEach((s, k) => s.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - y.samples[k][i])); }));
  return worst <= tol ? true : 'größte Abweichung ' + worst;
};

try {
  await page.goto(srv.url);
  await page.waitForSelector('#session-files', { state: 'attached' });
  report.equal('Tab „Quelltext“ kommt aus der Anmeldung und steht hinter „S-Parameter“',
    (await page.$$eval('[role=tab]', n => n.map(t => t.id))).slice(0, 2), ['tab-s', 'tab-source']);
  await page.setInputFiles('#file-input', path.join(work, 'messung.s2p'));
  await waitIdle(page);
  await page.click('#tab-source');
  await statusIs(/^Gültig/);
  report.equal('Prüfung der Datei', await status(), 'Gültig · 2 Ports · 20 Frequenzpunkte · RI');
  report.check('Aktive Datei, Zeilenende CRLF erkannt', /Aktive Analysedatei · .* · CRLF/.test(await text('#src-origin')), await text('#src-origin'));
  report.equal('Seitentitel', await text('#page-title'), 'Quelltext');

  // views
  await page.click('#src-view-matrix');
  report.check('Matrixansicht zeigt die Matrix des ersten Frequenzpunkts', await page.isVisible('#src-matrix') && /Frequenzpunkt 100 kHz · 1 \/ 20/.test(await text('#src-matrix')) && await page.locator('#src-matrix td').count() >= 4);
  await page.click('#src-view-raw');
  report.check('Rohtext im Editor mit Zeilennummern', await page.isVisible('#src-code .cm-editor') && await page.locator('#src-code .cm-gutterElement').count() > 5);

  // jump to an element and break the number there
  const linesBefore = await page.$$eval('#src-code .cm-line', l => l.length);
  await page.fill('#src-go', 'S21 @ 100 kHz'); await page.press('#src-go', 'Enter');
  await until(() => /^Z 3 /.test(document.getElementById('src-where').textContent));
  report.check('„S21 @ 100 kHz“ springt in Zeile 3 auf den Realteil von S21', /^S21 · P2 ← P1 · Realteil · 100 kHz/.test(await text('#src-token')), await text('#src-where') + ' · ' + await text('#src-token'));
  report.equal('Enter im Sprungfeld verändert den Text nicht', await page.$$eval('#src-code .cm-line', l => l.length), linesBefore);
  await page.keyboard.type('x');
  await statusIs(/fehlerhaft/);
  report.check('Ungültige Zahl: Fehler mit Zeile, Knopf zur Fehlerstelle', /Entwurf fehlerhaft · Zeile 3 · Ungültige Zahl/.test(await status()) &&
    /Zur Fehlerstelle · Spalte/.test(await text('#src-message')), await status());
  report.check('Bei einem Fehler lässt sich nichts übernehmen', await page.isDisabled('#src-apply'));
  await page.click('#src-undo');
  await statusIs(/^Gültig/);
  report.check('Rückgängig: wieder gültig', true);

  // replace a value through the table
  await page.click('#src-view-values');
  await page.click('#src-values button[data-source-token]:nth-of-type(1)').catch(() => {});
  const tokenButtons = await page.locator('#src-values button[data-source-token]').count();
  report.check('Messwerttabelle mit auswählbaren Zahlen', tokenButtons >= 8, tokenButtons + ' Zahlen');
  await page.locator('#src-values button[data-source-token]').nth(2).click();
  await page.waitForSelector('#src-new-value');
  const before = await page.inputValue('#src-new-value');
  await page.fill('#src-new-value', '0.4242');
  await page.click('#src-edit-value button[type=submit]');
  await statusIs(/^Gültig/);
  await until(() => /Entwurf lokal gesichert/.test(document.getElementById('src-save').textContent));
  report.check('Wert ersetzt, Entwurf lokal gesichert', true, before + ' → 0.4242');
  const copy = await download('#src-download');
  report.check('Kopie: nur der eine Wert geändert, CRLF und alles andere unverändert', copy === original.replace(before, '0.4242') && copy.includes('\r\n'),
    copy.length + ' / ' + original.length);

  // reload: the draft comes back
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#session-files', { state: 'attached' });
  await page.click('#tab-source').catch(() => {});
  await statusIs(/^Gültig/);
  report.check('Nach dem Neuladen: Entwurf wiederhergestellt', /Lokalen Entwurf wiederhergestellt/.test(await text('#src-save')), await text('#src-save'));

  // format change RI → DB keeps the network
  await page.click('#src-more summary');
  await page.selectOption('#src-format', 'DB');
  await page.click('#src-convert');
  await page.waitForSelector('#src-confirm:not([hidden])');
  await page.click('#src-confirm');
  await statusIs(/· DB$/);
  const converted = await download('#src-download');
  report.check('Umrechnung RI → DB: gleiche Werte (≤ 1e-6), Kommentar und Zeilenzahl bleiben',
    sameNetwork(copy, converted, 1e-6) === true && converted.split('\r\n').length === copy.split('\r\n').length && converted.startsWith('! synthetic'),
    String(sameNetwork(copy, converted, 1e-6)));

  // apply as a new analysis
  await page.click('#src-apply');
  await until(() => / · Edit 1\.s2p$/.test(document.getElementById('session-files').dataset.current || ''), undefined, 30000);
  report.equal('Übernahme: neue Datei „· Edit 1“ in der Sitzung, Tab S-Parameter', await page.getAttribute('#tab-s', 'aria-selected'), 'true');
  report.equal('Die ursprüngliche Datei bleibt in der Sitzung', await page.locator('.session-open').count(), 2);

  // marker → source
  await page.waitForSelector('#source-at-marker');
  await page.click('#source-at-marker');
  await until(() => document.getElementById('tab-source').getAttribute('aria-selected') === 'true' && /^Z \d+/.test(document.getElementById('src-where')?.textContent || ''));
  report.check('Knopf „Quelltext“ an den Markern springt in den Frequenzblock des aktiven Markers', /Frequenz|S\d\d/.test(await text('#src-token')), await text('#src-where') + ' · ' + await text('#src-token'));

  // deep link
  await page.goto(srv.url + '#quelltext');
  await until(() => document.getElementById('tab-source').getAttribute('aria-selected') === 'true', undefined, 20000);
  report.check('Link …/#quelltext öffnet den Tab nach dem Start', true);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, error.message.split('\n')[0]);
}
report.check('Keine JavaScript-Fehler', !errors.length, errors.join(' | '));
await context.close();

// English interface: no German left in the panel (the file text itself is user content and stays as it is)
({ context, page, errors } = await launch(tempDir('spa-src-en-'), { lang: 'en-US' }));
try {
  await page.goto(srv.url);
  await page.waitForSelector('#session-files', { state: 'attached' });
  await page.setInputFiles('#file-input', path.join(work, 'messung.s2p'));
  await waitIdle(page);
  await page.click('#tab-source');
  await until(() => /^Valid/.test(document.getElementById('src-status')?.textContent || ''));
  const GERMAN = /[äöüßÄÖÜ]|\b(Datei|Gültig|Zeile|Frequenz|Messwert\w*|Ansicht|öffnen|speichern|Wert|Zahl|und|oder|der|die|das|ist|mit|nach)\b/;
  const seen = [];
  for (const view of ['values', 'matrix', 'raw', 'profile']) {
    await page.click('#src-view-' + view);
    await page.waitForTimeout(200);
    seen.push(await page.$eval('#source-panel', panel => {
      const copy = panel.cloneNode(true);
      copy.querySelectorAll('#src-code, #src-name, #src-diff, #src-conversion, [data-no-i18n]').forEach(n => n.remove());
      return copy.textContent;
    }));
  }
  const german = seen.join(' ').split(/\s+/).filter(w => GERMAN.test(w));
  report.check('Englische Oberfläche: Tab, Status und alle vier Ansichten ohne deutsche Reste', /Source/.test(await page.textContent('#tab-source')) && !german.length, german.slice(0, 12).join(' '));
} catch (error) {
  report.check('Englisch: Ablauf ohne Abbruch', false, error.message.split('\n')[0]);
}
report.check('Englisch: keine JavaScript-Fehler', !errors.length, errors.join(' | '));
await context.close();
await srv.close();
process.exit(report.done() ? 0 : 1);
