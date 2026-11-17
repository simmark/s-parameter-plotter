// ESB-Modell-Editor für CMC und Übertrager: Werte von Hand ändern, festhalten, optimieren, Schaltbild und SPICE-Export
// folgen dem Editor, Reimport der exportierten Netzliste ergibt wieder dieselben Werte. Referenzbauteile wie in schematics.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, Report, spiceTouchstone, REF_CMC, refTransformer, optimize } from './lib.mjs';

const report = new Report('ESB · Editor für CMC und Übertrager');
const srv = await serve(), work = tempDir('spa-mu-files-'), profile = tempDir('spa-mu-');
let { context, page, errors } = await launch(profile);
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const num = text => { const m = String(text).replace(/\s/g, '').replace(',', '.').match(/^([\d.eE+-]+)(f|p|n|µ|m|k|M|G)?/); return m ? Number(m[1]) * (SI[m[2]] ?? 1) : NaN; };
const value = async key => num(await page.inputValue('#model-' + key));
const values = async keys => Object.fromEntries(await Promise.all(keys.map(async key => [key, await value(key)])));
const summary = () => page.evaluate(() => { const s = document.getElementById('model-summary'); return { err: Number(s.dataset.err), phase: Number(s.dataset.phase), edited: s.dataset.edited === '1', text: s.textContent }; });
const toast = () => page.textContent('#toast');
const setValue = async (key, text) => { await page.fill('#model-' + key, text); await page.click('#model-form button[type=submit]'); await page.waitForTimeout(200); };
const labels = id => page.evaluate(id => { const out = {}; const t = [...document.querySelectorAll('#' + id + ' svg text')]; t.forEach((el, i) => { if (!el.classList.contains('value') && t[i + 1]?.classList.contains('value')) (out[el.textContent] ??= []).push(t[i + 1].textContent); }); return out; }, id);
const near = (v, target, tol) => Math.abs(v / target - 1) < tol;
const pct = (v, target) => (100 * (v / target - 1)).toFixed(1) + ' %';
async function csv() {
  await page.click('#export-button');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="download"][data-value="csv"]')]);
  const file = path.join(work, 'x-' + Date.now() + '.csv'); await download.saveAs(file);
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
  return { head: rows[0].map(h => h.replace(/^"|"$/g, '')), rows: rows.slice(1).map(r => r.map(Number)) };
}
async function lib(mode = 'save') {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#model-form button[data-action="esb-spice"][data-value="' + mode + '"]')]);
  const file = path.join(work, 'm-' + Date.now() + '.lib'); await download.saveAs(file);
  return { text: fs.readFileSync(file, 'utf8'), name: download.suggestedFilename() };
}
const fileHash = name => page.evaluate(async name => { const e = (await Store.entries('session')).find(x => x.name === name); return e.hash + ':' + await Store.hashOf(new Uint8Array(await (await Store.fileOf(e)).arrayBuffer())); }, name);
async function open(name) {
  await page.click('.session-open[data-key="' + name + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready();
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
  await page.click('#tab-cmc'); await ready();
}
const element = (text, name) => { const m = text.match(new RegExp('^' + name + '\\s+\\S+\\s+\\S+\\s+(\\S+)', 'm')); return m ? Number(m[1]) : NaN; };
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'cmc.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(REF_CMC, { f1: 1e4, f2: 1e8, n: 301 })) },
    { name: 'trafo.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(refTransformer(false), { f1: 1e4, f2: 3e7, n: 301 })) },
    { name: 'trafo_gedreht.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(refTransformer(true), { f1: 1e4, f2: 3e7, n: 301 })) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '3');

  // ================= CMC =================
  await open('cmc.s4p');
  await page.waitForSelector('#model-editor');
  const hash0 = await fileHash('cmc.s4p');
  const CK = ['m', 'rfe', 'ls', 'rls', 'rw', 'ct', 'cw', 'cg'];
  report.equal('CMC: Editor zeigt alle Elemente des Schaltbilds, dazu R_σ parallel zu Lσ', await page.$$eval('.model-row', n => n.map(r => r.dataset.key)), CK);
  const badges = await page.$$eval('.model-row', n => n.map(r => r.querySelector('.model-spread')?.dataset.spread));
  report.check('CMC: jede Zeile zeigt die Bestimmtheit (gut / schwach / nicht bestimmt)', badges.length === CK.length && badges.every(b => ['good', 'weak', 'none'].includes(b)) && await page.locator('#model-spread-note').count() === 1, badges.join(' '));
  report.check('CMC: „Nicht bestimmbare Werte automatisch festhalten“ ist voreingestellt', await page.isChecked('input[name="auto-hold"]'));
  let v = await values(CK), s = await summary();
  report.check('CMC: Startwerte sind die der Auswertung (M 990 µH, Lσ 10 µH, Cw 2 pF, Cg 0,5 pF, Ct 4 pF)', near(v.m, 990e-6, 0.01) && near(v.ls, 10e-6, 0.03) && near(v.cw, 2e-12, 0.03) && near(v.cg, 0.5e-12, 0.05) && near(v.ct, 4e-12, 0.08),
    CK.map(k => k + ' ' + v[k].toExponential(3)).join(' · '));
  report.check('CMC: Abweichung des Startmodells wird je natürlicher Mode genannt', !s.edited && Number.isFinite(s.err) && /Mode G .* dB · Mode V .* dB · Mode H .* dB · Mode D .* dB/.test(s.text) && /Startwerte aus Plateaus und Resonanzen/.test(s.text), s.text);
  const startErr = s.err;
  report.check('CMC: abgeleitete Größen L, k und L+M stehen beim Editor', /L = M \+ Lσ = 1[.,]?\d* mH · k = M\/L = 0[.,]99/.test(await page.textContent('#model-derived')), await page.textContent('#model-derived'));
  report.equal('CMC: kein Marker-Knopf (Startwerte kommen aus der Modenauswertung)', await page.locator('#model-form [data-action="model-marker"]').count(), 0);

  // model curves next to the measurement
  await page.selectOption('#control-cmc-format', 'zesb'); await ready();
  let data = await csv();
  const col = name => data.head.findIndex(h => h.includes(name));
  report.check('CMC: Darstellung „Impedanz · Ersatzschaltbild“ zeigt Messung und Modell für CM und DM', ['|Z CM|', '|Z DM|', 'Modell CM', 'Modell DM'].every(n => col(n) >= 0), data.head.join(' | '));
  const dev = (a, b, lo, hi) => Math.max(...data.rows.filter(r => r[0] >= lo && r[0] <= hi && r[col(a)] > 0 && r[col(b)] > 0).map(r => Math.abs(20 * Math.log10(r[col(a)] / r[col(b)]))));
  const dCm = dev('|Z CM|', 'Modell CM', 2e4, 2e5), dDm = dev('|Z DM|', 'Modell DM', 2e4, 2e6);
  report.check('CMC: Modellkurve liegt im induktiven Bereich auf der Messung (< 0,3 dB)', dCm < 0.3 && dDm < 0.3, 'CM ' + dCm.toFixed(3) + ' dB · DM ' + dDm.toFixed(3) + ' dB');

  // optimise from the start values
  await optimize(page);
  s = await summary(); v = await values(CK);
  report.check('CMC: „Optimieren“ verkleinert die Abweichung und nennt das Ergebnis', s.edited && s.err <= startErr + 1e-9 && /Optimiert/.test(await toast()), startErr.toFixed(3) + ' → ' + s.err.toFixed(3) + ' dB · ' + await toast());
  report.check('CMC: optimierte Werte treffen das Referenzbauteil (M, Lσ, R_w, Ct auf 5 %, R_Fe auf 10 %)', near(v.m, 990e-6, 0.05) && near(v.ls, 10e-6, 0.05) && near(v.rw, 0.05, 0.05) && near(v.ct, 4e-12, 0.05) && near(v.rfe, 40e3, 0.1),
    'M ' + pct(v.m, 990e-6) + ' · Lσ ' + pct(v.ls, 10e-6) + ' · R_w ' + pct(v.rw, 0.05) + ' · R_Fe ' + pct(v.rfe, 40e3) + ' · Ct ' + pct(v.ct, 4e-12) + ' · Cw ' + pct(v.cw, 2e-12) + ' · Cg ' + pct(v.cg, 0.5e-12));
  const optErr = s.err;

  // change by hand
  await setValue('m', '500 µH');
  s = await summary();
  report.check('CMC: Handeingabe M = 500 µH verschlechtert die Abweichung sichtbar', s.edited && s.err > optErr + 1 && near(await value('m'), 500e-6, 1e-3), optErr.toFixed(3) + ' → ' + s.err.toFixed(2) + ' dB');
  let l = await labels('cmc-schematic');
  report.check('CMC: Schaltbild zeigt die Editorwerte und sagt das', near(num(l.M[0]), 500e-6, 0.01) && await page.locator('#schematic-edited').count() === 1, l.M[0]);
  report.check('CMC: abgeleitetes k folgt der Eingabe', /k = M\/L = 0[.,]98/.test(await page.textContent('#model-derived')), await page.textContent('#model-derived'));
  data = await csv();
  report.check('CMC: Modellkurve folgt der Eingabe (Z CM halbiert sich ungefähr)', (() => { const r = data.rows.find(r => r[0] >= 5e4); return near(r[col('Modell CM')] / r[col('|Z CM|')], 510 / 1000, 0.04); })());

  // fix one, optimise the rest
  await page.check('input[name="fix-cg"]');
  await setValue('cg', '0,7 pF');
  await optimize(page);
  v = await values(CK); s = await summary();
  report.check('CMC: Optimieren holt M zurück, der festgehaltene Wert Cg bleibt exakt stehen', near(v.m, 990e-6, 0.05) && near(v.cg, 0.7e-12, 1e-3) && /1 fest/.test(await toast()), 'M ' + pct(v.m, 990e-6) + ' · Cg ' + v.cg.toExponential(3) + ' · ' + s.err.toFixed(3) + ' dB');
  report.check('CMC: alle Werte bleiben positiv', CK.every(k => v[k] > 0));

  // slider
  const before = await value('ls');
  await page.$eval('.model-slider[data-key="ls"]', el => { el.value = String(Number(el.value) + 30); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  const live = await value('ls');
  await page.$eval('.model-slider[data-key="ls"]', el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(200);
  report.check('CMC: Regler verstellt Lσ sofort (Faktor 10^0,3 ≈ 2)', near(live / before, 10 ** 0.3, 0.05) && near(await value('ls'), live, 1e-3), before.toExponential(3) + ' → ' + live.toExponential(3));
  // invalid input
  await setValue('rw', '-1');
  report.check('CMC: negativer Wert wird abgelehnt', /positiven Wert/.test(await toast()), await toast());
  await setValue('rw', '50 mΩ');

  // SPICE export of the edited model
  const edited = await values(CK);
  const netlist = await lib('save');
  report.check('CMC: SPICE-Export ist ein Vierpol mit gekoppeltem Teil und allen Elementen', /^\.subckt \S+ 1 2 3 4$/m.test(netlist.text) && /^Kab Lma Lmb 1$/m.test(netlist.text) && ['Rwa', 'Lsa', 'Lma', 'Rfa', 'Cta', 'Rwb', 'Lsb', 'Lmb', 'Rfb', 'Ctb', 'Cwi', 'Cwo', 'Cg1', 'Cg4'].every(n => Number.isFinite(element(netlist.text, n))), netlist.name);
  report.check('CMC: Netzliste trägt genau die Editorwerte', near(element(netlist.text, 'Lma'), edited.m, 2e-3) && near(element(netlist.text, 'Lsb'), edited.ls, 2e-3) && near(element(netlist.text, 'Cg3'), edited.cg, 2e-3) && near(element(netlist.text, 'Cta'), edited.ct, 2e-3) && near(element(netlist.text, 'Rfb'), edited.rfe, 2e-3));
  report.equal('CMC: Messdatei ist unverändert', await fileHash('cmc.s4p'), hash0);

  // persistence over a reload
  await page.waitForTimeout(600);
  await page.reload(); await ready();
  await page.waitForSelector('#model-editor');
  const again = await values(CK);
  report.check('CMC: Editorwerte, „fest“ und Darstellung überstehen F5', CK.every(k => near(again[k], edited[k], 2e-3)) && await page.isChecked('input[name="fix-cg"]') && (await summary()).edited && await page.inputValue('#control-cmc-format') === 'zesb',
    CK.map(k => k + ' ' + pct(again[k], edited[k])).join(' · '));

  // reimport of the exported model
  await page.click('#model-form button[data-action="esb-spice"][data-value="open"]');
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '4', null, { timeout: 30000 }); await ready();
  const libName = await page.evaluate(() => document.getElementById('session-files').dataset.current);
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
  await page.click('#tab-cmc'); await ready();
  await page.waitForSelector('#model-editor');
  await optimize(page);
  const back = await values(CK), sBack = await summary();
  report.check('CMC: Reimport der exportierten Netzliste und erneutes Optimieren ergibt wieder die exportierten Werte (3 %)', sBack.err < 0.1 && ['m', 'ls', 'rw', 'rfe', 'ct'].every(k => near(back[k], edited[k], 0.03)),
    libName + ' · ' + sBack.err.toFixed(4) + ' dB · ' + CK.map(k => k + ' ' + pct(back[k], edited[k])).join(' · '));

  // reset, and the per-mode view has no four-terminal editor
  await open('cmc.s4p'); await page.waitForSelector('#model-editor');
  await page.click('button[data-action="model-reset"]'); await page.waitForTimeout(200);
  s = await summary();
  report.check('CMC: „Automatik“ stellt die Werte der Auswertung wieder her', !s.edited && near(await value('m'), 990e-6, 0.01) && await page.locator('#schematic-edited').count() === 0 && !(await page.isChecked('input[name="fix-cg"]')));
  await page.selectOption('#control-cmc-format', 'zfit'); await ready();
  report.equal('CMC: Darstellung „je Mode bis 2. Resonanz“ zeigt ihr eigenes Modell, keinen Vierpol-Editor', await page.locator('#model-editor').count(), 0);
  await page.selectOption('#control-cmc-format', 'ind'); await ready();
  data = await csv();
  report.check('CMC: Induktivitäts-Darstellung zeigt Modell L+M und L−M', ['Modell L+M', 'Modell L−M'].every(n => col(n) >= 0) && (() => { const r = data.rows.find(r => r[0] >= 5e4); return near(r[col('Modell L+M')], r[col('L+M')], 0.02) && near(r[col('Modell L−M')], r[col('L−M')], 0.03); })(), data.head.join(' | '));

  // ================= Übertrager =================
  await open('trafo.s4p');
  await page.waitForSelector('#model-editor');
  const TK = ['lm', 'lst', 'n', 'rpri', 'rsec', 'rfe', 'cp', 'cwa', 'cwx'];
  const lsRef = 350e-6 * (1 - 0.997 ** 2);
  report.equal('Übertrager: Editor zeigt alle neun Elemente des T-Modells', await page.$$eval('.model-row', n => n.map(r => r.dataset.key)), TK);
  v = await values(TK); s = await summary();
  report.check('Übertrager: Startwerte sind die der Auswertung (L_m, Lσ, n = 2, R_Fe 20 kΩ, C_p 15 pF, Cww 12 pF je zur Hälfte auf Cwa und Cwx)', near(v.lm + v.lst / 2, 350e-6, 0.02) && near(v.lst, lsRef, 0.05) && near(v.n, 2, 0.01) && near(v.rfe, 20e3, 0.1) && near(v.cp, 15e-12, 0.15) && near(v.cwa + v.cwx, 12e-12, 0.05) && near(v.cwa, v.cwx, 1e-6),
    TK.map(k => k + ' ' + v[k].toExponential(3)).join(' · '));
  report.check('Übertrager: Abweichung je Kurve Z₁₁, Z₂₂, Z₂₁ und Kurzschlussimpedanz Z_k', /Z₁₁ .* dB · Z₂₂ .* dB · Z₂₁ .* dB · Z_k .* dB/.test(s.text), s.text);
  const tStart = s.err, r1Start = v.rpri;
  report.check('Übertrager: abgeleitete Größen und Polarität', /L₁₁ = L_m \+ Lσ\/2 = 35\d[.,]?\d* µH .* Cww = Cwa \+ Cwx = 12 pF .* gleichsinnig/.test(await page.textContent('#model-derived')), await page.textContent('#model-derived'));
  await optimize(page);
  v = await values(TK); s = await summary();
  report.check('Übertrager: „Optimieren“ verkleinert die Abweichung', s.edited && s.err <= tStart + 1e-9, tStart.toFixed(3) + ' → ' + s.err.toFixed(3) + ' dB · ' + s.phase.toFixed(2) + '°');
  report.check('Übertrager: Optimieren findet die Lage der Wicklungskapazität: im Referenzbauteil liegt sie zwischen gleichnamigen Anschlüssen (Summe 12 pF, Cwa überwiegt)', near(v.cwa + v.cwx, 12e-12, 0.1) && v.cwa > 2 * v.cwx, 'Cwa ' + (v.cwa * 1e12).toFixed(2) + ' pF · Cwx ' + (v.cwx * 1e12).toFixed(3) + ' pF');
  report.check('Übertrager: optimierte Werte treffen das Referenzbauteil (L_m, Lσ, n auf 3 %; R₁, R₂, R_Fe auf 10 %)', near(v.lm + v.lst / 2, 350e-6, 0.03) && near(v.lst, lsRef, 0.03) && near(v.n, 2, 0.03) && near(v.rpri, 0.4, 0.1) && near(v.rsec, 1.5, 0.1) && near(v.rfe, 20e3, 0.1),
    'L₁₁ ' + pct(v.lm + v.lst / 2, 350e-6) + ' · Lσ ' + pct(v.lst, lsRef) + ' · n ' + pct(v.n, 2) + ' · R₁ ' + pct(v.rpri, 0.4) + ' (Start ' + pct(r1Start, 0.4) + ') · R₂ ' + pct(v.rsec, 1.5) + ' · R_Fe ' + pct(v.rfe, 20e3) + ' · C_p ' + pct(v.cp, 15e-12));
  await setValue('n', '3');
  l = await labels('transformer-schematic');
  report.check('Übertrager: Handeingabe n = 3 erscheint im Schaltbild, mit Hinweis auf den Editor', /1 : 3/.test(l['1 : n'][0]) && await page.locator('#schematic-edited').count() === 1 && (await summary()).err > s.err + 1, l['1 : n'][0]);
  report.check('Übertrager: Lσ₂ = Lσ₁·n² im Bild folgt n', near(num(l['Lσ₂'][0]), 9 * num(l['Lσ₁'][0]), 0.02), l['Lσ₁'][0] + ' · ' + l['Lσ₂'][0]);
  await page.check('input[name="fix-rfe"]');
  await optimize(page);
  const fixedRfe = v.rfe; v = await values(TK);
  report.check('Übertrager: Optimieren holt n = 2 zurück, R_Fe bleibt fest', near(v.n, 2, 0.03) && near(v.rfe, fixedRfe, 2e-3), 'n ' + v.n + ' · R_Fe ' + v.rfe);
  // fit window from markers
  await page.fill('#marker-0', '20 kHz'); await page.press('#marker-0', 'Enter'); await page.click('button[data-action="add-marker"]'); await page.waitForTimeout(150); await page.fill('#marker-1', '2 MHz'); await page.press('#marker-1', 'Enter'); await page.waitForTimeout(150);
  await page.click('button[data-action="model-window"][data-value="markers"]'); await page.waitForTimeout(200);
  s = await summary();
  report.check('Übertrager: Fitfenster aus den Markern M1 … M2', /Gültig von 20[.,]?\d* kHz bis [12][.,]?\d* MHz/.test(s.text), s.text.slice(0, 60));
  await page.selectOption('#control-esb-tformat', 'z'); await ready();
  data = await csv();
  report.check('Übertrager: |Z₁₁| mit Modellkurve, im Fenster deckungsgleich (< 0,5 dB)', col('Modell |Z₁₁|') >= 0 && dev('|Z₁₁|', 'Modell |Z₁₁|', 2e4, 2e6) < 0.5, data.head.join(' | ') + ' · ' + dev('|Z₁₁|', 'Modell |Z₁₁|', 2e4, 2e6).toFixed(3) + ' dB');
  await page.selectOption('#control-esb-tformat', 'leak'); await ready();
  data = await csv();
  report.check('Übertrager: Streuinduktivität mit Modellkurve', col('Modell Lσ') >= 0 && (() => { const r = data.rows.find(r => r[0] >= 1e5); return near(r[col('Modell Lσ')], r[col('Lσ')], 0.05); })(), data.head.join(' | '));
  const tEdited = await values(TK), tNet = await lib('save');
  report.check('Übertrager: SPICE-Export mit Hauptinduktivität, idealem Übertrager (k = 1), hälftiger Streuung, Cwa und Cwx', /^\.subckt \S+ 1 2 3 4$/m.test(tNet.text) && /^K1 Lm Lt 1$/m.test(tNet.text) && /^Lt s1 4 /m.test(tNet.text) &&
    near(element(tNet.text, 'Lm'), tEdited.lm, 2e-3) && near(element(tNet.text, 'Ls1'), tEdited.lst / 2, 2e-3) && near(element(tNet.text, 'Ls2'), tEdited.n ** 2 * tEdited.lst / 2, 5e-3) && near(element(tNet.text, 'Lt'), tEdited.n ** 2 * tEdited.lm, 5e-3) && near(element(tNet.text, 'Cwa2'), tEdited.cwa / 2, 2e-3) && near(element(tNet.text, 'Cwx1'), tEdited.cwx / 2, 2e-3), tNet.name);

  await open('trafo_gedreht.s4p');
  await page.waitForSelector('#model-editor');
  report.check('Übertrager mit gedrehter Sekundärwicklung: Polarität „invertiert“ im Editor', /invertiert/.test(await page.textContent('#model-derived')));
  s = await summary();
  await optimize(page);
  const sFlip = await summary();
  report.check('… Modell passt auch dort (Phase von Z₂₁ stimmt)', sFlip.err <= s.err + 1e-9 && sFlip.phase < 5, sFlip.err.toFixed(3) + ' dB · ' + sFlip.phase.toFixed(2) + '°');
  report.check('… und die Netzliste dreht die Sekundärwicklung', /^Lt 4 s1 /m.test((await lib('save')).text));

  report.equal('Keine Fehler in der Konsole', errors, []);
} catch (error) {
  report.check('Ablauf ohne Ausnahme', false, error.stack);
} finally {
  await context.close().catch(() => {});
  srv.close();
}
process.exit(report.done() ? 0 : 1);
