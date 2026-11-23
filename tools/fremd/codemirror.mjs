// Baut src/js/fremd/codemirror.js aus den in package.json fest eingetragenen CodeMirror-Paketen (MIT-Lizenz).
// Der Block stellt die globale Variable CodeMirror6 bereit; der Editor selbst steht lesbar in src/app/module/quelltext/codeeditor.js.
// Aufruf: npm install && node tools/fremd/codemirror.mjs && python3 tools/build.py
// Der Kopf des erzeugten Blocks nennt jedes enthaltene Paket mit Version und vollem Lizenztext (aus node_modules gelesen).
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const target = path.join(root, 'src/js/fremd/codemirror.js');
const entry = `
export { EditorView, ViewPlugin, Decoration, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
export { EditorState, EditorSelection, StateEffect } from '@codemirror/state';
export { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
export { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
`;
const result = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: 'iife', globalName: 'CodeMirror6',
  minify: true, target: 'es2020', legalComments: 'none', metafile: true, write: false, charset: 'utf8',
});
let code = result.outputFiles[0].text;
if (/<\/script/i.test(code)) code = code.replace(/<\/script/gi, '<\\/script');

// Packages that actually ended up in the bundle, from the build's own input list.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (m) packages.set(m[1], path.join(root, 'node_modules', m[1]));
}
const notices = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find(f => /^licen[sc]e/i.test(f));
  if (!file) throw new Error('Kein Lizenztext in ' + name);
  if (pkg.license !== 'MIT') throw new Error(name + ' hat nicht die MIT-Lizenz, sondern ' + pkg.license);
  const text = fs.readFileSync(path.join(dir, file), 'utf8').trim().replaceAll('*/', '* /');
  return name + '@' + pkg.version + ' · ' + pkg.license + '\n\n' + text;
});
const header = '/*! Drittkomponenten in diesem Block · erzeugt von tools/fremd/codemirror.mjs, nicht von Hand ändern\n\n' +
  notices.join('\n\n----------------------------------------------------------------------\n\n') + '\n*/\n';
fs.writeFileSync(target, header + code);
console.log('src/js/fremd/codemirror.js · ' + packages.size + ' Pakete · ' + Math.round((header.length + code.length) / 1024) + ' KiB');
console.log([...packages.keys()].map(n => '  ' + n).join('\n'));
