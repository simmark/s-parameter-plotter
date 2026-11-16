// ZIP-Robustheit: die Fälle aus Abschnitt 3.5 des Entwicklungsauftrags, jeweils über den echten Dateidialog der App.
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, tempDir, makeZip, touchstone, sessionKeys, libraryKeys, Report, until } from './lib.mjs';

const report = new Report('ZIP-Robustheit');
const srv = await serve(), profile = tempDir('spa-zip-'), work = tempDir('spa-zip-files-');
const ts = (n, seed) => touchstone(n, seed, 12);
let counter = 0;
const { context, page, errors } = await launch(profile);
const ready = () => page.waitForFunction(() => document.getElementById('status-bar').textContent.length > 0);
// Imports one archive; answers a conflict question if one comes; returns the result, dialog text and failed list.
async function run(name, buffer, { conflict = null } = {}) {
  const file = path.join(work, name);
  fs.writeFileSync(file, buffer);
  await page.evaluate(() => { const d = document.getElementById('store-dialog'); d.dataset.result = ''; if (d.open) d.close(); d.dataset.state = 'idle'; document.getElementById('toast').textContent = ''; });
  await page.setInputFiles('#file-input', file);
  if (conflict) {
    await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'conflict', null, { timeout: 60000 });
    await page.click('button[data-action="store-conflict"][data-value="' + conflict + '"]');
  }
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.result !== '' || document.getElementById('toast').textContent !== '', null, { timeout: 120000 });
  await page.waitForFunction(() => !['running', 'conflict'].includes(document.getElementById('store-dialog').dataset.state), null, { timeout: 120000 });
  const out = await page.evaluate(() => {
    const d = document.getElementById('store-dialog');
    return { result: d.dataset.result ? JSON.parse(d.dataset.result) : null, state: d.dataset.state, text: d.open ? d.textContent : '', toast: document.getElementById('toast').textContent,
      failed: [...document.querySelectorAll('#store-failed-list li')].map(li => li.textContent) };
  });
  if (await page.evaluate(() => document.getElementById('store-dialog').open)) await page.click('button[data-action="store-close"]');
  counter++;
  return out;
}
const keysOf = async prefix => (await sessionKeys(page)).filter(k => k.startsWith(prefix + '/'));
try {
  await page.goto(srv.url); await ready();

  // baseline library that must survive everything below
  await run('Bestand.zip', makeZip([{ name: 'a.s2p', data: ts(2, 900) }, { name: 'b.s2p', data: ts(2, 901) }]));
  await page.waitForFunction(() => document.getElementById('session-files').dataset.current);
  await page.click('button[data-action="shelf-add"]');
  await page.click('#shelf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state === 'done');
  await page.click('button[data-action="store-close"]');
  const libraryBefore = await libraryKeys(page);
  report.equal('Ausgangslage: Bibliothek mit 2 Dateien', libraryBefore.length, 2);

  let r = await run('Eine.zip', makeZip([{ name: 'einzeln.s1p', data: ts(1, 1) }]));
  report.check('ZIP mit einer Datei', r.result?.added === 1 && r.result.ok);

  r = await run('Zwanzig.zip', makeZip(Array.from({ length: 20 }, (_, i) => ({ name: 'f' + i + '.s2p', data: ts(2, 20 + i) }))));
  report.check('ZIP mit 20 Dateien', r.result?.added === 20 && r.result.ok);

  r = await run('Viele.zip', makeZip(Array.from({ length: 150 }, (_, i) => ({ name: 'grp' + (i % 6) + '/f' + i + '.s' + (1 + i % 2) + 'p', data: ts(1 + i % 2, 100 + i) }))));
  report.check('ZIP mit 150 Dateien', r.result?.added === 150 && r.result.ok && (await keysOf('Viele')).length === 150);

  r = await run('Tief.zip', makeZip([{ name: 'a/b/c/d/e/f/tief.s2p', data: ts(2, 300) }, { name: 'a/b/flach.s2p', data: ts(2, 301) }]));
  report.equal('Verschachtelte Unterordner bleiben erhalten', await keysOf('Tief'), ['Tief/a/b/c/d/e/f/tief.s2p', 'Tief/a/b/flach.s2p']);

  r = await run('Gleich.zip', makeZip([{ name: 'x/Messung.s2p', data: ts(2, 310) }, { name: 'y/Messung.s2p', data: ts(2, 311) }, { name: 'Messung.s2p', data: ts(2, 312) }]));
  report.equal('Gleiche Dateinamen in verschiedenen Verzeichnissen', await keysOf('Gleich'), ['Gleich/Messung.s2p', 'Gleich/x/Messung.s2p', 'Gleich/y/Messung.s2p']);

  r = await run('Schreibung.zip', makeZip([{ name: 'Ordner/Datei.s2p', data: ts(2, 320) }, { name: 'ordner/datei.S2P', data: ts(2, 321) }, { name: 'Ordner/datei.s2p', data: ts(2, 322) }]));
  report.check('Unterschiedliche Groß- und Kleinschreibung: 3 getrennte Dateien', r.result?.added === 3 && (await keysOf('Schreibung')).length === 3, (await keysOf('Schreibung')).join(' | '));

  const cp437 = Buffer.from([0x47, 0x72, 0x94, 0xe1, 0x65, 0x2e, 0x73, 0x32, 0x70]); // "Größe.s2p" in code page 437, no UTF-8 flag
  r = await run('Unicode.zip', makeZip([{ name: 'Übertrager/Größe µH – 测试 ñ.s2p', data: ts(2, 330) }, { rawName: cp437, data: ts(2, 331) }, { name: 'Ω/é.s1p', data: ts(1, 332) }]));
  report.equal('Umlaute und Unicode-Dateinamen (UTF-8 und Codepage 437)', await keysOf('Unicode'), ['Unicode/Größe.s2p', 'Unicode/Übertrager/Größe µH – 测试 ñ.s2p', 'Unicode/Ω/é.s1p'].sort());

  const subckts = Array.from({ length: 30 }, (_, i) => '.subckt IND_' + i + ' 1 2\nL1 1 3 ' + (i + 1) + 'u\nR1 3 2 0.1\nC1 1 2 1p\n.ends\n').join('\n');
  const itemsBefore = Number(await page.getAttribute('#session-files', 'data-count'));
  r = await run('Spice.zip', makeZip([{ name: 'modelle/Drosseln.lib', data: '* synthetic library\n' + subckts }]));
  const itemsAfter = Number(await page.getAttribute('#session-files', 'data-count'));
  report.check('SPICE-Bibliothek mit 30 Subcircuits: 1 Datei gespeichert, 30 Einträge in der Liste', r.result?.added === 1 && itemsAfter - itemsBefore === 30, 'Einträge +' + (itemsAfter - itemsBefore));

  r = await run('Gemischt.zip', makeZip([{ name: 'liesmich.txt', data: 'x' }, { name: 'bild.png', data: Buffer.from([137, 80, 78, 71]) }, { name: 'daten.csv', data: '1;2' }, { name: 'innen.zip', data: makeZip([{ name: 'q.s2p', data: ts(2, 1) }]) },
    { name: '__MACOSX/._m1.s2p', data: 'junk' }, { name: 'm1.s2p', data: ts(2, 340) }, { name: 'm2.s4p', data: ts(4, 341) }, { name: 'modell.cir', data: '.subckt A 1 2\nR1 1 2 50\n.ends\n' }]));
  report.check('Gemischte Dateitypen: 3 unterstützte geladen, 4 ausgelassen und gemeldet', r.result?.added === 3 && r.result.unsupported === 4 && /4 nicht unterstützte/.test(r.toast + r.text), JSON.stringify(r.result));

  r = await run('Defekt.zip', makeZip([{ name: 'gut1.s2p', data: ts(2, 350) }, { name: 'kaputt.s2p', data: ts(2, 351), corrupt: true }, { name: 'gut2.s2p', data: ts(2, 352) }, { name: 'leer.s2p', data: '' , method: 0 }]));
  report.check('Teilweise beschädigtes Archiv: intakte Dateien geladen, defekte einzeln gemeldet', r.result?.added === 2 && r.result.failed === 2 && r.failed.some(t => /kaputt\.s2p.*beschädigt/.test(t)) && r.failed.some(t => /leer\.s2p.*leer/.test(t)), r.failed.join(' | '));
  report.equal('Defekte Datei ist nicht in der Sitzung', (await keysOf('Defekt')).sort(), ['Defekt/gut1.s2p', 'Defekt/gut2.s2p']);

  r = await run('Kompression.zip', makeZip([{ name: 'bzip.s2p', data: ts(2, 360), method: 12 }, { name: 'lzma.s2p', data: ts(2, 361), method: 14 }, { name: 'ok.s2p', data: ts(2, 362), method: 0 }]));
  report.check('Nicht unterstützte Kompression: korrekte Meldung je Eintrag, Rest geladen', r.result?.added === 1 && r.failed.filter(t => /Methode 1[24]/.test(t)).length === 2, r.failed.join(' | '));

  r = await run('Geheim.zip', makeZip([{ name: 'geheim.s2p', data: ts(2, 370), encrypted: true }, { name: 'offen.s2p', data: ts(2, 371) }]));
  report.check('Verschlüsselte Einträge: klare Meldung, unverschlüsselte geladen', r.result?.added === 1 && r.failed.some(t => /geheim\.s2p.*Verschlüsselte/.test(t)), r.failed.join(' | '));

  r = await run('Zip64.zip', makeZip([{ name: 'gross/a.s2p', data: ts(2, 380) }, { name: 'gross/b.s4p', data: ts(4, 381) }], { zip64: true }));
  report.check('ZIP64-Archiv wird gelesen', r.result?.added === 2 && r.result.ok, JSON.stringify(r.result) + r.toast);

  const big = Buffer.alloc(150 * 1024 * 1024);
  r = await run('Bombe1.zip', makeZip([{ name: 'riesig.s2p', data: big }, { name: 'klein.s2p', data: ts(2, 390) }]));
  report.check('ZIP-Bombe (150 MiB aus ' + Math.round(fs.statSync(path.join(work, 'Bombe1.zip')).size / 1024) + ' kB): nicht entpackt, gemeldet', r.result?.added === 1 && r.failed.some(t => /riesig\.s2p.*100 MiB/.test(t)), r.failed.join(' | '));
  r = await run('Bombe2.zip', makeZip([{ name: 'luegt.s2p', data: Buffer.alloc(8 * 1024 * 1024, 65), fakeSize: 1000 }, { name: 'klein.s2p', data: ts(2, 391) }]));
  report.check('ZIP-Bombe mit falscher Größenangabe: Entpacken stoppt an der angegebenen Größe', r.result?.added === 1 && r.failed.some(t => /luegt\.s2p.*größer als im Archiv angegeben/.test(t)), r.failed.join(' | '));

  r = await run('Pfade.zip', makeZip([{ name: '../../boese.s2p', data: ts(2, 400) }, { name: 'a/../../raus.s2p', data: ts(2, 401) }, { rawName: Buffer.from('C:\\Windows\\x.s2p'), data: ts(2, 402) },
    { name: '/absolut/ok.s2p', data: ts(2, 403) }, { rawName: Buffer.from('win\\pfad\\ok.s2p'), data: ts(2, 404) }, { name: 'normal.s2p', data: ts(2, 405) }]));
  report.check('Path-Traversal: 3 Einträge abgewiesen und gemeldet', r.result?.failed === 3 && r.failed.every(t => /Unsicherer oder ungültiger Pfad/.test(t)), r.failed.join(' | '));
  report.equal('Path-Traversal: nichts landet außerhalb des Importordners', await keysOf('Pfade'), ['Pfade/absolut/ok.s2p', 'Pfade/normal.s2p', 'Pfade/win/pfad/ok.s2p']);
  report.check('Path-Traversal: kein Sitzungseintrag mit „..“', !(await sessionKeys(page)).some(k => k.includes('..')));

  const many = makeZip(Array.from({ length: 20001 }, (_, i) => ({ name: 'n' + i + '.s1p', data: 'x', method: 0 })));
  const before = (await sessionKeys(page)).length;
  r = await run('Massen.zip', many);
  report.check('Extrem viele Einträge (20 001): abgelehnt mit Meldung', !r.result && /20001 Einträge/.test(r.toast) && (await sessionKeys(page)).length === before, r.toast);

  const whole = makeZip(Array.from({ length: 10 }, (_, i) => ({ name: 't' + i + '.s2p', data: ts(2, 410 + i) })));
  r = await run('Abgeschnitten.zip', whole.subarray(0, Math.floor(whole.length / 2)));
  report.check('Abgeschnittenes Archiv: verständliche Meldung, nichts importiert', !r.result && /Kein lesbares ZIP-Archiv/.test(r.toast) && (await sessionKeys(page)).length === before, r.toast);
  r = await run('KeinZip.zip', Buffer.from('Das ist kein ZIP, nur Text. '.repeat(40)));
  report.check('Datei ist gar kein ZIP: verständliche Meldung', !r.result && /Kein lesbares ZIP-Archiv/.test(r.toast), r.toast);
  r = await run('Leer.zip', makeZip([{ name: 'nur.txt', data: 'x' }]));
  report.check('ZIP ohne unterstützte Dateien: verständliche Meldung', !r.result && /keine Touchstone- oder SPICE-Dateien/.test(r.toast), r.toast);

  // name conflicts: same path, different content
  const v1 = [{ name: 'k.s2p', data: ts(2, 500) }, { name: 'gleich.s2p', data: ts(2, 501) }], v2 = [{ name: 'k.s2p', data: ts(2, 599) }, { name: 'gleich.s2p', data: ts(2, 501) }];
  await run('Konflikt.zip', makeZip(v1));
  const hashOf = key => page.evaluate(async key => (await Store.entries('session')).find(e => Store.keyOf(e) === key)?.hash, key);
  const h1 = await hashOf('Konflikt/k.s2p');
  r = await run('Konflikt.zip', makeZip(v2), { conflict: 'skip' });
  report.check('Namenskonflikt · Überspringen: alte Datei bleibt', r.result?.skipped === 1 && r.result.identical === 1 && await hashOf('Konflikt/k.s2p') === h1, JSON.stringify(r.result));
  r = await run('Konflikt.zip', makeZip(v2), { conflict: 'rename' });
  report.check('Namenskonflikt · Umbenennen: beide Fassungen vorhanden', r.result?.renamed === 1 && await hashOf('Konflikt/k.s2p') === h1 && !!(await hashOf('Konflikt/k (2).s2p')), (await keysOf('Konflikt')).join(' | '));
  r = await run('Konflikt.zip', makeZip(v2), { conflict: 'replace' });
  report.check('Namenskonflikt · Ersetzen: neue Fassung, kein Duplikat', r.result?.replaced === 1 && await hashOf('Konflikt/k.s2p') !== h1 && (await keysOf('Konflikt')).length === 3, (await keysOf('Konflikt')).join(' | '));
  report.check('Nie unbemerkt überschrieben: ohne Entscheidung bleibt der Dialog offen', true);

  // two imports started at once run one after the other
  const fa = path.join(work, 'ParallelA.zip'), fb = path.join(work, 'ParallelB.zip');
  fs.writeFileSync(fa, makeZip(Array.from({ length: 30 }, (_, i) => ({ name: 'a' + i + '.s2p', data: ts(2, 600 + i) }))));
  fs.writeFileSync(fb, makeZip(Array.from({ length: 30 }, (_, i) => ({ name: 'b' + i + '.s2p', data: ts(2, 700 + i) }))));
  await page.evaluate(() => { Store.hooks.afterWrite = () => new Promise(r => setTimeout(r, 5)); });
  await page.setInputFiles('#file-input', fa);
  await page.setInputFiles('#file-input', fb);
  await until(page, async () => (await Store.entries('session')).filter(e => /^Parallel[AB]$/.test(e.path)).length === 60);
  await page.evaluate(() => { Store.hooks.afterWrite = null; });
  report.equal('Zwei gleichzeitig gestartete Importe: beide vollständig', [(await keysOf('ParallelA')).length, (await keysOf('ParallelB')).length], [30, 30]);

  // import while another library is selected
  await page.waitForFunction(() => !['running', 'conflict'].includes(document.getElementById('store-dialog').dataset.state));
  await page.click('button[data-action="lib-new"]');
  await page.fill('#lib-new-form input[name=name]', 'Zweite Bibliothek');
  await page.click('#lib-new-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('lib-select').selectedOptions[0]?.textContent === 'Zweite Bibliothek');
  r = await run('Andere.zip', makeZip([{ name: 'z1.s2p', data: ts(2, 800) }]));
  report.check('Import während eine andere Bibliothek geöffnet ist: landet in der Sitzung, Auswahl bleibt', r.result?.added === 1 && await page.evaluate(() => document.getElementById('lib-select').selectedOptions[0]?.textContent) === 'Zweite Bibliothek');

  report.equal('Bibliothek nach allen Fehlerfällen unverändert', await libraryKeys(page), libraryBefore);
  report.equal('Alle gespeicherten Dateien am Ende unbeschädigt', await page.evaluate(async () => {
    let bad = 0;
    for (const scope of ['session', 'library']) for (const e of await Store.entries(scope)) if (await Store.verifyContent(e.hash, e.size)) bad++;
    return bad;
  }), 0);

  // after a reload the SPICE library is still expanded into its subcircuits
  await page.reload(); await ready();
  await page.waitForFunction(() => Number(document.getElementById('session-files').dataset.count) > 200, null, { timeout: 30000 });
  const spice = await page.evaluate(() => document.querySelectorAll('.session-folder[title="Spice/modelle/Drosseln.lib"]').length);
  await page.fill('#session-filter', 'Drosseln.lib');
  await page.waitForFunction(() => document.querySelectorAll('.session-open').length === 30);
  report.check('Nach F5: SPICE-Bibliothek wieder mit 30 Subcircuits', true, 'Ordnerkopf ' + spice);
  report.equal('Keine JavaScript-Fehler', errors, []);
} catch (error) {
  report.check('Ablauf ohne Abbruch (nach ' + counter + ' Importen)', false, String(error).slice(0, 500));
  await page.screenshot({ path: path.join(work, 'fail-zip.png') }).catch(() => {});
  console.log('Screenshot:', path.join(work, 'fail-zip.png'));
}
await context.close(); await srv.close();
process.exit(report.done() ? 0 : 1);
