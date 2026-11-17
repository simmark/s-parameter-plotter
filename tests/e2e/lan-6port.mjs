// LAN-Übertrager mit Mittelanzapfungen als 6-Port-Datei: Profil aus Herstellerkopf und Pin-Skizze, Anzapfungen offen,
// Sekundärseite nach Punktkonvention, Übertrager-Editor bestimmt n = 1 und gleichsinnige Polarität. Synthetische Daten.
import { serve, launch, tempDir, Report, spiceTouchstone, optimize } from './lib.mjs';
import { lanHeader, LAN_NETLIST } from '../lan-fixture.mjs';

const report = new Report('LAN-Übertrager · 6 Ports mit Mittelanzapfung');
const srv = await serve();
let { context, page, errors } = await launch(tempDir('spa-lan-'));
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6 };
const num = text => { const m = String(text).replace(/\s/g, '').replace(',', '.').match(/^([\d.eE+-]+)(f|p|n|µ|m|k|M)?/); return m ? Number(m[1]) * (SI[m[2]] ?? 1) : NaN; };
try {
  // the export names its ports "P1 Pin 1" …; manufacturer files carry no such lines, only the sketch
  const body = (await spiceTouchstone(LAN_NETLIST, { f1: 1e4, f2: 3e8, n: 281 })).split('\n').filter(line => !/^! Port\[/.test(line)).join('\n');
  const file = { name: 'lan_6port.s6p', mimeType: 'text/plain', buffer: Buffer.from(lanHeader({ part: '7490999999X' }) + body) };
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [file]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1'); await ready();
  await page.click('#tab-ports'); await ready();
  const lan = page.locator('button[data-action="pair-preset"][data-value="lan"]');
  report.check('Ports: Knopf trägt die Artikelnummer aus dem Dateikopf', (await lan.count()) === 1 && (await lan.textContent()).trim() === '7490999999X · CT Open', await lan.textContent().catch(() => 'fehlt'));
  const names = await page.evaluate(() => document.body.textContent);
  report.check('Ports: Namen mit Pins aus der Skizze (CT1 · Pin 2, 2+ · Pin 12)', /CT1 · Pin 2/.test(names) && /2\+ · Pin 12/.test(names));
  await page.click('#tab-cmc'); await ready();
  await page.waitForSelector('#model-editor');
  report.check('ESB: Übertrager-Editor (T-Modell mit n)', await page.locator('#model-n').count() === 1, await page.evaluate(() => document.getElementById('control-esb-model')?.selectedOptions[0]?.textContent));
  const derived = await page.textContent('#model-derived');
  const l11 = num(derived.match(/L₁₁ = L_m \+ Lσ\/2 = ([^·]+)/)?.[1]);
  report.check('ESB: Polarität gleichsinnig (Sekundär + = Pin 12, wie die Punkte im Datenblatt)', /gleichsinnig/.test(derived), derived);
  report.check('ESB: L₁₁ ≈ 700 µH (4 × 175 µH bei k = 0,999)', Math.abs(l11 / 699.3e-6 - 1) < 0.03, (l11 * 1e6).toFixed(1) + ' µH');
  report.check('ESB: n = 1', Math.abs(num(await page.inputValue('#model-n')) - 1) < 0.01, await page.inputValue('#model-n'));
  // capacitances of the netlist: C_p 3 pF across the primary, 2 pF pin 1–12 and 2 pF pin 3–10 (like terminals: C_wa = 4 pF), no
  // C_wx, no C_p2. The data reach past the leakage resonance, so the natural modes fix all four – already in the start values.
  const caps = async () => Object.fromEntries(await Promise.all(['cp', 'cp2', 'cwa', 'cwx'].map(async k => [k, num(await page.inputValue('#model-' + k))])));
  const c0 = await caps();
  report.check('ESB: Startkapazitäten aus den natürlichen Moden (C_p ≈ 3 pF, C_wa ≈ 4 pF, C_wx und C_p2 klein)', Math.abs(c0.cp / 3e-12 - 1) < 0.25 && Math.abs(c0.cwa / 4e-12 - 1) < 0.25 && c0.cwx < 1e-12 && c0.cp2 < 1e-12, JSON.stringify(c0));
  const before = Number(await page.getAttribute('#model-summary', 'data-err'));
  await optimize(page);
  const after = Number(await page.getAttribute('#model-summary', 'data-err'));
  report.check('ESB: Optimieren verkleinert die Abweichung', after <= before, before.toFixed(3) + ' → ' + after.toFixed(3) + ' dB');
  const c1 = await caps();
  report.check('ESB: nach dem Optimieren C_p und C_wa auf 5 %', Math.abs(c1.cp / 3e-12 - 1) < 0.05 && Math.abs(c1.cwa / 4e-12 - 1) < 0.05 && c1.cwx < 0.4e-12 && c1.cp2 < 0.4e-12, JSON.stringify(c1));
  report.check('ESB: jede Zeile zeigt die Bestimmtheit', (await page.$$('.model-row .model-spread')).length === (await page.$$('.model-row')).length);
  report.check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 2).join(' | '));
  // English: the button text is translated with the part number kept
  await context.close();
  ({ context, page, errors } = await launch(tempDir('spa-lan-en-')));
  await page.addInitScript(() => localStorage.setItem('spa-lang', 'en'));
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', [file]);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '1'); await ready();
  await page.click('#tab-ports'); await ready();
  report.check('Englisch: „7490999999X · CT open“', (await page.locator('button[data-action="pair-preset"][data-value="lan"]').textContent()).trim() === '7490999999X · CT open');
} catch (error) {
  report.check('Ablauf ohne Ausnahme', false, error.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await context.close().catch(() => {});
  srv.close?.();
}
process.exit(report.done() ? 0 : 1);
