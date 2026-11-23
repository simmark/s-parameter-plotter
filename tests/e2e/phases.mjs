// Phasen 2, 3, 5 und 6 im Browser: Port-Map-Datei und Kanalprüfung, Übersprechen und Laufzeit, Dreileitergruppen (0/α/β),
// Zeitbereich (Sprung, Impuls, TDR) und Augendiagramm, Speichern über Neuladen, englische Oberfläche, Handy-Breite.
// Synthetische Daten aus tests/connector-fixture.mjs und analytische Fälle; keine Herstellerdateien.
import path from 'node:path';
import { serve, launch, tempDir, Report } from './lib.mjs';
import { connectorCircuit, touchstone, logf, RJ45_POSITIONS } from '../connector-fixture.mjs';

const report = new Report('Phasen 2/3/5/6');
const srv = await serve(), work = tempDir('spa-ph-files-');
let { context, page, errors } = await launch(tempDir('spa-ph-'));
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const open = async name => {
  await page.click('.session-open[data-key="' + name + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready(); await page.waitForTimeout(200);
};

// data: RJ45 thru (16 ports) with a port-map file; 3-phase choke (6 ports); a matched line |S21| = 0.8, 0.4 ns (2 ports)
const order = [...Array(16).keys()], rjFreq = logf(1e6, 3e9, 41);
const rjText = touchstone(connectorCircuit(RJ45_POSITIONS), rjFreq, order);
const ports = order.map(i => ({ port: i + 1, pin: String(i % 8 + 1), signal: ['P1+', 'P1-', 'P2+', 'P3+', 'P3-', 'P2-', 'P4+', 'P4-'][i % 8], side: i < 8 ? 'PCB' : 'CABLE', role: 'signal' }));
const pairs = ['PCB', 'CABLE'].flatMap((side, s) => [[1, 2, 'P1'], [3, 6, 'P2'], [4, 5, 'P3'], [7, 8, 'P4']].map(([p, q, pair]) => ({ side, pair, positive_port: p + 8 * s, negative_port: q + 8 * s })));
const portMap = JSON.stringify({ schema: 'simonlation.portmap.v1', model: 'rj45-test', number_of_ports: 16, ports, differential_pairs: pairs });
const L = 850e-6, k = 0.985, cmc = { nodes: 6, branches: [0, 1, 2].map(u => ({ a: u, b: u + 3, r: 0.05, l: L })), L: [[0, 1, k * L], [0, 2, k * L], [1, 2, k * L]], C: [] };
const lineFreq = logf(1e4, 1e10, 41);
const lineText = '# HZ S RI R 50\n' + lineFreq.map(f => { const p = -2 * Math.PI * f * 0.4e-9, re = 0.8 * Math.cos(p), im = 0.8 * Math.sin(p); return f + ' 0 0 ' + re + ' ' + im + ' ' + re + ' ' + im + ' 0 0'; }).join('\n') + '\n';

try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'rj45.s16p', mimeType: 'text/plain', buffer: Buffer.from(rjText) },
    { name: 'cmc3.s6p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(cmc, logf(1e2, 1e7, 41), [0, 1, 2, 3, 4, 5])) },
    { name: 'line.s2p', mimeType: 'text/plain', buffer: Buffer.from(lineText) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '3', null, { timeout: 90000 });

  // ---------- port-map file, channel check, crosstalk (phase 2) ----------
  await open('rj45.s16p');
  await page.click('#tab-connector'); await page.waitForSelector('#cn-profile', { state: 'visible' });
  report.check('„Port-Map-Datei laden“ ist auch ohne gewähltes Profil da', await page.locator('#connector-panel button[data-action="cn-import"]').count() >= 1);
  await page.setInputFiles('#cn-file', { name: 'rj45.portmap.json', mimeType: 'application/json', buffer: Buffer.from(portMap) });
  await page.waitForFunction(() => /^file:/.test(document.getElementById('cn-profile').value));
  report.check('Port-Map geladen: eigenes Profil „Port-Map · rj45-test“ ausgewählt', /Port-Map · rj45-test/.test(await page.textContent('#cn-profile option:checked')));
  report.equal('Pinansicht: 16 Anschlüsse, 16 durch die Kanalprüfung bestätigt', [await page.locator('.cn-pin').count(), await page.locator('.cn-pin.is-ok').count()], [16, 16]);
  const checkRows = await page.$$eval('#connector-panel table', tables => { const t = tables.find(x => /Polarität/.test(x.textContent)); return t ? [...t.querySelectorAll('tbody tr')].map(r => r.textContent) : []; });
  report.check('Kanalprüfung ohne Phasenbezug: 4 Kanäle mit Durchgang, Polarität „unbestimmt“', checkRows.length === 4 && checkRows.every(r => /Polarität unbestimmt/.test(r)), checkRows.join(' | ').slice(0, 300));
  // With a polarity reference in the port map the sign is decided (lumped test circuit, delay far below 1 ns).
  const REF = { source: 'Synthetische Testschaltung', maxDelaySeconds: 1e-9, maxFrequencyHz: 3e9, response: 'noninverting-baseband' };
  const refMap = { ...JSON.parse(portMap), model: 'rj45-ref', polarityReference: REF };
  await page.setInputFiles('#cn-file', { name: 'ref.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(refMap)) });
  await page.waitForFunction(() => document.getElementById('cn-profile').value === 'file:rj45-ref');
  const refRows = await page.$$eval('#connector-panel table', tables => { const t = tables.find(x => /Polarität/.test(x.textContent)); return t ? [...t.querySelectorAll('tbody tr')].map(r => r.textContent) : []; });
  report.check('Mit Phasenbezug: 4 Kanäle „richtig gepolt“, Bezug genannt', refRows.length === 4 && refRows.every(r => /richtig gepolt/.test(r) && /Synthetische Testschaltung/.test(r)), refRows.join(' | ').slice(0, 300));
  // wrong polarity in the file → reported as swapped, pins marked
  const badMap = JSON.parse(portMap); badMap.model = 'rj45-bad'; badMap.polarityReference = REF; const p2 = badMap.differential_pairs.find(x => x.side === 'CABLE' && x.pair === 'P2'); [p2.positive_port, p2.negative_port] = [p2.negative_port, p2.positive_port];
  await page.setInputFiles('#cn-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badMap)) });
  await page.waitForFunction(() => document.getElementById('cn-profile').value === 'file:rj45-bad');
  report.check('Mit Phasenbezug: vertauschte Polarität in der Datei wird „+ und − an einem Ende vertauscht“, 4 Pins mit „!“', /an einem Ende vertauscht/.test(await page.textContent('#connector-panel')) && await page.locator('.cn-pin.is-conflict').count() === 4);
  await page.setInputFiles('#cn-file', { name: 'rj45.portmap.json', mimeType: 'application/json', buffer: Buffer.from(portMap) });
  await page.waitForFunction(() => document.getElementById('cn-profile').value === 'file:rj45-test');
  await page.click('#cn-apply-form button[type=submit]'); await ready(); await page.waitForSelector('.mini-chart');
  const xt = await page.$$eval('#connector-panel table', tables => { const t = tables.find(x => /PSNEXT/.test(x.textContent)); return t ? [...t.querySelectorAll('tbody tr')].map(r => [...r.children].map(c => c.textContent.trim())) : []; });
  report.check('Übersprechen und Laufzeit: 4 Kanäle mit Laufzeit, Skew und PSNEXT', xt.length === 4 && xt.every(r => /ps$/.test(r[1]) && /dB/.test(r[4])), JSON.stringify(xt[1]));
  report.check('Diagramm mit IL, PSNEXT (beide Enden), PSFEXT und Konversion', (await page.textContent('.mini-legend')).match(/SDD21|PSNEXT|PSFEXT|SCD21/g)?.length >= 5);
  await page.selectOption('#cn-xt-channel', 'P3'); await page.waitForTimeout(200);
  report.equal('Kanal im Diagramm umschaltbar', await page.inputValue('#cn-xt-channel'), 'P3');

  // ---------- three-conductor groups (phase 3) ----------
  await open('cmc3.s6p');
  await page.click('#tab-ports'); await page.waitForTimeout(300);
  while (await page.locator('button[data-action="remove-pair"]').count()) { await page.locator('button[data-action="remove-pair"]').first().click(); await page.waitForTimeout(250); }
  await page.click('button[data-action="triple-preset"]'); await ready();
  report.equal('Vorlage (1,2,3)(4,5,6): zwei Dreileitergruppen', await page.locator('button[data-action="triple-remove"]').count(), 2);
  report.check('Physische Ports zeigen „Gruppe T1 · L1“ … statt Lastauswahl', /Gruppe T1 · L1/.test(await page.textContent('#config-panel')) && /Gruppe T2 · L3/.test(await page.textContent('#config-panel')));
  await page.click('#tab-s'); await ready(); await page.waitForTimeout(300);
  const traces = await page.$$eval('.trace-row', rows => rows.map(r => [r.querySelector('.trace-name').textContent, r.querySelector('.trace-value').textContent]));
  report.equal('Standardkurven: S00·21, Sαα·21, Sββ·21, Sα0·21', traces.map(t => t[0]), ['S00·21', 'Sαα·21', 'Sββ·21', 'Sα0·21']);
  report.check('Statuszeile nennt die Gruppen', /2 Dreileitergruppen/.test(await page.textContent('#page-context')));
  report.check('Legende: 0-Mode, α/β-Moden, Konversion', /0-Mode/.test(await page.textContent('#trace-panel')) && /α\/β-Moden/.test(await page.textContent('#trace-panel')));
  // a port that becomes part of a pair dissolves its group, with a notice
  await page.click('#tab-ports'); await page.click('button[data-action="triple-remove"][data-value="2"]'); await ready();
  report.equal('Gruppe T2 aufgelöst, T1 bleibt', await page.locator('button[data-action="triple-remove"]').count(), 1);

  // ---------- time domain (phase 5) ----------
  await open('line.s2p');
  await page.click('#tab-time'); await page.waitForSelector('#td-form');
  report.equal('Zeitbereich: Standardkurve ist eine Übertragung (S21)', [await page.inputValue('#td-form select[name=row]'), await page.inputValue('#td-form select[name=col]')], ['P2', 'P1']);
  const facts = await page.textContent('#time-panel .cn-facts');
  report.check('Laufzeit (50 %) 400,0 ps, Endwert 0,8000', /400\.0 ps/.test(facts) && /0\.8000/.test(facts), facts.replace(/\s+/g, ' ').slice(0, 160));
  report.check('Hinweise: logarithmische Abtastung, wenige Punkte, geführte Entfaltung', ['Logarithmische Abtastung', 'Nur 41 Frequenzpunkte', 'Laufzeit-Kontinuität'].every(x => facts !== null) && await page.locator('#time-panel .cn-issues li').count() === 3);
  report.check('TDR wird nur für Reflexionen angeboten', !(await page.$$eval('#td-form select[name=mode] option', o => o.map(x => x.value))).includes('tdr'));
  await page.selectOption('#td-form select[name=row]', 'P1'); await page.click('#td-form button[type=submit]'); await page.waitForTimeout(200);
  await page.selectOption('#td-form select[name=mode]', 'tdr'); await page.click('#td-form button[type=submit]'); await page.waitForTimeout(200);
  report.check('S11 einer angepassten Leitung: TDR-Diagramm gezeichnet', /TDR S11/.test(await page.textContent('#time-panel .mini-legend')));
  await page.selectOption('#td-form select[name=row]', 'P2'); await page.selectOption('#td-form select[name=mode]', 'step'); await page.click('#td-form button[type=submit]'); await page.waitForTimeout(200);
  await page.fill('#td-form input[name=rise]', '100'); await page.click('#td-form button[type=submit]'); await page.waitForTimeout(200);
  report.check('Gauß-Flanke 100 ps: Anstieg ≈ √(100² + Fensteranteil²) ps', (r => r > 95 && r < 160)(Number((await page.textContent('#time-panel .cn-facts')).match(/Anstieg 10–90 % ([\d.]+) ps/)?.[1])), (await page.textContent('#time-panel .cn-facts')).match(/Anstieg 10–90 % [\d.]+ ps/)?.[0]);

  // ---------- eye diagram (phase 6) ----------
  await page.fill('#td-form input[name=rise]', ''); await page.click('#td-form button[type=submit]'); await page.waitForTimeout(200);
  await page.fill('#eye-form input[name=rate]', '2'); await page.click('#eye-form button[type=submit]'); await page.waitForSelector('.eye-img');
  const eye = await page.locator('#time-panel .cn-facts').nth(1).textContent();
  report.check('Auge bei 2 Gbit/s, ±0,5 V: Höhe 0,80 V, Breite 1,00 UI', /^0\.80\d\d V/.test(eye.replace(/^Augenhöhe/, '')) && /1\.00 UI/.test(eye), eye.replace(/\s+/g, ' ').slice(0, 120));
  report.check('Peak-Distortion (schlechtester Fall) wird mit Cursor und ISI genannt', /Peak-Distortion: Hauptcursor/.test(eye));
  await page.fill('#eye-form input[name=rate]', '0'); await page.click('#eye-form button[type=submit]'); await page.waitForTimeout(200);
  report.check('Bitrate 0 wird abgelehnt', /müssen positiv sein/.test(await page.textContent('#toast')));

  // ---------- reload keeps tab, curve and settings ----------
  await page.waitForTimeout(500); await page.reload(); await ready(); await page.waitForTimeout(500);
  await page.waitForSelector('#td-form');
  report.equal('Neuladen: Zeitbereich, Kurve und Darstellung bleiben', [await page.inputValue('#td-form select[name=row]'), await page.inputValue('#td-form select[name=mode]')], ['P2', 'step']);
  await open('cmc3.s6p'); await page.click('#tab-ports');
  report.equal('Neuladen: Dreileitergruppe der 6-Port-Datei bleibt', await page.locator('button[data-action="triple-remove"]').count(), 1);
  await open('rj45.s16p'); await page.click('#tab-connector'); await page.waitForSelector('#cn-profile');
  report.equal('Neuladen: Port-Map-Profil der Datei bleibt (in der Sitzung gespeichert)', await page.inputValue('#cn-profile'), 'file:rj45-test');
  report.equal('Keine JavaScript-Fehler', errors, []);
  await context.close();

  // ---------- English ----------
  ({ context, page, errors } = await launch(tempDir('spa-ph-en-'), { lang: 'en-US' }));
  const GERMAN = /[äöüßÄÖÜ]|\b(Datei|Kanal|Kanäle|Laufzeit|Zeitbereich|Sprungantwort|Fenster|Gruppe|Leiter|nicht|wird|werden|und|oder|der|die|das|ist|sind|mit|bei|aus|Abtastung|Augenhöhe|Muster|Übersprechen|Polarität|richtig|vertauscht)\b/;
  const german = async (name, selector) => {
    const hits = await page.evaluate(sel => { const out = [], root = document.querySelector(sel); if (!root) return out; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; if (!el || el.closest('[data-no-i18n], script, style, .mono, option') || !n.nodeValue.trim()) continue; out.push(n.nodeValue.trim()); } return out; }, selector);
    report.equal(name + ' ist englisch', hits.filter(t => GERMAN.test(t)).slice(0, 6), []);
  };
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [{ name: 'rj45.s16p', mimeType: 'text/plain', buffer: Buffer.from(rjText) }, { name: 'line.s2p', mimeType: 'text/plain', buffer: Buffer.from(lineText) }, { name: 'cmc3.s6p', mimeType: 'text/plain', buffer: Buffer.from(touchstone(cmc, logf(1e2, 1e7, 41), [0, 1, 2, 3, 4, 5])) }]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '3', null, { timeout: 90000 });
  await open('rj45.s16p'); await page.click('#tab-connector'); await page.waitForSelector('#cn-profile');
  await page.setInputFiles('#cn-file', { name: 'rj45.portmap.json', mimeType: 'application/json', buffer: Buffer.from(portMap) });
  await page.waitForFunction(() => /^file:/.test(document.getElementById('cn-profile').value));
  await german('Port-Map, Kanalprüfung', '#connector-panel'); await german('Meldung nach dem Laden der Port-Map', '#toast');
  await page.click('#cn-apply-form button[type=submit]'); await ready(); await page.waitForSelector('.mini-chart');
  await german('Übersprechen und Laufzeit', '#connector-panel');
  await open('cmc3.s6p'); await page.click('#tab-ports'); await page.waitForTimeout(300);
  while (await page.locator('button[data-action="remove-pair"]').count()) { await page.locator('button[data-action="remove-pair"]').first().click(); await page.waitForTimeout(250); }
  await german('Dreileitergruppen (leer)', '#config-panel');
  await page.click('button[data-action="triple-preset"]'); await ready();
  await german('Dreileitergruppen', '#config-panel');
  await page.click('#tab-s'); await ready(); await german('Legende 0/α/β', '#trace-panel'); await german('Statuszeile', '#page-context');
  await open('line.s2p'); await page.click('#tab-time'); await page.waitForSelector('#td-form');
  await german('Zeitbereich', '#time-panel');
  await page.fill('#eye-form input[name=rate]', '2'); await page.click('#eye-form button[type=submit]'); await page.waitForSelector('.eye-img');
  await german('Augendiagramm', '#time-panel');
  report.check('Englische Kennwerte im Auge', /inner, best sampling instant/.test(await page.textContent('#time-panel')));
  report.equal('Keine JavaScript-Fehler (englisch)', errors, []);
  await context.close();

  // ---------- phone width ----------
  ({ context, page, errors } = await launch(tempDir('spa-ph-m-'), { mobile: true }));
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [{ name: 'line.s2p', mimeType: 'text/plain', buffer: Buffer.from(lineText) }]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1', null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.session-open[data-key="line.s2p"]').click());
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'line.s2p'); await ready(); await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('tab-time').click()); await page.waitForSelector('#td-form');
  await page.evaluate(() => { document.querySelector('#eye-form input[name=rate]').value = '2'; document.querySelector('#eye-form').requestSubmit(); }); await page.waitForSelector('.eye-img');
  report.check('Handy (390 px): Zeitbereich mit Auge läuft nicht seitlich über', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  report.equal('Keine JavaScript-Fehler (Handy)', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-phases.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-phases.png'));
}
await context.close().catch(() => {}); await srv.close();
process.exit(report.done() ? 0 : 1);
