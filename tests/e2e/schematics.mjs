// CMC- und Übertrager-Ersatzschaltbild: Die Werte im Bild müssen aus dem Fit stammen und zu Referenzbauteilen mit
// bekannten Werten passen (CMC: L 1 mH, k 0,99, R_w 50 mΩ, R_Fe 40 kΩ, Cw 2 pF, Cg 0,5 pF, Ct 4 pF;
// Übertrager: 350 µH, n = 2, k 0,997, R₁ 0,4 Ω, R₂ 1,5 Ω, R_Fe 20 kΩ, C_p 15 pF, Cww 12 pF).
import path from 'node:path';
import { serve, launch, tempDir, Report, spiceTouchstone, REF_CMC, refTransformer } from './lib.mjs';

const report = new Report('ESB · CMC- und Übertragerschaltbild');
const srv = await serve(), work = tempDir('spa-sch-files-');
const { context, page, errors } = await launch(tempDir('spa-sch-'));
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const num = text => { const m = String(text).replace(/\s/g, '').replace(',', '.').match(/^([\d.eE+-]+)(f|p|n|µ|m|k|M|G)?/); return m ? Number(m[1]) * (SI[m[2]] ?? 1) : NaN; };
// labels of a drawing: { name: [values…] }
const labels = id => page.evaluate(id => { const out = {}; const t = [...document.querySelectorAll('#' + id + ' svg text')]; t.forEach((el, i) => { if (!el.classList.contains('value') && t[i + 1]?.classList.contains('value')) (out[el.textContent] ??= []).push(t[i + 1].textContent); }); return out; }, id);
const metrics = id => page.evaluate(id => Object.fromEntries([...document.querySelectorAll('#' + id + ' .metric')].map(m => [m.querySelector('span').textContent, m.querySelector('strong').textContent])), id);
const near = (text, target, tol) => Math.abs(num(text) / target - 1) < tol;
async function open(name) {
  await page.click('.session-open[data-key="' + name + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready();
  await page.click('#tab-ports'); await page.click('button[data-action="pair-preset"][data-value="adjacent"]'); await ready();
  await page.click('#tab-cmc'); await ready();
}
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [
    { name: 'cmc.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(REF_CMC, { f1: 1e4, f2: 1e8, n: 301 })) },
    { name: 'trafo.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(refTransformer(false), { f1: 1e4, f2: 3e7, n: 301 })) },
    { name: 'trafo_gedreht.s4p', mimeType: 'text/plain', buffer: Buffer.from(await spiceTouchstone(refTransformer(true), { f1: 1e4, f2: 3e7, n: 301 })) }
  ]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '3');

  // ---------- CMC ----------
  await open('cmc.s4p');
  await page.waitForSelector('#cmc-schematic svg');
  report.check('Automatik wählt das CMC-Modell', /CMC/.test(await page.evaluate(() => document.getElementById('control-esb-model').selectedOptions[0].textContent)));
  let l = await labels('cmc-schematic'), m = await metrics('cmc-schematic');
  report.equal('CMC-Bild zeigt alle Elemente des Modells', Object.keys(l).sort(), ['Cg', 'Ct', 'Cw', 'Lσ', 'M', 'R_Fe', 'R_w', 'k'].sort());
  report.check('Streuinduktivität je Wicklung ist eigens dargestellt: Lσ = L − M = 10 µH (zweimal)', l['Lσ'].length === 2 && l['Lσ'].every(v => near(v, 10e-6, 0.03)), l['Lσ'].join(' | '));
  report.check('Gegeninduktivität M = 990 µH und k = 0,99', near(l.M[0], 990e-6, 0.01) && Math.abs(num(l.k[0]) - 0.99) < 0.002, l.M[0] + ' · ' + l.k[0]);
  report.check('Wicklungswiderstand R_w = 50 mΩ je Wicklung', l.R_w.length === 2 && l.R_w.every(v => near(v, 0.05, 0.1)), l.R_w.join(' | '));
  report.check('Kernverlust R_Fe = 40 kΩ je Wicklung', l.R_Fe.every(v => near(v, 40e3, 0.1)), l.R_Fe.join(' | '));
  report.check('Cw = 2 pF je Seite, Cg = 0,5 pF an allen vier Anschlüssen, Ct = 4 pF je Wicklung', l.Cw.length === 2 && l.Cw.every(v => near(v, 2e-12, 0.03)) && l.Cg.length === 4 && l.Cg.every(v => near(v, 0.5e-12, 0.05)) && l.Ct.length === 2 && l.Ct.every(v => near(v, 4e-12, 0.05)), [l.Cw[0], l.Cg[0], l.Ct.join('/')].join(' · '));
  report.check('Werte im Bild und in der Tabelle sind dieselben (L − M)', near(m['Lσ = L − M · Streuung je Wicklung'], num(l['Lσ'][0]), 1e-6) && Math.abs(num(m['L · Induktivität je Wicklung']) - num(m['M · Gegeninduktivität']) - num(l['Lσ'][0])) / 1e-5 < 0.05, JSON.stringify(m));
  report.check('Normierung CM/DM mit Faktoren ist erklärt', /Z CM = jω\(L \+ M\)\/2 an 25 Ω/.test(await page.textContent('#cmc-schematic')) && /Z DM = j2ω\(L − M\)/.test(await page.textContent('#cmc-schematic')));
  // The selected band changes the modal estimate. The schematic follows the model editor.
  const before = l.Ct.join('|');
  await page.fill('#fit-form input[name=start]', '20 kHz'); await page.fill('#fit-form input[name=stop]', '300 kHz');
  await page.click('#fit-form button[type=submit]'); await ready();
  l = await labels('cmc-schematic');
  report.equal('Schaltbild folgt weiterhin dem Editor nach einer Änderung des Fit-Bands', l.Ct.join('|'), before);
  report.check('Ein unphysikalischer modaler Fit bleibt als Diagnose beim Fit sichtbar',
    /negative Kapazitäten/.test(await page.textContent('#cmc-fit-warning')) && l.Ct.every(v=>num(v)>0));
  await page.fill('#fit-form input[name=start]', '1 MHz'); await page.fill('#fit-form input[name=stop]', '50 MHz');
  await page.click('#fit-form button[type=submit]'); await ready();
  report.check('Mit passendem Band verschwindet die Warnung', await page.locator('#cmc-fit-warning').count() === 0);
  // zoom
  const box = '#cmc-schematic .schematic-box';
  const w0 = await page.$eval(box + ' svg', el => el.getBoundingClientRect().width);
  await page.click('#cmc-schematic button[data-action="schematic-zoom"]');
  const w1 = await page.$eval(box + ' svg', el => el.getBoundingClientRect().width);
  report.check('Schaltbild lässt sich vergrößern und im Rahmen verschieben', w1 > 1.6 * w0 && await page.$eval(box, el => el.scrollWidth > el.clientWidth + 50), Math.round(w0) + ' → ' + Math.round(w1) + ' px');
  await page.click('#cmc-schematic button[data-action="schematic-zoom"]');

  // ---------- transformer ----------
  await open('trafo.s4p');
  await page.waitForSelector('#transformer-schematic svg');
  report.check('Automatik wählt das Übertragermodell', /Übertrager/.test(await page.evaluate(() => document.getElementById('control-esb-model').selectedOptions[0].textContent)));
  l = await labels('transformer-schematic'); m = await metrics('transformer-schematic');
  report.equal('Übertrager-Bild zeigt alle Elemente', Object.keys(l).sort(), ['1 : n', 'C_p', 'Cww', 'L_m', 'Lσ₁', 'Lσ₂', 'R_Fe', 'R₁', 'R₂'].sort());
  const n = num(l['1 : n'][0].replace('1:', '').replace('1 : ', ''));
  report.check('Übersetzung 1 : n mit n = 2', Math.abs(n - 2) < 0.01, l['1 : n'][0]);
  const total = 350e-6 * (1 - 0.997 ** 2), ls1 = num(l['Lσ₁'][0]), ls2 = num(l['Lσ₂'][0]), lm = num(l.L_m[0]);
  report.check('Primär- und sekundärseitige Streuung: Lσ₁ + Lσ₂/n² = gesamte Streuung ' + (total * 1e6).toFixed(3) + ' µH', Math.abs((ls1 + ls2 / n ** 2) / total - 1) < 0.03, (ls1 * 1e6).toFixed(3) + ' µH + ' + (ls2 * 1e6).toFixed(3) + ' µH / n²');
  report.check('Magnetisierungsinduktivität L_m + Lσ₁ = OCL = 350 µH', Math.abs((lm + ls1) / 350e-6 - 1) < 0.01, l.L_m[0]);
  report.check('Wicklungswiderstände R₁ ≈ 0,4 Ω und R₂ ≈ 1,5 Ω (tiefste Frequenz, innerhalb 15 %)', near(l['R₁'][0], 0.4, 0.15) && near(l['R₂'][0], 1.5, 0.15), l['R₁'][0] + ' · ' + l['R₂'][0]);
  report.check('Kernverlustzweig R_Fe ≈ 20 kΩ', near(l.R_Fe[0], 20e3, 0.05), l.R_Fe[0]);
  report.check('Wicklungskapazität C_p ≈ 15 pF (+ Anteil der Koppelkapazität) und Cww = 12 pF', num(l.C_p[0]) > 14e-12 && num(l.C_p[0]) < 19e-12 && near(l.Cww[0], 12e-12, 0.03), l.C_p[0] + ' · ' + l.Cww[0]);
  const fit = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#analysis-details > section .metric')].map(x => [x.querySelector('span').textContent, x.querySelector('strong').textContent])));
  const leakFit = Object.entries(fit).find(([k]) => /^Lσ · Streuung/.test(k))[1];
  report.check('Bild und Fitparameter hängen zusammen: Lσ₁ ist die Hälfte der gefitteten Streuung', Math.abs(2 * ls1 / (num(leakFit) * 1e-9 * (/nH/.test(leakFit) ? 1 : 1)) - 1) < 0.01 || Math.abs(2 * ls1 / num(leakFit.replace(/\s*nH/, 'n')) - 1) < 0.01, 'Fit ' + leakFit + ' · Bild 2 × ' + l['Lσ₁'][0]);
  const limits = await page.textContent('#transformer-limits');
  report.check('Nicht unabhängig bestimmbare Größen sind gekennzeichnet (Aufteilung der Streuung als Annahme)', /Was sie nicht festlegt/.test(limits) && /je zur Hälfte/.test(limits) && /Annahme: hälftig/.test(Object.keys(m).join(' ')) && /Gleichstrommessung ist genauer/.test(limits));
  report.check('Plausibilitätsprüfung: Streuung aus k gegen Kurzschlussmessung', Number(await page.getAttribute('#transformer-agree', 'data-agree')) < 0.05, await page.textContent('#transformer-agree'));
  report.equal('Polarität: Punkte auf gleicher Höhe', await page.$$eval('#transformer-schematic .sch-dot[cy="116"]', n => n.length), 2);

  // evaluation frequency from a marker
  await page.fill('#marker-0', '50 kHz'); await page.press('#marker-0', 'Enter'); await page.waitForTimeout(150);
  await page.click('button[data-action="eval-marker"]'); await ready(); await page.waitForTimeout(200);
  report.check('Marker liefert die Auswertefrequenz für OCL, n und k', /OCL · L₁₁ bei (4\d|5\d)[,.]?\d* kHz/.test(await page.textContent('#analysis-details')) && /kHz/.test(await page.inputValue('#eval-form input[name=eval]')) && /Auswertefrequenz/.test(await page.textContent('#toast')), await page.inputValue('#eval-form input[name=eval]'));
  await page.fill('#eval-form input[name=eval]', '900 GHz'); await page.click('#eval-form button[type=submit]'); await page.waitForTimeout(150);
  report.check('Auswertefrequenz außerhalb des Messbereichs wird abgelehnt', /innerhalb des Messbereichs/.test(await page.textContent('#toast')));

  await open('trafo_gedreht.s4p');
  await page.waitForSelector('#transformer-schematic svg');
  report.check('Gedrehte Sekundärwicklung: Punkt wandert, Kennwert nennt die invertierte Polarität', await page.$$eval('#transformer-schematic .sch-dot[cy="176"]', n => n.length) === 1 && /Polarität invertiert/.test(await page.textContent('#analysis-details')));

  // ---------- dark theme and phone ----------
  await page.click('#theme-button'); await page.waitForTimeout(200);
  const dark = await page.evaluate(() => { const svg = document.querySelector('#transformer-schematic svg'), cs = getComputedStyle(svg); return { theme: document.documentElement.dataset.theme, filter: cs.filter, color: cs.color, bg: cs.backgroundColor }; });
  const lum = c => { const v = c.match(/\d+/g).map(Number); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  report.check('Dunkles Design: helle Linien auf dunklem Grund, kein Farbfilter', dark.theme === 'dark' && dark.filter === 'none' && lum(dark.color) - lum(dark.bg) > 90, JSON.stringify(dark));
  await page.click('#theme-button');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  await page.locator('#transformer-schematic').scrollIntoViewIfNeeded();
  const phone = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: Math.round(document.querySelector('#transformer-schematic svg').getBoundingClientRect().width) }));
  await page.click('#transformer-schematic button[data-action="schematic-zoom"]');
  const zoomed = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: Math.round(document.querySelector('#transformer-schematic svg').getBoundingClientRect().width), scroll: document.querySelector('#transformer-schematic .schematic-box').scrollWidth > 500, touch: getComputedStyle(document.querySelector('#transformer-schematic .schematic-box')).touchAction }));
  report.check('Handy-Format: Bild passt, vergrößert ist es im Rahmen verschiebbar, die Seite läuft nicht über', phone.over === 0 && zoomed.over === 0 && zoomed.w > 1.8 * phone.w && zoomed.scroll, JSON.stringify(phone) + ' → ' + JSON.stringify(zoomed));
  await page.screenshot({ path: '/tmp/sch-phone.png' });
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-sch.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-sch.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
