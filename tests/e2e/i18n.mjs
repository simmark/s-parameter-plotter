// Englische Oberfläche: Alle neuen Texte (Sitzung, Bibliothek, Import, Speicher, Achsen, Z-Tab, ESB) müssen übersetzt sein.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, touchstone, Report, logFreqs, capacitorZ, fixtureS2P, spiceTouchstone, REF_CMC, refTransformer } from './lib.mjs';

const report = new Report('Englische Oberfläche');
const srv = await serve(), work = tempDir('spa-en-files-');
const { context, page, errors } = await launch(tempDir('spa-en-'), { lang: 'en-US' });
const GERMAN = /[äöüßÄÖÜ]|\b(Datei|Dateien|Bibliothek|Bibliotheken|Sitzung|gespeichert|Speicher|Sicherung|Ordner|nicht|wird|werden|wurde|wurden|und|oder|der|die|das|ist|sind|von|mit|bei|auf|aus|Auswertung|Achse|Abbrechen|Fertig|Anlegen|Neu|Typ|Ja|Nein|unbekannt|Fortschritt|Fehlgeschlagen|Gespeichert|Lizenz|Serie|Eintor|Bauteil|induktiv|kapazitiv|Automatisch|erkannt|wahrscheinlich)\b/;
// visible text and tooltips of a region, without file names and parts marked as language-neutral
const texts = selector => page.evaluate(selector => {
  const out = [], root = document.querySelector(selector);
  if (!root) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) {
      const el = node.parentElement;
      if (!el || el.closest('[data-no-i18n], script, style, .session-open, .session-folder, .lib-folder span, option[value^="lib"], #lib-select, .mono, pre') || !node.nodeValue.trim()) continue;
      out.push(node.nodeValue.trim());
    } else for (const name of ['title', 'aria-label', 'placeholder']) {
      const value = node.getAttribute(name);
      if (value && !node.closest('[data-no-i18n], .session-open, .session-folder, .session-pick, .session-compare, .lib-folder, .lib-row')) out.push(value);
    }
  }
  return out;
}, selector);
const german = async (name, selector) => { const hits = (await texts(selector)).filter(t => GERMAN.test(t)); report.equal(name + ' ist englisch', hits.slice(0, 6), []); };
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
try {
  await page.goto(srv.url); await ready();
  report.equal('Sprache folgt dem Browser', await page.evaluate(() => document.documentElement.lang), 'en');
  const freqs = logFreqs(1e4, 3e9, 201);
  const zip = path.join(work, 'pack.zip');
  fs.writeFileSync(zip, makeZip([...Array.from({ length: 12 }, (_, i) => ({ name: 'group' + (i % 2) + '/part_' + i + '.s' + (i % 2 ? 4 : 2) + 'p', data: touchstone(i % 2 ? 4 : 2, 30 + i, 20) })),
    { name: 'cap.s2p', data: fixtureS2P(capacitorZ({ C: 1e-9, ESR: 0.1, ESL: 1e-9 }), freqs, 'series') }, { name: 'notes.txt', data: 'x' }, { name: 'broken.s2p', data: touchstone(2, 1), corrupt: true }]));
  await page.setInputFiles('#file-input', zip);
  await page.waitForFunction(() => ['done', 'failed'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 60000 });
  await german('Importergebnis mit Fehlerliste', '#store-dialog');
  report.check('Ergebniszeile englisch formuliert', /13 of 14 files saved permanently and verified/.test(await page.textContent('#store-headline')), await page.textContent('#store-headline'));
  await page.click('button[data-action="store-close"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '13');
  await german('Sitzungsliste', '#session-files');
  await page.click('button[data-action="session-select"]');
  await german('Sitzungsliste im Auswahlmodus', '#session-files');
  await page.locator('.session-pick input').first().check();
  await page.click('button[data-action="shelf-add"]');
  await page.waitForSelector('#shelf-form');
  await german('Bibliothek mit Übernahme-Formular', '#shelf');
  await page.selectOption('#shelf-scope', 'pack');
  await page.click('#shelf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done');
  await german('Ergebnis der Übernahme in die Bibliothek', '#store-dialog');
  await page.click('button[data-action="store-close"]');
  await page.waitForFunction(() => document.getElementById('shelf').dataset.count === '13');
  await page.click('.lib-folder[data-value="pack"]');
  await page.click('button[data-action="lib-new"]');
  await page.waitForSelector('#lib-new-form');
  await german('Bibliothek mit Baum, Filtern und „Neu“', '#shelf');
  await page.click('#lib-new-form button[data-action="lib-new"]');
  // conflict dialog
  fs.writeFileSync(zip, makeZip([{ name: 'cap.s2p', data: touchstone(2, 999) }]));
  await page.setInputFiles('#file-input', zip);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'conflict');
  await german('Dialog bei Namenskonflikt', '#store-dialog');
  await page.click('button[data-action="store-conflict"][data-value="skip"]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state !== 'conflict' && document.getElementById('store-dialog').dataset.state !== 'running');
  await german('Meldung nach dem Überspringen', '#toast');
  // storage dialog and self test
  await page.click('#storage-button');
  await page.waitForSelector('#storage-content .storage-table');
  await page.click('button[data-action="storage-test"]');
  await page.waitForFunction(() => document.getElementById('storage-test-result').dataset.ok);
  await german('Speicher & Sicherung mit Funktionstest', '#storage-dialog');
  await page.click('#storage-dialog .dialog-foot button');
  await german('Kopfzeile', '.app-bar');
  await german('Fußzeile mit Lizenzhinweis', '.legal-line');
  await page.click('.legal-line button[data-action="license"]');
  report.check('Lizenzdialog zeigt beide Sprachfassungen', /License Terms/.test(await page.textContent('#license-text')) && /Nutzungsbedingungen/.test(await page.textContent('#license-text')));
  await german('Rahmen des Lizenzdialogs', '#license-dialog .dialog-head');
  await page.click('#license-dialog .dialog-foot button');
  // Z tab, axes, ESB
  await page.fill('#session-filter', 'cap'); await page.click('.session-open[data-key="pack/cap.s2p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'pack/cap.s2p'); await ready();
  await page.click('#tab-z'); await ready();
  await page.selectOption('#control-z-eval', 'z:txseries'); await page.selectOption('#control-z-format', 'cs'); await ready();
  await german('Z-Tab: Auswahlfelder', '#view-controls');
  await german('Z-Tab: Achsenknöpfe', '#chart-tools');
  await german('Z-Tab: Hinweiszeile unter dem Diagramm', '#plot-hint');
  await page.click('#axes-button');
  await german('Achsendialog', '#axes-dialog');
  await page.click('#axes-dialog button[data-action="close-dialog"]');
  await page.click('#tab-cmc'); await ready();
  await german('ESB: Auswahlfelder', '#view-controls');
  await german('ESB: Erkennung und Kennwerte', '#analysis-details');
  report.check('ESB erkennt den Kondensator auch in der englischen Oberfläche', /capacitive/.test(await page.evaluate(() => document.getElementById('control-esb-model').selectedOptions[0].textContent)));
  // model editor actions and the CMC / transformer drawings
  await page.fill('#model-c', '-1'); await page.click('#model-form button[type=submit]'); await page.waitForTimeout(150);
  await german('Editor: Meldung bei ungültigem Wert', '#toast');
  await page.fill('#model-c', '1 nF'); await page.click('button[data-action="model-fit"]'); await page.waitForTimeout(300);
  await german('Editor: Meldung nach dem Optimieren', '#toast');
  await page.click('button[data-action="model-marker"][data-value="c"]'); await page.waitForTimeout(200);
  await german('Editor: Meldung zur Marker-Übernahme', '#toast');
  await page.setInputFiles('#file-input', [{ name: 'cmc.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(REF_CMC, { f1: 1e4, f2: 1e8, n: 201 })) }, { name: 'trafo.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(refTransformer(), { f1: 1e4, f2: 3e7, n: 201 })) }]);
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state !== 'running' && Number(document.getElementById('session-files').dataset.count) >= 15, null, { timeout: 60000 });
  for (const [name, id] of [['cmc.s4p', 'cmc-schematic'], ['trafo.s4p', 'transformer-schematic']]) {
    await page.fill('#session-filter', name); await page.click('.session-open[data-key="' + name + '"]');
    await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready();
    await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
    await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#' + id + ' svg');
    if (name === 'cmc.s4p') { await page.fill('#fit-form input[name=start]', '20 kHz'); await page.fill('#fit-form input[name=stop]', '300 kHz'); await page.click('#fit-form button[type=submit]'); await ready(); await page.waitForSelector('#cmc-unphysical'); }
    await german('Schaltbild ' + name + ': Bild, Tabelle und Hinweise', '#' + id);
    await german('Auswahlfelder ' + name, '#view-controls');
  }
  await page.click('button[data-action="eval-marker"]'); await page.waitForTimeout(200);
  await german('Meldung zur Auswertefrequenz', '#toast');
  // interrupted import notice after a reload
  await page.evaluate(() => { Store.hooks.afterWrite = () => (location.reload(), new Promise(() => {})); });
  fs.writeFileSync(zip, makeZip([{ name: 'late.s2p', data: touchstone(2, 5) }]));
  await page.setInputFiles('#file-input', zip);
  await page.waitForSelector('#storage-notice [data-notice]', { timeout: 30000 });
  await german('Hinweis auf unterbrochenen Import', '#storage-notice');
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-en.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-en.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
