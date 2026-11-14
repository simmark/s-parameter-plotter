// Shared loader for magnetic analysis experiments and tests: RF + Spice from the app, private data paths.
import fs from 'node:fs';
import path from 'node:path';
export const APP = process.env.SPA_APP || new URL('../index.html', import.meta.url).pathname;
export const DATA = process.env.SPA_PRIVATE_DATA || '';
export function load(app = APP) {
  const html = fs.readFileSync(app, 'utf8');
  const rf = html.match(/<script[^>]*>\s*'use strict';\s*(const RF = \(\(\) => \{[\s\S]*?\n\}\)\(\);)/)[1];
  const RF = new Function(rf + '\nreturn RF;')();
  const sp = html.match(/<script id="spice-core">([\s\S]*?)<\/script>/)[1];
  const Spice = new Function('RF', sp + '\nreturn Spice;')(RF);
  const mm = html.match(/<script id="magnetic-core">([\s\S]*?)<\/script>/);
  const Magnetic = mm ? new Function('RF', mm[1] + '\nreturn Magnetic;')(RF) : null;
  return { RF, Spice, Magnetic };
}
export const read = (RF, file) => RF.parseTouchstone(fs.readFileSync(file, 'latin1'), path.basename(file));
export const list = (dir, re = /\.s\d+p$/i) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f)) : [];
