// Ordnet die import- und export-Zeilen aller Module in src/app neu, nachdem Code zwischen Modulen verschoben wurde:
//   - benutzt ein Modul einen Namen, den ein anderes Modul auf oberster Ebene definiert, wird er dort exportiert und hier importiert,
//   - ungenutzte Importe fallen weg, Exporte, die niemand importiert, ebenfalls (außer sie stehen hinter „// öffentlich:“).
// Aufruf: node tools/importe.mjs [--check]   (braucht die Entwicklungspakete: npm install)
// Mit --check wird nichts geschrieben; der Exit-Code ist 1, wenn sich etwas ändern würde.
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as escope from 'eslint-scope';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = path.join(root, 'src/app');
const check = process.argv.includes('--check');
const files = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') && files.push(path.join(dir, e.name)); })(app);
const rel = f => path.relative(app, f).split(path.sep).join('/');
const parse = text => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', ranges: true, locations: true });

const mods = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const ast = parse(text.replace(/^import \{[^}]*\} from '[^']+';[ \t]*\n/gm, '').replace(/^export \{[^}]*\};[ \t]*\n?/gm, ''));
  const top = new Set();
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') top.add(node.id.name);
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') top.add(d.id.name);
  }
  const keep = new Set((text.match(/^\/\/ öffentlich: (.*)$/m)?.[1] || '').split(/[\s,]+/).filter(Boolean));
  mods.set(rel(file), { file, text, ast, top, keep });
}
const definers = new Map();
for (const [name, m] of mods) for (const n of m.top) definers.set(n, [...(definers.get(n) || []), name]);

const need = new Map(), problems = [];
for (const [name, m] of mods) {
  // free names of the module without its import and export lines
  const free = new Set(escope.analyze(m.ast, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through.map(r => r.identifier.name));
  const want = new Map();
  for (const n of free) {
    const from = (definers.get(n) || []).filter(d => d !== name);
    if (from.length === 1) want.set(n, from[0]);
    else if (from.length > 1) problems.push(name + ': ' + n + ' ist in mehreren Modulen definiert (' + from.join(', ') + ')');
  }
  need.set(name, want);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(2); }
const exported = new Map([...mods.keys()].map(n => [n, new Set(mods.get(n).keep)]));
for (const want of need.values()) for (const [n, from] of want) exported.get(from).add(n);

const relPath = (from, to) => { const r = path.posix.relative(path.posix.dirname(from), to); return r.startsWith('.') ? r : './' + r; };
const wrap = (open, names, close) => {
  const lines = []; let line = open;
  for (const n of names) { if ((line + ' ' + n + ',').length > 118) { lines.push(line); line = ' '; } line += ' ' + n + ','; }
  lines.push(line.replace(/,$/, '') + close);
  return lines.join('\n');
};
let changed = 0;
for (const [name, m] of mods) {
  const bySrc = {};
  for (const [n, from] of need.get(name)) (bySrc[from] ??= []).push(n);
  const imports = Object.keys(bySrc).sort().map(src => wrap('import {', bySrc[src].sort(), " } from '" + relPath(name, src) + "';"));
  let text = m.text.replace(/^import \{[^}]*\} from '[^']+';[ \t]*\n/gm, '').replace(/\n*^export \{[^}]*\};[ \t]*\n?/gm, '\n');
  // imports go after the leading comment block
  const lines = text.split('\n'); let i = 0;
  while (i < lines.length && lines[i].startsWith('//')) i++;
  const head = lines.slice(0, i), rest = lines.slice(i).join('\n').replace(/^\n*/, '');
  const order = [...m.top].filter(n => exported.get(name).has(n));
  text = head.join('\n') + '\n' + (imports.length ? imports.join('\n') + '\n' : '') + '\n' + rest.replace(/\n*$/, '\n') +
    (order.length ? '\n' + wrap('export {', order, ' };') + '\n' : '');
  if (text !== m.text) { changed++; if (!check) fs.writeFileSync(m.file, text); console.log((check ? 'würde ändern: ' : 'geändert: ') + name); }
}
console.log(changed ? changed + ' Module ' + (check ? 'nicht aktuell' : 'angepasst') : 'Importe und Exporte sind aktuell');
process.exit(check && changed ? 1 : 0);
