// Erweiterungspunkte: Ein neues Fachmodul wird nur als Datei unter src/app/module/ abgelegt. Der Test baut die App mit einem
// Probemodul in einem Temp-Ordner und prüft: Tab und Panel entstehen, Aktion und Auswahlliste wirken, der Dateizustand übersteht
// einen Dateiwechsel und ein Neuladen. An keiner anderen Datei wird etwas geändert.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, serve, launch, tempDir, touchstone, waitIdle, Report } from './lib.mjs';

const report = new Report('Erweiterungspunkte');
const app = tempDir('spa-ext-app-'), profile = tempDir('spa-ext-'), work = tempDir('spa-ext-files-');
for (const item of ['src', 'tools', 'icons', 'index.html', 'sw.js', 'manifest.webmanifest', 'LICENSE.txt']) fs.cpSync(path.join(ROOT, item), path.join(app, item), { recursive: true });
fs.writeFileSync(path.join(app, 'src/app/module/probe.js'), `// module/probe – nur für den Test: ein neues Fachmodul ohne Änderung an anderen Dateien.
import { $ } from '../basis/dom.js';
import { registerActions, registerChanges, registerFileState, registerSlot, registerView } from '../basis/erweiterung.js';
import { state } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';

function renderProbe() {
  $('probe-panel').innerHTML = '<p id="probe-count">' + state.probe.count + '</p><p id="probe-mode">' + state.probe.mode + '</p>' +
    '<button type="button" id="probe-add" data-action="probe-add">Plus</button>' +
    '<select id="probe-select" data-change="probe-mode"><option value="a">a</option><option value="b"' + (state.probe.mode === 'b' ? ' selected' : '') + '>b</option></select>';
}

registerView({ id: 'probe', title: 'Probeansicht', short: 'Probe', after: 'ports', iconPath: 'M4 4h16v16H4z', panel: 'probe-panel', render: renderProbe, context: 'Nur für den Test' });
registerSlot('marker-tools', () => '<button type="button" id="probe-slot" class="button">Probe</button>');
registerActions({ 'probe-add': () => { state.probe.count++; persistSettings(); renderProbe(); } });
registerChanges({ 'probe-mode': value => { state.probe.mode = value; } });
registerFileState('probe', {
  blank: () => ({ count: 0, mode: 'a' }),
  save: p => ({ count: p.count, mode: p.mode }),
  load: p => typeof p === 'object' ? { count: Number.isInteger(p.count) ? p.count : 0, mode: p.mode === 'b' ? 'b' : 'a' } : undefined,
});
`);
execFileSync('python3', [path.join(app, 'tools/build.py'), app], { stdio: 'pipe' });
fs.writeFileSync(path.join(work, 'eins.s2p'), touchstone(2, 1));
fs.writeFileSync(path.join(work, 'zwei.s2p'), touchstone(2, 2));

const srv = await serve(app);
const { context, page, errors } = await launch(profile);
const text = id => page.textContent('#' + id);
try {
  await page.goto(srv.url);
  await page.waitForSelector('#session-files', { state: 'attached' });
  report.check('Tab-Knopf der neuen Ansicht ist angelegt', await page.isVisible('#tab-probe'));
  report.check('Panel der neuen Ansicht ist angelegt und verborgen', await page.$eval('#probe-panel', el => el.hidden));
  const tabs = await page.$$eval('[role=tab]', n => n.map(t => t.id));
  report.equal('Tab steht an der gewünschten Stelle (after: ports)', tabs[tabs.indexOf('tab-ports') + 1], 'tab-probe');
  report.check('Eigenes Symbol ist in der Symbolsammlung und im Tab', await page.$eval('#tab-probe use', u => u.getAttribute('href')) === '#i-probe' && await page.locator('svg.symbol-bank symbol#i-probe').count() === 1);
  await page.setInputFiles('#file-input', [path.join(work, 'eins.s2p'), path.join(work, 'zwei.s2p')]);
  await waitIdle(page);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '2');
  await page.waitForSelector('#probe-slot');
  report.check('Beitrag zur Markerleiste (registerSlot) erscheint', await page.isVisible('#probe-slot'));
  await page.click('#tab-probe');
  await page.waitForSelector('#probe-count');
  report.equal('Neue Datei beginnt mit dem Grundwert', await text('probe-count'), '0');
  report.equal('Seitentitel kommt aus der Anmeldung', await text('page-title'), 'Probeansicht');
  report.equal('Kontextzeile kommt aus der Anmeldung', await text('page-context'), 'Nur für den Test');
  report.check('Diagrammbereich ist verborgen, Panel sichtbar', await page.$eval('#analysis-panel', el => el.hidden) && await page.$eval('#probe-panel', el => !el.hidden));
  report.equal('Tab ist ausgewählt', await page.getAttribute('#tab-probe', 'aria-selected'), 'true');
  await page.click('#probe-add'); await page.click('#probe-add');
  report.equal('Aktion wirkt', await text('probe-count'), '2');
  await page.selectOption('#probe-select', 'b');
  await page.waitForFunction(() => document.getElementById('probe-mode')?.textContent === 'b');
  report.equal('Auswahlliste wirkt und der Rahmen baut neu auf', await text('probe-mode'), 'b');
  const first = await page.getAttribute('#session-files', 'data-current');
  const other = await page.$$eval('.session-open', els => els.map(e => e.dataset.key));
  await page.click('.session-open[data-key="' + other.find(k => k !== first) + '"]');
  await page.waitForFunction(key => document.getElementById('session-files').dataset.current !== key, first);
  await page.waitForSelector('#probe-count');
  // like every other setting, the state is carried over to a file of the same structure that has no settings of its own
  report.equal('Andere Datei übernimmt die Einstellung der vorigen (wie alle Einstellungen)', await text('probe-count'), '2');
  await page.click('#probe-add');
  report.equal('… und behält danach ihren eigenen Stand', await text('probe-count'), '3');
  await page.click('.session-open[data-key="' + first + '"]');
  await page.waitForFunction(key => document.getElementById('session-files').dataset.current === key, first);
  await page.waitForFunction(() => document.getElementById('probe-count')?.textContent === '2', null, { timeout: 10000 }).catch(() => {});
  report.equal('Zurück zur ersten Datei: Zustand ist wieder da', await text('probe-count'), '2');
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('probe-count')?.textContent === '2', null, { timeout: 15000 }).catch(() => {});
  report.equal('Nach dem Neuladen: Tab und Zustand sind wieder da', [await page.getAttribute('#tab-probe', 'aria-selected'), await text('probe-count'), await text('probe-mode')], ['true', '2', 'b']);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, error.message.split('\n')[0]);
}
report.check('Keine JavaScript-Fehler', !errors.length, errors.join(' | '));
// A name registered twice stops the app at load time with a clear message instead of silently replacing a handler.
fs.writeFileSync(path.join(app, 'src/app/module/doppelt.js'), "// module/doppelt – nur für den Test.\nimport { registerActions } from '../basis/erweiterung.js';\n\nregisterActions({ tab: () => {} });\n");
execFileSync('python3', [path.join(app, 'tools/build.py'), app], { stdio: 'pipe' });
await context.close();
const second = await launch(tempDir('spa-ext2-'));
await second.page.goto(srv.url);
await second.page.waitForTimeout(1500);
report.check('Doppelt angemeldete Aktion meldet sich beim Laden', second.errors.some(e => /Aktion doppelt angemeldet: tab/.test(e)), second.errors.join(' | '));
await second.context.close();
await srv.close();
process.exit(report.done() ? 0 : 1);
