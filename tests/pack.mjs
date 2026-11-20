// SIMONLATION synthetic Touchstone test pack (21 files, sidecar port maps). The pack is NOT in the repository:
//   SPA_PACK=/path/SIMONLATION_Touchstone_Dummy_Testpaket_v1 node tests/pack.mjs
// Without the folder every check is skipped. The full mixed-mode comparison needs python3 with NumPy (tests/tools/pack_reference.py).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { load, read } from './load.mjs';

const PACK = process.env.SPA_PACK || '';
const { RF, Connector, TD } = load();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : '')); };
if (!PACK || !fs.existsSync(path.join(PACK, 'manifest.json'))) {
  console.log('SKIP · Testpaket · SPA_PACK nicht gesetzt oder ohne manifest.json');
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync(path.join(PACK, 'manifest.json'), 'utf8'));
const file = m => path.join(PACK, m.file), map = m => fs.readFileSync(path.join(PACK, m.mapping), 'utf8');
const byName = name => manifest.models.find(m => m.model === name);

console.log('Parser');
const data = new Map();
for (const m of manifest.models) data.set(m.model, read(RF, file(m)));
check(manifest.models.length + ' Dateien: Portzahl und Punktzahl wie im Manifest (2 … 48 Ports, auch 23)', manifest.models.every(m => data.get(m.model).n === m.ports && data.get(m.model).freq.length === m.samples));
check('Keine Parserwarnungen', manifest.models.every(m => !data.get(m.model).warnings.length));

console.log('Mixed-Mode gegen NumPy');
let ref = null;
try {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spa-pack-')), 'ref.json');
  execFileSync('python3', ['-I', new URL('./tools/pack_reference.py', import.meta.url).pathname, PACK, out], { stdio: 'pipe' });
  ref = JSON.parse(fs.readFileSync(out, 'utf8'));
} catch (error) { console.log('  SKIP  NumPy nicht verfügbar: ' + String(error.message).split('\n')[0]); }
if (ref) {
  let worst = 0, worstName = '';
  for (const [model, r] of Object.entries(ref)) {
    const ds = data.get(model), pairs = r.pairs.map(([p, q], k) => ({ p, q, id: k + 1 }));
    const config = { loads: Array.from({ length: ds.n }, () => ({ type: 'active' })), pairs, ref: null }, layout = RF.prepareNetwork(ds, config);
    for (let i = 0; i < ds.freq.length; i++) {
      const [, mm] = RF.processPoint(ds, config, layout, i);
      for (let a = 0; a < ds.n; a++) for (let b = 0; b < ds.n; b++) { const v = RF.get(mm, ds.n, a, b), e = Math.hypot(v[0] - r.mm_re[i][a][b], v[1] - r.mm_im[i][a][b]); if (e > worst) { worst = e; worstName = model; } }
    }
  }
  check('Alle 21 Dateien: vollständige Mixed-Mode-Matrix = NumPy (Paare aus der Port-Map)', worst < 1e-9, 'größte Abweichung ' + worst.toExponential(1) + ' (' + worstName + ')');
}

console.log('Automatische Zuordnung');
{
  const usb = Connector.detect(data.get('USB32_TypeC_full_48p'), 'usb-c-receptacle-thru'), best = usb.candidates[0];
  const truth = JSON.parse(map(byName('USB32_TypeC_full_48p'))).ports.map(p => p.pin + '@' + (p.side === 'LEFT' ? 1 : 2));
  check('USB32 C 48p: „Eindeutig“ und gleich der Port-Map', usb.status === 'certain' && best.mapping.ports.every((x, i) => x === truth[i]), usb.status);
  const usb2 = Connector.detect(data.get('USB2_TypeC_full_48p'), 'usb-c-receptacle-thru');
  check('USB2 C 48p (SuperSpeed offen): „Wahrscheinlich“, offene Kontakte werden genannt', usb2.status === 'likely' && /A2, A3/.test(usb2.candidates[0].conflict), usb2.candidates[0].conflict);
  const rj = Connector.detect(data.get('RJ45_unmagnetized_full_16p'), 'rj45-8p8c-thru');
  check('RJ45 ohne Übertrager 16p: „Eindeutig“', rj.status === 'certain');
}

