// Connector Studio im Browser: vollständiger USB-C-Workflow (.s48p) und Ethernet-Workflows (LAN-Magnetics .s6p, RJ45 .s16p).
// Profil, automatische Zuordnung mit Kategorie, Pinansicht, manuelle Korrektur, Übernahme in die Analyse, Kanäle, Matrix → Kurve,
// Vorlage speichern/anwenden, Export/Import, Neuladen, Handy-Breite. Synthetische Daten (tests/connector-fixture.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, Report } from './lib.mjs';
import { connectorCircuit, magneticsCircuit, touchstone, logf, USB_POSITIONS, USB_IDS, RJ45_POSITIONS, shuffled } from '../connector-fixture.mjs';

const report = new Report('Connector Studio');
const srv = await serve(), work = tempDir('spa-cn-files-'), profile = tempDir('spa-cn-');
let { context, page, errors } = await launch(profile);
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const open = async name => {
  await page.click('.session-open[data-key="' + name + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready(); await page.waitForTimeout(200);
};
const toConnector = async () => { await page.click('#tab-connector'); await page.waitForSelector('#cn-profile', { state: 'visible' }); };
const detect = async () => { await page.click('#connector-panel button[data-action="cn-detect"]'); await page.waitForSelector('.cn-status'); return page.textContent('.cn-status .cn-badge'); };
const ports = () => page.evaluate(() => [...document.querySelectorAll('select.cn-node')].map(s => s.value || null));
const toast = () => page.textContent('#toast');
const pin = node => '.cn-pin[data-node="' + node + '"]';
const circuit = connectorCircuit(USB_POSITIONS), freq = logf(1e6, 20e9, 101);
const named = shuffled(48, 21), names = named.map(node => USB_IDS[node % 24] + '_S' + (node < 24 ? 1 : 2));
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'usb_named.s48p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(circuit, freq, named, names)) },
    { name: 'usb_block.s48p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(circuit, freq, [...Array(48).keys()])) },
    { name: 'lan.s6p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(magneticsCircuit(1), logf(1e4, 1e9, 121), [0, 1, 2, 3, 4, 5])) },
    { name: 'rj45.s16p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(connectorCircuit(RJ45_POSITIONS), logf(1e6, 3e9, 61), [...Array(16).keys()])) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '4', null, { timeout: 90000 });
  report.check('.s48p wird geladen (48 Ports, bisher Grenze 32)', await page.evaluate(() => !!document.querySelector('.session-open[data-key="usb_named.s48p"]')));

  // ---------- USB-C, port names in the file ----------
  await open('usb_named.s48p');
  report.check('Statuszeile nennt 48 Ports', /48 Ports/.test(await page.textContent('#status-bar')));
  await toConnector();
  report.equal('Einziges passendes Profil wird vorgewählt', await page.inputValue('#cn-profile'), 'usb-c-receptacle-thru');
  report.check('Nicht passende Profile sind mit erwarteter Portzahl gesperrt', await page.evaluate(() => [...document.querySelectorAll('#cn-profile option[disabled]')].every(o => /erwartet \d+ Ports/.test(o.textContent))));
  report.equal('Pinansicht: 48 Knoten (24 Kontakte × 2 Seiten), alle zunächst frei', await page.evaluate(() => [document.querySelectorAll('.cn-pin').length, document.querySelectorAll('.cn-pin.is-free').length]), [48, 48]);
  report.equal('Mit Portnamen: „Eindeutig zugeordnet“', await detect(), 'Eindeutig zugeordnet');
  const truth = named.map(node => USB_IDS[node % 24] + '@' + (node < 24 ? 1 : 2));
  report.equal('Zuordnung stimmt mit der Wahrheit überein', await ports(), truth);
  report.equal('Alle 48 Knoten durch Durchgänge bestätigt (✓)', await page.locator('.cn-pin.is-ok').count(), 48);
  report.check('Gleichwertige Alternativen (Drehung, Spiegelung, Seiten) werden genannt', /Steckorientierung gedreht/.test(await page.textContent('.cn-cand.is-current')));

  // manual correction: give A2 on side 1 the port of A3 → A3 becomes free, pair TX1 half assigned
  const portA3 = truth.indexOf('A3@1'), portA2 = truth.indexOf('A2@1');
  await page.click(pin('A2@1'));
  await page.waitForSelector('#cn-port');
  await page.selectOption('#cn-port', String(portA3));
  report.check('Manuell: Port von A3 auf A2 gezogen → A3 frei, keine Doppelbelegung', await page.evaluate(() => document.querySelector('.cn-pin[data-node="A3@1"]').classList.contains('is-free')) && (await ports())[portA3] === 'A2@1' && (await ports())[portA2] === null);
  report.check('… und „Paar TX1 Seite 1 nur halb zugeordnet“ wird gemeldet', /TX1 Seite 1 nur halb zugeordnet/.test(await page.textContent('.cn-issues')));
  await page.selectOption('select.cn-node[data-port="' + portA2 + '"]', 'A3@1');
  report.equal('Korrektur über die Porttabelle: Paar wieder vollständig (A2/A3 vertauscht)', [(await ports())[portA2], (await ports())[portA3]], ['A3@1', 'A2@1']);
  await page.click(pin('A3@1'));          // A2 is still selected; a second click on it would deselect it
  report.equal('Auswahl wechselt auf A3 (ein Klick auf den gewählten Kontakt hebt die Auswahl auf)', await page.getAttribute(pin('A3@1'), 'aria-pressed'), 'true');
  await page.click('button[data-action="cn-swap"][data-value="TX1|1"]');
  report.equal('„Polarität von TX1 tauschen · nur Seite 1“ stellt Seite 1 richtig, Seite 2 bleibt', [(await ports())[portA2], (await ports())[portA3], (await ports())[truth.indexOf('A2@2')]], ['A2@1', 'A3@1', 'A2@2']);
  report.equal('Nach den Korrekturen wieder alle Knoten bestätigt', await page.locator('.cn-pin.is-ok').count(), 48);
  await page.click('button[data-action="cn-zoom"][data-value="in"]');
  report.check('Zoom ändert die Zeichnung, nicht die Daten', /scale\(1\.25\)/.test(await page.getAttribute('.cn-zoom', 'transform')));
  await page.click('button[data-action="cn-zoom"][data-value="reset"]');

  // apply USB 3.2 Gen 2x2
  await page.selectOption('#cn-config', 'gen2x2');
  report.equal('Gen 2×2 wählt TX1, RX1, TX2, RX2', await page.evaluate(() => [...document.querySelectorAll('#cn-apply-form input[type=checkbox]:checked')].map(x => x.name)), ['pair-TX1', 'pair-RX1', 'pair-TX2', 'pair-RX2']);
  await page.click('#cn-apply-form button[type=submit]');
  await ready(); await page.waitForSelector('.cn-matrix');
  report.check('Übernahme: 8 Paare, übrige Ports angepasst abgeschlossen', /^8 Paare aus der Zuordnung übernommen · übrige Ports angepasst abgeschlossen/.test(await toast()), await toast());
  report.equal('Kanaltabelle: 4 Lanes', await page.locator('section.config-card:has(h2:text-is("Kanäle")) tbody tr').count(), 4);
  const il = await page.evaluate(() => [...document.querySelectorAll('section.config-card:has(h2) tbody tr')].find(tr => /TX1/.test(tr.textContent))?.querySelectorAll('td')[1]?.textContent);
  report.check('SDD21 von TX1 nahe 0 dB (kurzer Connector)', /^-?0[.,]\d+ dB$/.test(il || ''), il);
  const cell = await page.$$eval('.cn-cell', cells => cells.map(c => [c.dataset.value, c.textContent]));
  report.check('Matrix 8×8 (Differential), Beschriftung IL/NEXT/FEXT aus der Zuordnung', cell.length === 64 && cell.some(([, t]) => /IL/.test(t)) && cell.some(([, t]) => /NEXT/.test(t)) && cell.some(([, t]) => /FEXT/.test(t)));
  const next = cell.find(([, t]) => /NEXT/.test(t))[0];
  await page.click('.cn-cell[data-value="' + next + '"]');
  await ready(); await page.waitForTimeout(400);
  report.equal('Klick auf ein Matrixfeld öffnet die Kurve im S-Parameter-Tab', await page.textContent('#page-title'), 'S-Parameter');
  report.check('… mit genau diesem Pfad als Kurve', await page.evaluate(() => document.querySelectorAll('.trace-row, .legend-row, [data-trace]').length > 0) && (await page.evaluate(() => JSON.stringify(document.body.innerText.match(/Sdd\d+/g)))).length > 2);

  // template: save, clear, apply again
  await toConnector();
  const before = await ports();
  await page.click('button[data-action="cn-save"]');
  await page.waitForFunction(() => /Vorlage „.+“ gespeichert/.test(document.getElementById('toast').textContent));
  await page.click('button[data-action="cn-clear"]');
  report.equal('Zuordnung leeren', (await ports()).filter(Boolean).length, 0);
  await page.selectOption('#cn-template', '0');
  report.equal('Gespeicherte Vorlage wieder angewendet', await ports(), before);
  // export / import
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="cn-export"]')]);
  const file = path.join(work, download.suggestedFilename()); await download.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  report.check('Export: versioniertes Format mit Profil, Revision und Portzahl', json.schema === 'simonlation.port-map' && json.version === 1 && json.profile.id === 'usb-c-receptacle-thru' && json.ports === 48 && json.map.length === 48);
  await page.click('button[data-action="cn-clear"]');
  await page.setInputFiles('#cn-file', file);
  await page.waitForFunction(() => /Zuordnung „.+“ geladen/.test(document.getElementById('toast').textContent));
  report.equal('Import der exportierten Zuordnung', await ports(), before);

  // ---------- USB-C, block order (no names) ----------
  await open('usb_block.s48p'); await toConnector();
  report.equal('Ohne Namen, Ports in Kontaktreihenfolge: „Wahrscheinlich zugeordnet“', await detect(), 'Wahrscheinlich zugeordnet');
  report.check('Begründung: Konvention, durch Durchgänge und Nachbarkopplung gestützt', /Ports 1–24 Seite 1/.test(await page.textContent('.cn-cand.is-current')) && /Durchgänge 100 %/.test(await page.textContent('.cn-cand.is-current')));
  report.check('Datengetriebene Alternative als „Mehrere mögliche Zuordnungen“ gelistet', await page.evaluate(() => [...document.querySelectorAll('.cn-cand')].some(li => /Mehrere mögliche/.test(li.textContent) && /Messdaten/.test(li.textContent))));
  await page.click('button[data-action="cn-transform"][data-value="flip"]');
  report.equal('„Steckorientierung gedreht“ bildet A2 auf B2 ab', (await ports())[1], 'B2@1');
  await page.click('button[data-action="cn-transform"][data-value="flip"]');

  // ---------- reload: mapping and analysis survive ----------
  await open('usb_named.s48p');
  await page.reload(); await ready();
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'usb_named.s48p', null, { timeout: 30000 });
  await toConnector();
  report.equal('Nach F5: Zuordnung erhalten', await ports(), before);
  report.check('Nach F5: übernommene Kanäle und Matrix erhalten', await page.locator('.cn-matrix').count() === 1 && await page.locator('.cn-cell').count() === 64);

  // ---------- Ethernet: LAN magnetics S6P ----------
  await open('lan.s6p'); await toConnector();
  report.equal('S6P: Profil LAN-Magnetics S6P vorgewählt', await page.inputValue('#cn-profile'), 'lan-magnetics-6p');
  report.equal('S6P: „Wahrscheinlich zugeordnet“ (Seitenname und Primär-+ aus der Portreihenfolge)', await detect(), 'Wahrscheinlich zugeordnet');
  report.equal('S6P: Mittelanzapfungen P2/P5, gleichsinnige Sekundärseite', await ports(), ['P1+', 'P1CT', 'P1−', 'S1+', 'S1CT', 'S1−']);
  report.check('S6P: Übertragersymbol mit Punkten in der Pinansicht', await page.locator('.cn-coil').count() === 2 && await page.locator('.cn-dot').count() === 2);
  await page.click('#cn-apply-form button[type=submit]'); await ready(); await page.waitForSelector('.cn-matrix');
  report.check('S6P: 2 Paare übernommen, Mittelanzapfungen offen', /^2 Paare aus der Zuordnung übernommen/.test(await toast()) &&
    JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#cn-apply-form select[name=taps]')].map(s => s.value))) === '["open"]');
  const lanIl = await page.evaluate(() => [...document.querySelectorAll('section.config-card tbody tr')].find(tr => /Kanal 1/.test(tr.textContent))?.querySelectorAll('td')[1]?.textContent);
  report.check('S6P: Kanal 1 primär → sekundär mit SDD21 (Einfügedämpfung des Übertragers)', /^-?\d+[.,]\d+ dB$/.test(lanIl || '') && parseFloat(lanIl.replace(',', '.')) > -3, lanIl);
  report.check('S6P: Matrix beschriftet P→S als IL, nicht als NEXT', await page.evaluate(() => [...document.querySelectorAll('.cn-cell')].some(b => /D\d · P1 ← D\d · S1|D\d · S1 ← D\d · P1/.test(b.title) && /IL/.test(b.textContent))));
  await page.click('#tab-cmc'); await ready(); await page.waitForTimeout(500);
  report.check('S6P: ESB-Tab arbeitet mit den übernommenen Paaren (Übertrager)', /Übertrager/.test(await page.textContent('#view-controls')), await page.textContent('#view-controls'));

  // ---------- Ethernet: RJ45 16 ports, 1000BASE-T ----------
  await open('rj45.s16p'); await toConnector();
  report.equal('RJ45 · 16 Ports: „Wahrscheinlich zugeordnet“', await detect(), 'Wahrscheinlich zugeordnet');
  await page.selectOption('#cn-config', '1000');
  await page.click('#cn-apply-form button[type=submit]'); await ready(); await page.waitForSelector('.cn-matrix');
  report.check('1000BASE-T: 8 Paare (4 Paare × 2 Seiten)', /^8 Paare aus der Zuordnung übernommen/.test(await toast()));
  report.equal('1000BASE-T: Kanaltabelle mit 4 Paaren', await page.locator('section.config-card:has(h2:text-is("Kanäle")) tbody tr').count(), 4);

  // ---------- phone width ----------
  await page.setViewportSize({ width: 390, height: 840 });
  await page.waitForTimeout(300);
  report.check('Handy (390 px): Seite läuft nicht seitlich über, Zeichnung scrollt in ihrem Rahmen', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  report.check('Handy: Kontakte sind mindestens 30 px groß', await page.evaluate(() => { const r = document.querySelector('.cn-pin rect').getBoundingClientRect(); return r.width >= 30 && r.height >= 26; }));

  report.equal('Keine Fehler in der Konsole', errors, []);
} catch (error) {
  report.check('Ablauf ohne Ausnahme', false, error.stack);
  await page.screenshot({ path: path.join(work, 'fail-connector.png') }).catch(() => {});
  console.log('Screenshot: ' + path.join(work, 'fail-connector.png'));
} finally {
  await context.close().catch(() => {});
  srv.close();
}
process.exit(report.done() ? 0 : 1);
