// ESB: automatische Modellwahl aus der Physik-Erkennung, Fixture getrennt vom Bauteiltyp, .s1p und .s2p.
// Referenzbauteile sind synthetisch mit bekannten Werten.
import path from 'node:path';
import { serve, launch, tempDir, Report, logFreqs, inductorZ, capacitorZ, fixtureS2P, reflectionS1P } from './lib.mjs';

const report = new Report('ESB · Bauteilerkennung');
const srv = await serve(), work = tempDir('spa-esb-files-');
const { context, page, errors } = await launch(tempDir('spa-esb-'));
const freqs = logFreqs(1e4, 3e9, 301);
const coil = inductorZ({ L: 10e-6, C: 5e-12, R: 0.2, Rp: 30e3 }), cap = capacitorZ({ C: 100e-9, ESR: 0.02, ESL: 0.8e-9 }), smallCap = capacitorZ({ C: 1e-9, ESR: 0.1, ESL: 1e-9 });
const resistor = () => [50, 0];
const buf = text => Buffer.from(text);
const files = [
  { name: 'Drossel_Serie.s2p', mimeType: 'text/plain', buffer: buf(fixtureS2P(coil, freqs, 'series')) },
  { name: 'Kondensator_Shunt.s2p', mimeType: 'text/plain', buffer: buf(fixtureS2P(cap, freqs, 'shunt')) },
  { name: 'Kondensator_Serie.s2p', mimeType: 'text/plain', buffer: buf(fixtureS2P(smallCap, freqs, 'series')) },
  { name: 'Drossel_Eintor.s1p', mimeType: 'text/plain', buffer: buf(reflectionS1P(coil, freqs)) },
  { name: 'Kondensator_Eintor.s1p', mimeType: 'text/plain', buffer: buf(reflectionS1P(smallCap, freqs)) },
  { name: 'Widerstand_Serie.s2p', mimeType: 'text/plain', buffer: buf(fixtureS2P(resistor, freqs, 'series')) }
];
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0 && !document.querySelector('#status-bar .status-dot.warn'));
async function open(name) {
  await page.click('.session-open[data-key="' + name + '"]');
  await page.waitForFunction(k => document.getElementById('session-files').dataset.current === k, name); await ready();
  await page.click('#tab-cmc'); await ready();
  await page.waitForSelector('#control-esb-model');
  return page.evaluate(() => ({
    model: document.getElementById('control-esb-model').selectedOptions[0].textContent, value: document.getElementById('control-esb-model').value,
    fixture: document.getElementById('control-esb-fixture')?.selectedOptions[0].textContent ?? '', formula: document.getElementById('esb-formula')?.textContent ?? '',
    note: (document.getElementById('esb-detected') || document.getElementById('esb-unclear'))?.textContent ?? '', unclear: !!document.getElementById('esb-unclear'),
    output: !!document.getElementById('control-esb-output'), empty: document.getElementById('empty-panel').hidden ? '' : document.getElementById('empty-panel').textContent,
    metrics: Object.fromEntries([...document.querySelectorAll('#analysis-details .metric')].map(m => [m.querySelector('span').textContent, m.querySelector('strong').textContent]))
  }));
}
const number = text => Number(String(text).replace(/\s/g, '').replace('−', '-').replace(',', '.').replace(/[^\d.eE+-].*$/, ''));
try {
  await page.goto(srv.url); await ready();
  await page.setInputFiles('#file-input', files);
  await page.waitForFunction(() => document.getElementById('session-files').dataset.count === '6');

  let r = await open('Drossel_Serie.s2p');
  report.check('Drossel, Serien-Fixture: induktives Modell, Fixture Serie', /induktiv/.test(r.model) && /Serie/.test(r.fixture) && /2Z₀\(1\/S₂₁ − 1\)/.test(r.formula), r.model + ' | ' + r.fixture);
  const lFit = number(r.metrics['L · LC-Fit unterhalb SRF']);
  report.check('Drossel: L = 10 µH, SRF = 22,5 MHz', Math.abs(lFit / 10 - 1) < 0.03 && /22[,.]\d+ MHz/.test(r.metrics['SRF · Maximum von |Z|']), r.metrics['L · LC-Fit unterhalb SRF'] + ' · ' + r.metrics['SRF · Maximum von |Z|']);
  report.check('Erkennung nennt Klasse und Sicherheit', /Automatisch erkannt: .*(Induktivität|spule|Ferrit).*(sicher erkannt|wahrscheinlich)/.test(r.note), r.note);

  r = await open('Kondensator_Shunt.s2p');
  report.check('Kondensator, Shunt-Fixture: kapazitives Modell, Fixture Shunt', /kapazitiv/.test(r.model) && /Shunt/.test(r.fixture), r.model + ' | ' + r.fixture);
  report.check('Kondensator 100 nF: C, ESL 0,8 nH, ESR 20 mΩ', Math.abs(number(r.metrics['C · Plateau unterhalb SRF']) / 100 - 1) < 0.03 && Math.abs(number(r.metrics['ESL · oberhalb SRF']) / 0.8 - 1) < 0.1 && Math.abs(number(r.metrics['ESR · Re Z bei SRF']) / 20 - 1) < 0.1, JSON.stringify(r.metrics));

  r = await open('Kondensator_Serie.s2p');
  report.check('Kondensator in Serien-Fixture wird NICHT als Serieninduktivität behandelt', /kapazitiv/.test(r.model) && /Serie/.test(r.fixture) && /2Z₀\(1\/S₂₁ − 1\)/.test(r.formula), r.model + ' | ' + r.fixture);
  report.check('…und liefert C = 1 nF, ESL = 1 nH', Math.abs(number(r.metrics['C · Plateau unterhalb SRF']) / 1 - 1) < 0.03 && Math.abs(number(r.metrics['ESL · oberhalb SRF']) / 1 - 1) < 0.1, JSON.stringify(r.metrics));

  r = await open('Drossel_Eintor.s1p');
  report.check('.s1p Drossel: Eintor-Fixture, kein „Ausgang“ nötig, kein leeres Feld', /induktiv/.test(r.model) && /Eintor/.test(r.fixture) && !r.output && !r.empty && /Z₀\(1 \+ S₁₁\)\/\(1 − S₁₁\)/.test(r.formula), r.model + ' | ' + r.fixture + ' | ' + r.empty);
  report.check('.s1p Drossel: L = 10 µH', Math.abs(number(r.metrics['L · LC-Fit unterhalb SRF']) / 10 - 1) < 0.03, r.metrics['L · LC-Fit unterhalb SRF']);

  r = await open('Kondensator_Eintor.s1p');
  report.check('.s1p Kondensator: kapazitives Modell, C = 1 nF', /kapazitiv/.test(r.model) && /Eintor/.test(r.fixture) && Math.abs(number(r.metrics['C · Plateau unterhalb SRF']) / 1 - 1) < 0.03, r.model + ' · ' + r.metrics['C · Plateau unterhalb SRF']);

  r = await open('Widerstand_Serie.s2p');
  report.check('Widerstand: Erkennung „nicht eindeutig“, Hinweis zur eigenen Modellwahl', /nicht eindeutig/.test(r.model) && r.unclear, r.model + ' | ' + r.note.slice(0, 80));
  await page.selectOption('#control-esb-model', 'shunt'); await ready();
  r = await open('Widerstand_Serie.s2p');
  report.check('Benutzer kann das Modell selbst wählen; die Wahl bleibt und der Hinweis verschwindet', r.value === 'shunt' && !r.unclear);
  await page.selectOption('#control-esb-fixture', 'shunt'); await ready();
  report.check('Fixture lässt sich getrennt vom Modell wählen', /\(Z₀\/2\)·S₂₁\/\(1 − S₂₁\)/.test(await page.textContent('#esb-formula')));
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-esb.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-esb.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
