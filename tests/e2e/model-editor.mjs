// ESB-Modell-Editor: Werte eingeben, Regler, festhalten, optimieren, Marker als Startwert und als Fitfenster,
// Modell und Messung gleichzeitig, Messdaten unverändert, SPICE-Export des bearbeiteten Modells und Reimport.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, Report, logFreqs, inductorZ, capacitorZ, fixtureS2P, optimize } from './lib.mjs';

const report = new Report('ESB · Modell-Editor');
const srv = await serve(), work = tempDir('spa-me-files-');
const { context, page, errors } = await launch(tempDir('spa-me-'));
const freqs = logFreqs(1e4, 3e9, 301), L = 10e-6, C = 5e-12;
const coil = inductorZ({ L, C, R: 0.2, Rp: 30e3 });
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const num = text => { const m = String(text).replace(/\s/g, '').replace(',', '.').match(/^([\d.eE+-]+)(f|p|n|µ|m|k|M|G)?/); return Number(m[1]) * (SI[m[2]] ?? 1); };
const value = async key => num(await page.inputValue('#model-' + key));
const summary = () => page.evaluate(() => { const s = document.getElementById('model-summary'); return { err: Number(s.dataset.err), phase: Number(s.dataset.phase), edited: s.dataset.edited === '1', text: s.textContent }; });
const toast = () => page.textContent('#toast');
const setValue = async (key, text) => { await page.fill('#model-' + key, text); await page.click('#model-form button[type=submit]'); await page.waitForTimeout(150); };
const marker = async (slot, text) => { await page.fill('#marker-' + slot, text); await page.press('#marker-' + slot, 'Enter'); await page.waitForTimeout(120); };
async function csv() {
  await page.click('#export-button');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="download"][data-value="csv"]')]);
  const file = path.join(work, 'x-' + Date.now() + '.csv'); await download.saveAs(file);
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
  return { head: rows[0].map(h => h.replace(/^"|"$/g, '')), rows: rows.slice(1).map(r => r.map(Number)), text: fs.readFileSync(file, 'utf8') };
}
const fileHash = name => page.evaluate(async name => { const e = (await Store.entries('session')).find(x => x.name === name); return e.hash + ':' + await Store.hashOf(new Uint8Array(await (await Store.fileOf(e)).arrayBuffer())); }, name);
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'Drossel.s2p', mimeType: 'text/plain', buffer: Buffer.from(fixtureS2P(coil, freqs, 'series')) },
    { name: 'Kondensator.s2p', mimeType: 'text/plain', buffer: Buffer.from(fixtureS2P(capacitorZ({ C: 100e-9, ESR: 0.02, ESL: 0.8e-9 }), freqs, 'shunt')) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '2');
  await page.click('.session-open[data-key="Drossel.s2p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Drossel.s2p'); await ready();
  const hashBefore = await fileHash('Drossel.s2p');
  const sBefore = (await csv()).text;
  await page.click('#tab-cmc'); await ready();
  await page.waitForSelector('#model-editor');

  // ---- automatic start ----
  report.equal('Editor zeigt alle Parameter des Modells', await page.$$eval('.model-row', n => n.map(r => r.dataset.key)), ['r0', 'l1', 'c1', 'r1']);
  report.check('Automatische Werte: L₁ = 10 µH, C₁ = 5 pF, R₀ = 0,2 Ω, R₁ = 30 kΩ', Math.abs(await value('l1') / L - 1) < 0.01 && Math.abs(await value('c1') / C - 1) < 0.02 && Math.abs(await value('r0') / 0.2 - 1) < 0.02 && Math.abs(await value('r1') / 3e4 - 1) < 0.02);
  let s = await summary();
  report.check('Gültigkeitsbereich und Fitabweichung (Betrag und Phase) werden angezeigt', /Gültig von 10 kHz bis .* MHz · Abweichung .* dB und .*° RMS · \d+ Punkte · automatischer Fit/.test(s.text) && s.err < 0.01 && s.phase < 0.1, s.text);
  report.check('Schaltbild trägt die Werte des Modells', (await page.$$eval('.model-schematic text.value', n => n.map(t => t.textContent))).join('|') === '200 mΩ|10 µH|5 pF|30 kΩ', (await page.$$eval('.model-schematic text.value', n => n.map(t => t.textContent))).join('|'));

  // ---- manual value: measurement and model together ----
  await setValue('l1', '20 µH');
  s = await summary();
  report.check('Eingabe 20 µH: Modell weicht sichtbar ab, als „von Hand geändert“ gekennzeichnet', s.edited && s.err > 3 && /von Hand geändert/.test(s.text), s.text);
  let data = await csv();
  const iz = data.head.findIndex(h => /^\|Z\|/.test(h)), im = data.head.findIndex(h => /Modell \|Z\|/.test(h)), low = data.rows.find(r => r[0] >= 1e5);
  report.check('Messkurve und Modellkurve liegen gleichzeitig im Diagramm', iz > 0 && im > 0 && Math.abs(low[im] / low[iz] - 2) < 0.02, data.head.join(' | ') + ' · Verhältnis ' + (low[im] / low[iz]).toFixed(3));
  report.check('Messkurve ist dabei unverändert (|Z| = ωL der Messung)', Math.abs(low[iz] / (2 * Math.PI * low[0] * L) - 1) < 0.01);

  // ---- fix a parameter and optimise the rest ----
  await page.check('input[name="fix-l1"]');
  await optimize(page);
  const fixedL = await value('l1'), fixedC = await value('c1'), s2 = await summary();
  report.check('„fest“: L₁ bleibt 20 µH, C₁ passt sich an die Resonanz an (≈ 2,5 pF)', Math.abs(fixedL / 20e-6 - 1) < 1e-3 && Math.abs(fixedC / 2.5e-12 - 1) < 0.15 && s2.err < s.err, (fixedL * 1e6).toFixed(2) + ' µH · ' + (fixedC * 1e12).toFixed(2) + ' pF · ' + s2.err.toFixed(2) + ' dB');
  report.check('Rückmeldung nennt Abweichung und feste Parameter', /Optimiert: .* dB und .*° RMS über \d+ Punkte · 1 fest/.test(await toast()), await toast());
  await page.uncheck('input[name="fix-l1"]');
  await optimize(page);
  const s3 = await summary();
  report.check('Alle frei: Optimierung findet 10 µH und 5 pF wieder (Betrag und Phase)', Math.abs(await value('l1') / L - 1) < 0.01 && Math.abs(await value('c1') / C - 1) < 0.02 && s3.err < 0.05 && s3.phase < 0.5, s3.text);

  // ---- unphysical input is refused ----
  const keep = await value('c1');
  for (const bad of ['-3 pF', '0', 'abc']) { await setValue('c1', bad); }
  report.check('Negative, null und unlesbare Eingaben werden abgelehnt', /Gib einen positiven Wert ein/.test(await toast()));
  await optimize(page);
  await page.click('#tab-s'); await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');
  report.check('…und der gültige Wert bleibt im Modell', Math.abs(await value('c1') / keep - 1) < 0.02, (await value('c1') * 1e12).toFixed(3) + ' pF');
  await setValue('l1', '4,7u'); report.check('Eingabe „4,7u“ wird als 4,7 µH gelesen', Math.abs(await value('l1') / 4.7e-6 - 1) < 1e-3);
  await setValue('l1', '1e-5'); report.check('Eingabe „1e-5“ wird als 10 µH gelesen', Math.abs(await value('l1') / 1e-5 - 1) < 1e-3);

  // ---- slider ----
  const r0 = await value('r0');
  await page.evaluate(() => { const el = document.querySelector('.model-slider[data-key="r0"]'); el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const live = await value('r0');
  report.check('Regler verstellt den Wert live (halbe Dekade = Faktor 3,16)', Math.abs(live / (0.2 * Math.sqrt(10)) - 1) < 0.02 && (await summary()).edited, r0 + ' → ' + live);
  await page.evaluate(() => { const el = document.querySelector('.model-slider[data-key="r0"]'); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  report.check('Nach dem Loslassen steht der Wert im Editor und im Schaltbild', Math.abs(await value('r0') / live - 1) < 1e-3 && /632/.test((await page.$$eval('.model-schematic text.value', n => n[0].textContent))));

  // ---- start value from a marker ----
  await setValue('l1', '30 µH');
  await marker(0, '1 MHz');
  await page.click('button[data-action="model-marker"][data-value="l1"]'); await page.waitForTimeout(200);
  report.check('Marker bei 1 MHz liefert L₁ = X/ω = 10 µH als Startwert', Math.abs(await value('l1') / L - 1) < 0.01 && /L₁ = .* aus dem Marker bei 1[,.]?\d* MHz/.test(await toast()), await toast());
  await marker(0, '200 MHz');
  await page.click('button[data-action="model-marker"][data-value="l1"]'); await page.waitForTimeout(200);
  report.check('Marker oberhalb der Resonanz: verständliche Ablehnung statt negativer Induktivität', /nicht induktiv/.test(await toast()) && Math.abs(await value('l1') / L - 1) < 0.01, await toast());
  await marker(0, '22,5 MHz');
  await setValue('c1', '50 pF');
  await page.click('button[data-action="model-marker"][data-value="c1"]'); await page.waitForTimeout(200);
  report.check('Marker auf der Resonanz liefert C₁ = 1/(ω²L₁) ≈ 5 pF', Math.abs(await value('c1') / C - 1) < 0.05, (await value('c1') * 1e12).toFixed(3) + ' pF');

  // ---- fit window from markers ----
  await marker(0, '100 kHz');
  await page.click('button[data-action="add-marker"]'); await page.waitForTimeout(150);
  await marker(1, '5 MHz');
  await page.click('button[data-action="model-window"][data-value="markers"]'); await page.waitForTimeout(200);
  const expectedPoints = freqs.filter(f => f >= 1e5 * 0.98 && f <= 5e6 * 1.02).length;
  s = await summary();
  const points = Number(s.text.match(/(\d+) Punkte/)[1]);
  report.check('Marker M1 und M2 begrenzen das Fitfenster (100 kHz … 5 MHz)', /Gültig von 10\d[,.]?\d* kHz bis [45][,.]\d* MHz|Gültig von 100 kHz bis 5 MHz/.test(s.text) && Math.abs(points - expectedPoints) <= 2, s.text + ' · erwartet ' + expectedPoints);
  report.check('Fitfenster steht in den Feldern und ist im Diagramm hinterlegt', /kHz/.test(await page.inputValue('#model-form input[name=from]')) && /MHz/.test(await page.inputValue('#model-form input[name=to]')) && /Fit-Band grün hinterlegt/.test(await page.textContent('#plot-hint')));
  // inside this window only L and R0 are visible: a wrong C1 cannot be corrected from these points, with the full range it can
  await setValue('l1', '14 µH');
  await page.check('input[name="fix-c1"]'); await page.check('input[name="fix-r1"]');
  await optimize(page);
  report.check('Fit nutzt nur die Frequenzen im Fenster: L₁ wird aus 100 kHz … 5 MHz bestimmt', Math.abs(await value('l1') / L - 1) < 0.03 && Math.abs(Number((await toast()).match(/über (\d+) Punkte/)?.[1]) - points) <= 2, (await value('l1') * 1e6).toFixed(3) + ' µH · ' + await toast());
  await marker(1, '100 kHz');
  await page.click('button[data-action="model-window"][data-value="markers"]'); await page.waitForTimeout(150);
  report.check('Zwei Marker auf derselben Frequenz: Hinweis statt leerem Fenster', /zwei Marker auf verschiedene Frequenzen/i.test(await toast()), await toast());
  await page.fill('#model-form input[name=from]', '1 MHz'); await page.fill('#model-form input[name=to]', '1,05 MHz');
  await optimize(page);
  report.check('Zu enges Fenster: Optimierung meldet zu wenige Messpunkte', /zu wenige Messpunkte/.test(await toast()), await toast());
  await page.click('button[data-action="model-window"][data-value="all"]'); await page.waitForTimeout(200);
  report.check('„Ganzer Bereich“ öffnet das Fenster wieder', /Gültig von 10 kHz bis 3 GHz/.test((await summary()).text), (await summary()).text);

  // ---- persistence and untouched measurement ----
  await page.click('button[data-action="model-reset"]'); await page.waitForTimeout(200);
  report.check('„Automatik“ stellt den automatischen Fit wieder her', !(await summary()).edited && Math.abs(await value('l1') / L - 1) < 0.01);
  await setValue('l1', '12 µH'); await page.check('input[name="fix-l1"]');
  await page.waitForTimeout(700);
  await page.reload(); await ready();
  await page.waitForSelector('#model-editor');
  report.check('Nach F5: bearbeitetes Modell und „fest“ sind wieder da', (await summary()).edited && Math.abs(await value('l1') / 12e-6 - 1) < 1e-3 && await page.isChecked('input[name="fix-l1"]'));
  report.equal('Die Messdatei ist durch alle Modelländerungen unverändert', await fileHash('Drossel.s2p'), hashBefore);
  await page.click('#tab-s'); await ready();
  report.check('Die S-Parameter-Kurven sind unverändert', (await csv()).text === sBefore);
  await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');

  // ---- SPICE export of the edited model, and reading it back ----
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="esb-spice"][data-value="save"]')]);
  const libPath = path.join(work, download.suggestedFilename()); await download.saveAs(libPath);
  const lib = fs.readFileSync(libPath, 'utf8');
  report.check('SPICE-Export enthält das bearbeitete Modell (L₁ = 12 µH)', /\.subckt Drossel_ESB 1 2/.test(lib) && /L1 n1 \S+ 1\.20000e-5/.test(lib) && /C1 /.test(lib) && /R0 1 n1 /.test(lib), lib.split('\n').slice(1, 6).join(' / '));
  await page.click('button[data-action="esb-spice"][data-value="open"]');
  await page.waitForFunction(() => /Drossel_ESB/.test(document.getElementById('session-files').dataset.current), null, { timeout: 30000 }); await ready();
  await page.click('#tab-cmc'); await ready(); await page.waitForSelector('#model-editor');
  report.check('Reimport des SPICE-Modells: der Analyzer findet 12 µH und 5 pF wieder', Math.abs(await value('l1') / 12e-6 - 1) < 0.01 && Math.abs(await value('c1') / C - 1) < 0.03, (await value('l1') * 1e6).toFixed(3) + ' µH · ' + (await value('c1') * 1e12).toFixed(3) + ' pF');

  // ---- capacitor model ----
  await page.click('.session-open[data-key="Kondensator.s2p"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current === 'Kondensator.s2p'); await ready();
  await page.waitForSelector('#model-editor');
  report.equal('Kondensator: Modell ESR + ESL + C', await page.$$eval('.model-row', n => n.map(r => r.dataset.key)), ['c', 'esr', 'esl']);
  report.check('Kondensator: C = 100 nF, ESR = 20 mΩ, ESL = 0,8 nH aus dem komplexen Fit', Math.abs(await value('c') / 1e-7 - 1) < 0.01 && Math.abs(await value('esr') / 0.02 - 1) < 0.02 && Math.abs(await value('esl') / 0.8e-9 - 1) < 0.02);
  await setValue('esl', '3 nH'); await setValue('esr', '100 mΩ');
  await page.check('input[name="fix-c"]');
  await optimize(page);
  report.check('Kondensator: Optimierung mit festem C stellt ESR und ESL wieder her', Math.abs(await value('esr') / 0.02 - 1) < 0.02 && Math.abs(await value('esl') / 0.8e-9 - 1) < 0.02 && (await summary()).err < 0.05, (await summary()).text);
  data = await csv();
  report.check('Kondensator: Modellkurven für |Z| und ESR neben der Messung', data.head.some(h => /Modell \|Z\|/.test(h)) && data.head.some(h => /Modell ESR/.test(h)), data.head.join(' | '));
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="esb-spice"][data-value="save"]')]);
  const capPath = path.join(work, d2.suggestedFilename()); await d2.saveAs(capPath);
  report.check('Kondensator: SPICE-Export R1 · L1 · C1', /R1 1 n1 2\.0\d+e-2/.test(fs.readFileSync(capPath, 'utf8')) && /L1 n1 n2 [78]\.\d+e-10/.test(fs.readFileSync(capPath, 'utf8')) && /C1 n2 2 1\.0\d+e-7/.test(fs.readFileSync(capPath, 'utf8')), fs.readFileSync(capPath, 'utf8').split('\n').slice(2, 5).join(' / '));

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.locator('#model-editor').scrollIntoViewIfNeeded();
  const fit = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: [...document.querySelectorAll('#model-editor .model-row, #model-editor .preset-row, #model-editor .model-window')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length }));
  report.equal('Editor am Handy-Format: kein horizontales Überlaufen', fit, { over: 0, wide: 0 });
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-me.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-me.png'), 'Toast:', await page.textContent('#toast').catch(() => ''));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