console.log('Port-Maps und Kanalprüfung');
{
  let ok = 0, chans = 0, bad = [];
  for (const m of manifest.models) {
    const { profile: p, mapping } = Connector.fromSidecar(map(m), m.ports);
    if (!Connector.validateMapping(p, mapping).ok) { bad.push(m.model); continue; }
    try { Connector.register(p); } catch { /* already registered */ }
    ok++;
    for (const c of Connector.checkChannels(p, mapping, data.get(m.model))) {
      chans++;
      const open = m.model === 'USB2_TypeC_full_48p' && /^(TX|RX)/.test(c.channel);
      if (open ? c.polarity !== 'none' : c.polarity !== 'ok') bad.push(m.model + ':' + c.channel + ':' + c.polarity);
    }
  }
  check('Alle 21 Port-Maps importierbar und gültig', ok === 21, bad.join(' '));
  check(chans + ' Kanäle richtig gepolt; offene SuperSpeed-Lanes der USB2-C-Datei ohne Durchgang', !bad.length, bad.slice(0, 5).join(' '));
  const ta = Connector.checkChannels(...(r => [r.profile, r.mapping])(Connector.fromSidecar(map(byName('USB2_TypeA_to_TypeC_full_28p')), 28)), data.get('USB2_TypeA_to_TypeC_full_28p'));
  check('Typ A → C: USB2 wird aus der Messung mit beiden C-Paaren verknüpft (Fan-out)', ta.length === 2 && ta.every(c => c.fromData && c.polarity === 'ok'), ta.map(c => c.channel + ' ' + c.maxDb.toFixed(1) + ' dB').join(', '));
}

console.log('Dreileiter-Drossel und Zeitbereich');
{
  const ds = data.get('CMC_power_3phase_6p'), config = { loads: Array.from({ length: 6 }, () => ({ type: 'active' })), pairs: [], triples: [{ a: 0, b: 1, c: 2, id: 1 }, { a: 3, b: 4, c: 5, id: 2 }], ref: null };
  const layout = RF.prepareNetwork(ds, config), i = ds.freq.findIndex(f => f >= 2e5), [, mm] = RF.processPoint(ds, config, layout, i);
  const db = v => 20 * Math.log10(Math.hypot(...v));
  check('3-Phasen-CMC bei ' + (ds.freq[i] / 1e3).toFixed(0) + ' kHz: Nullsystem gesperrt, α/β durchgelassen', db(RF.get(mm, 6, 1, 0)) < -20 && db(RF.get(mm, 6, 3, 2)) > -1 && Math.abs(db(RF.get(mm, 6, 3, 2)) - db(RF.get(mm, 6, 5, 4))) < 0.01,
    'S00·21 ' + db(RF.get(mm, 6, 1, 0)).toFixed(1) + ' dB, Sαα·21 ' + db(RF.get(mm, 6, 3, 2)).toFixed(2) + ' dB');
  const ref2 = data.get('Reference_simple_matched_2p'), s21 = ref2.samples.map(s => RF.get(s, 2, 1, 0));
  const gd = TD.groupDelay(ref2.freq, s21), r = TD.responses(TD.resample(ref2.freq, s21, { points: 4096 }), { window: 'hann' }), e = TD.edge(r.step, r.dt, r.t0);
  check('Referenz 2p: Gruppenlaufzeit 0,4 ns überall, Sprung 0,8 bei 0,4 ns', Array.from(gd.tau).every(t => Math.abs(t - 0.4e-9) < 1e-15) && Math.abs(e.final - 0.8) < 2e-3 && Math.abs(e.t50 - 0.4e-9) < 2e-12,
    't50 ' + (e.t50 * 1e12).toFixed(1) + ' ps, geführte Schritte ' + gd.guided);
}
console.log((fail ? 'FAIL' : 'PASS') + ' · Testpaket · ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
