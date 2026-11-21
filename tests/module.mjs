// Prüft die Modulgrenzen in src/app: jedes Modul benutzt nur, was es importiert oder was der Browser bzw. ein Rechenkern
// global bereitstellt. Außerdem: Importe zeigen auf exportierte Namen, Exporte sind definiert, keine ungenutzten Importe.
// Braucht die Entwicklungspakete (npm install).
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as escope from 'eslint-scope';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = path.join(root, 'src/app');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };

// Globale Namen, die Module benutzen dürfen: Rechenkerne und Bibliotheken der Seite sowie die Browser-Umgebung.
const PAGE = ['RF', 'Spice', 'Magnetic', 'TD', 'Connector', 'Store', 'Plot', 'Zip', 'Theme'];
const BROWSER = `AbortController Array ArrayBuffer Blob Boolean CSS CustomEvent Date DOMParser Error Event File FileReader Float32Array
  Float64Array FormData Infinity Int32Array Int8Array Intl JSON Map Math MouseEvent NaN Number Object Promise Proxy RangeError Reflect
  RegExp Set String Symbol TextDecoder TextEncoder TypeError URL URLSearchParams Uint8Array Uint16Array Uint32Array WeakMap WeakSet
  Worker atob btoa caches cancelAnimationFrame clearInterval clearTimeout console crypto decodeURIComponent encodeURIComponent
  document fetch getComputedStyle history indexedDB isFinite isNaN localStorage location matchMedia navigator parseFloat parseInt
  performance queueMicrotask requestAnimationFrame requestIdleCallback setInterval setTimeout structuredClone undefined window`.split(/\s+/);
const allowed = new Set([...PAGE, ...BROWSER]);

const files = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') && files.push(path.join(dir, e.name)); })(app);
const rel = f => path.relative(app, f).split(path.sep).join('/');
const mods = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true }); }
  catch (error) { check(rel(file) + ' lässt sich als Modul lesen', false, error.message); continue; }
  mods.set(rel(file), { file, text, ast });
}
const exportsOf = new Map();
for (const [name, m] of mods) {
  const ex = [];
  for (const node of m.ast.body) if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration || node.source) check(name + ': nur „export { … }“-Listen', false, 'Zeile ' + node.loc.start.line);
    for (const s of node.specifiers) ex.push(s.exported.name);
  } else if (/^Export/.test(node.type)) check(name + ': keine Default-Exporte', false, 'Zeile ' + node.loc.start.line);
  exportsOf.set(name, new Set(ex));
}
const owner = new Map();
for (const [name, ex] of exportsOf) for (const n of ex) owner.set(n, [...(owner.get(n) || []), name]);

let undeclared = [], unknownImports = [], unusedImports = [], unknownGlobals = [];
for (const [name, m] of mods) {
  const scopes = escope.analyze(m.ast, { ecmaVersion: 2022, sourceType: 'module' });
  const moduleScope = scopes.globalScope.childScopes[0];
  for (const node of m.ast.body) if (node.type === 'ImportDeclaration') {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), node.source.value));
    for (const s of node.specifiers) {
      if (s.type !== 'ImportSpecifier') { unknownImports.push(name + ': nur benannte Importe'); continue; }
      if (!exportsOf.get(target)?.has(s.imported.name)) unknownImports.push(name + ': ' + s.imported.name + ' aus ' + target);
      const v = moduleScope.set.get(s.local.name);
      if (v && !v.references.length) unusedImports.push(name + ': ' + s.local.name);
    }
  }
  for (const ref of scopes.globalScope.through) {
    const n = ref.identifier.name, where = name + ':' + ref.identifier.loc.start.line + ' ' + n;
    if (owner.has(n)) undeclared.push(where + ' (Export von ' + owner.get(n).join(', ') + ')');
    else if (!allowed.has(n)) unknownGlobals.push(where);
  }
  for (const n of exportsOf.get(name)) if (!moduleScope.set.has(n)) undeclared.push(name + ': exportiert ' + n + ', definiert es aber nicht');
}
const uniq = list => [...new Set(list)];
check('Kein Modul benutzt Namen eines anderen Moduls, ohne sie zu importieren', !undeclared.length, uniq(undeclared).slice(0, 8).join('; '));
check('Alle Importe zeigen auf exportierte Namen', !unknownImports.length, uniq(unknownImports).slice(0, 8).join('; '));
check('Keine unbekannten globalen Namen (sonst in die Liste in tests/module.mjs aufnehmen)', !unknownGlobals.length, uniq(unknownGlobals).slice(0, 8).join('; '));
check('Keine ungenutzten Importe', !unusedImports.length, uniq(unusedImports).slice(0, 8).join('; '));
// Schichten: basis/ hängt von nichts ab; analyse/, dateien/ und oberflaeche/ nicht von den Fachmodulen in module/;
// ein Fachmodul (module/<name>.js oder module/<name>/) nicht von einem anderen. Fachmodule hängen sich über basis/erweiterung.js an.
const pkg = name => { const parts = name.split('/'); return parts[0] !== 'module' ? parts[0] : 'module/' + parts[1].replace(/\.js$/, ''); };
const layer = [];
for (const [name, m] of mods) for (const node of m.ast.body) if (node.type === 'ImportDeclaration') {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), node.source.value)), a = pkg(name), b = pkg(target);
  if ((a === 'basis' && b !== 'basis') || (!a.startsWith('module') && b.startsWith('module')) || (a.startsWith('module') && b.startsWith('module') && a !== b)) layer.push(name + ' → ' + target);
}
check('Schichten eingehalten (basis → nichts, Kern → keine Fachmodule, Fachmodule → nicht untereinander)', !layer.length, layer.slice(0, 8).join('; '));
const big = [...mods].map(([n, m]) => [n, m.text.split('\n').length]).filter(([, l]) => l > 700);
check('Kein Modul über 700 Zeilen (sonst aufteilen)', !big.length, big.map(([n, l]) => n + ' ' + l).join(', '));
console.log(`${fail ? 'FAIL' : 'PASS'} · Modulgrenzen · ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
