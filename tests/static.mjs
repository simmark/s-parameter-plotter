// Statische Prüfungen ohne Browser: Lizenztext, Urheberhinweise, Zusammenbau aus src/, Cache-Version, Skript-Syntax, keine Herstellerdaten im Repository.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
const html = read('index.html'), license = read('LICENSE.txt'), readme = read('README.md');
const unescape = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const embedded = html.match(/<pre id="license-text"[^>]*>([\s\S]*?)<\/pre>/);
check('LICENSE.txt ist vollständig und unverändert in der App hinterlegt', !!embedded && unescape(embedded[1]) === license);
check('LICENSE.txt enthält die deutsche und die englische Fassung', /Proprietäre Software – Nutzungsbedingungen/.test(license) && /Proprietary Software – License Terms/.test(license));
check('Kontakt und Rechteinhaber', (license.match(/Simon Mark\ninfo\.simonlation@gmail\.com/g) || []).length === 2 && /Copyright © 2026 Simon Mark\. Alle Rechte vorbehalten\./.test(license));
check('Keine Open-Source-Lizenz', /nicht unter MIT, GPL, Apache/.test(license) && /not released under the MIT, GPL, Apache/.test(license));
check('Kurzhinweis im Interface sichtbar', html.includes('<p class="legal-line"><span data-no-i18n>© 2026 Simon Mark · All rights reserved · Proprietary software</span>'));
check('Urheberhinweis im Quelltextkopf', /<!--[\s\S]{0,200}© 2026 Simon Mark[\s\S]{0,400}LICENSE\.txt[\s\S]*?-->/.test(html.slice(0, 1200)));
check('README verweist auf LICENSE.txt (deutsch und englisch)', (readme.match(/LICENSE\.txt/g) || []).length >= 2 && /Alle Rechte vorbehalten/.test(readme) && /All rights reserved/.test(readme));
check('Lizenz in „Methodik / Info“ aufrufbar (deutsch und englisch)', (html.match(/data-action="license"/g) || []).length >= 3);
check('Nichts wird von außen nachgeladen (keine fremden Skriptdateien, Schriften, Stylesheets)', !/<script[^>]+src=|<link[^>]+rel="stylesheet"|@font-face|@import/.test(html));
// Third-party code only in its own blocks <script id="fremd-…">, each opening with its license texts; nowhere else.
{
  const blocks = [...html.matchAll(/<script id="(fremd-[^"]+)">\n([\s\S]*?)<\/script>/g)];
  const bad = blocks.filter(([, id, code]) => !/^\/\*! Drittkomponenten[\s\S]*?MIT[\s\S]*?\*\//.test(code)).map(([, id]) => id);
  check('Drittkomponenten nur in eigenen Blöcken mit vollem Lizenztext am Anfang', blocks.length >= 1 && !bad.length, blocks.map(b => b[1]).join(', ') + (bad.length ? ' · ohne Lizenzkopf: ' + bad.join(', ') : ''));
  const rest = html.replace(/<script id="fremd-[^"]+">[\s\S]*?<\/script>/g, '');
  check('Außerhalb dieser Blöcke kein fremder Lizenzkopf (kein eingeschmuggelter Fremdcode)', !/MIT License|@license|Permission is hereby granted/.test(rest.replace(/<pre id="license-text"[\s\S]*?<\/pre>/, '')));
}

let syntax = 0;
for (const [, body] of html.matchAll(/<script(?: id="[^"]*")?>\n([\s\S]*?)<\/script>/g)) { try { new vm.Script(body); } catch (error) { syntax++; console.log('    ' + error.message); } }
check('Alle Skriptblöcke sind syntaktisch gültig', syntax === 0);
for (const id of ['rf-core', 'spice-core', 'magnetic-core', 'store-core']) check('Baustein „' + id + '“ ist als eigener Block getrennt', html.includes('<script id="' + id + '">'));
const store = html.match(/<script id="store-core">\n([\s\S]*?)<\/script>/)[1];
check('Speicherkern greift nicht auf die Oberfläche zu (kein document, kein window)', !/\bdocument\.|\bwindow\./.test(store));

let current = false;
try { execFileSync('python3', [path.join(root, 'tools/build.py'), '--check'], { stdio: 'pipe' }); current = true; } catch { current = false; }
check('index.html entspricht src/ und sw.js trägt die aktuelle Cache-Version (sonst fehlen Änderungen oder die installierte App aktualisiert sich nicht)', current, current ? '' : 'python3 tools/build.py ausführen');

// Only synthetic reference data may be published.
let tracked = [];
try { tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).trim().split('\n'); } catch { tracked = []; }
const data = tracked.filter(file => /\.(s\d+p|snp|ts|lib|cir|sub|zip)$/i.test(file));
check('Keine Mess- oder Modelldateien im Repository (Tests erzeugen synthetische Daten)', tracked.length > 0 && data.length === 0, data.join(', '));

console.log((fail ? 'FAIL' : 'PASS') + ' · Statische Prüfungen · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
