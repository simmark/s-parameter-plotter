// Fährt alle Tests nacheinander und gibt eine Übersicht aus:  node tests/e2e/run.mjs   (Option --fast: ohne Browser)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), fast = process.argv.includes('--fast');
const suites = [
  ['Statische Prüfungen', '../static.mjs'], ['Modulgrenzen', '../module.mjs'], ['Bauteil-Erkennung', '../magnetic.unit.mjs'], ['E · RF-Mathematik', '../rf.reference.mjs'], ['Connector · Kern', '../connector.mjs'], ['Multiport und 0/α/β · Kern', '../multiport.mjs'], ['Zeitbereich und Auge · Kern', '../timedomain.mjs'], ['Testpaket (SPA_PACK)', '../pack.mjs'],
  ...(fast ? [] : [['A · ZIP und Refresh', 'a-zip-refresh.mjs'], ['B · Gesamtes ZIP in Bibliothek', 'b-zip-library.mjs'], ['C · Unvollständige Importe', 'c-interrupted-import.mjs'],
    ['D · Mobile Ansicht', 'd-mobile.mjs'], ['ZIP-Robustheit', 'zip-robust.mjs'], ['Speicher, Sicherung, Migration', 'storage.mjs'], ['Bibliothek · Umbenennen, Verschieben', 'library-edit.mjs'], ['Connector Studio', 'connector.mjs'], ['Phasen 2/3/5/6', 'phases.mjs'], ['Rechen-Worker', 'worker.mjs'], ['Erweiterungspunkte', 'erweiterung.mjs'], ['Quelltext', 'quelltext.mjs'], ['Achsen und Z-Tab', 'axes-z.mjs'], ['ESB · Bauteilerkennung', 'esb-detect.mjs'], ['ESB · Modell-Editor', 'model-editor.mjs'], ['ESB · CMC- und Übertragerschaltbild', 'schematics.mjs'], ['ESB · Editor CMC und Übertrager', 'multi-editor.mjs'], ['LAN-Übertrager · 6 Ports', 'lan-6port.mjs'], ['ESB · Kernglieder der CMC', 'core-sections.mjs'], ['Englische Oberfläche', 'i18n.mjs']])
];
const rows = [];
for (const [name, file] of suites) {
  const started = Date.now(), run = spawnSync(process.execPath, [path.join(here, file)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (run.stdout || '') + (run.stderr || ''), checks = (out.match(/^\s+ok\s/gm) || []).length + (out.match(/^PASS /gm) || []).length * 0, failed = out.split('\n').filter(line => /^\s*FAIL\s/.test(line));
  // the summary line of each group ends with “passed/total”; take the last such line, not the first fraction in the output
  const counts = [...out.matchAll(/^(?:PASS|FAIL) .*?(\d+)\/(\d+)\s*$/gm)].at(-1) || out.match(/(\d+)\/(\d+)\s*$/m) || out.match(/(\d+) PASS, (\d+) FAIL/);
  rows.push({ name, ok: run.status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1), summary: counts ? (/PASS, /.test(counts[0]) ? counts[0].trim() : counts[1] + '/' + counts[2]) : /^SKIP · /m.test(out) ? 'übersprungen' : checks + ' Prüfungen', failed });
  console.log((run.status === 0 ? 'PASS' : 'FAIL') + '  ' + name.padEnd(34) + rows.at(-1).summary.padEnd(16) + ' ' + rows.at(-1).seconds + ' s');
  for (const line of failed.slice(0, 12)) console.log('      ' + line.trim().slice(0, 220));
}
const bad = rows.filter(row => !row.ok).length;
console.log('\n' + (bad ? 'FAIL' : 'PASS') + ' · ' + (rows.length - bad) + ' von ' + rows.length + ' Testgruppen bestanden');
process.exit(bad ? 1 : 0);
