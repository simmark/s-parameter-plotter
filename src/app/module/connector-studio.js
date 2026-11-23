// module/connector-studio – Connector Studio: Profil, Zuordnung, Pin-Ansicht, Kanäle, Übersprechen und Kopplungsmatrix.
import { miniChart } from '../analyse/minidiagramm.js';
import { refreshNetwork } from '../analyse/netzwerk.js';
import { $, actionButton, esc, iconButton, insertHtml, toast } from '../basis/dom.js';
import { registerActions, registerFileState, registerForms, registerView } from '../basis/erweiterung.js';
import { PAIR_COLORS } from '../basis/farben.js';
import { hz } from '../basis/format.js';
import { computeCall, computeWorker } from '../basis/rechnen.js';
import { lang } from '../basis/sprache.js';
import { state } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';
import { plural } from '../dateien/import.js';
import { session, sessionItem } from '../dateien/sitzung.js';
import { saveBlob } from '../oberflaeche/export.js';
import { setTab } from '../oberflaeche/rahmen.js';

// ---------- Connector Studio: profile, mapping, pin view, channels and coupling matrix ----------
const CN_CATEGORY_CLASS = { certain: 'ok', likely: 'warn', several: 'warn', unresolved: 'bad', mismatch: 'bad' };
const CN_SOURCE = { names: 'Portname', convention: 'Konvention', data: 'Messdaten', manual: 'manuell', template: 'Vorlage', file: 'Port-Map-Datei', '': '–' };
const CN_ROLE = { ground: 'Masse', power: 'Versorgung', config: 'Konfiguration', sideband: 'Seitenband', usb2: 'USB 2.0', superspeed: 'SuperSpeed', signal: 'Signal', tap: 'Mittelanzapfung', shield: 'Schirm', led: 'LED' };
// The port table lists up to 64 × 65 nodes; the options of a row are created when it is first used (focus, pointer, key).
function cnFillOptions(el) {
  if (!el?.matches?.('select.cn-node[data-lazy]')) return;
  const p = cnProfile(), current = el.value;
  if (!p) return;
  el.innerHTML = '<option value="">–</option>' + Connector.nodesOf(p).map(id => '<option value="' + esc(id) + '"' + (id === current ? ' selected' : '') + '>' + esc(id.replace('@', ' · S')) + '</option>').join('');
  el.removeAttribute('data-lazy');
}
for (const type of ['focusin', 'pointerdown', 'keydown']) document.addEventListener(type, event => cnFillOptions(event.target), true);
// the remaining rows are filled in idle time, a few per slice, so scripts and assistive tools also find every option
let cnIdle = 0;
function cnFillIdle() {
  const run = ++cnIdle, idle = window.requestIdleCallback || (fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
  const step = deadline => {
    if (run !== cnIdle) return;
    const rest = document.querySelectorAll('#connector-panel select.cn-node[data-lazy]');
    for (const el of rest) { if (deadline.timeRemaining() < 2) break; cnFillOptions(el); }
    if (document.querySelector('#connector-panel select.cn-node[data-lazy]')) idle(step);
  };
  idle(step);
}

const cnBlank = () => ({ profile: '', configuration: '', mapping: null, detection: null, candidate: '', selected: '', channels: [], paths: [], path: '', mirrored: false, logical: false, zoom: 1, pan: [0, 0], freq: null, matrixModes: 'D' });
const cnProfile = () => Connector.profile(state.connector.profile);
const cnAll = () => [...Connector.PROFILES, ...Connector.customProfiles()];
const cnMatches = () => cnAll().filter(p => Connector.portCount(p) === state.dataset.n);
// Profile texts come in German and English from the profile itself; they bypass the page translation.
const cnT = (obj, key) => Connector.text(obj, key, lang());
const cnSide = (p, side) => (lang() === 'en' && p.measurement.en?.sideNames ? p.measurement.en.sideNames : p.measurement.sideNames)[side - 1];
const cnSpan = text => '<span data-no-i18n>' + esc(text) + '</span>';

// Opening the tab picks the only fitting profile, or the built-in LAN detection when the file carries one.
function cnEnsure() {
  const cn = state.connector;
  if (cn.profile && Connector.profile(cn.profile) && Connector.portCount(cnProfile()) === state.dataset.n) {
    if (!cn.mapping) cn.mapping = Connector.emptyMapping(cnProfile(), state.dataset.n);
    return;
  }
  const matches = cnMatches();
  cn.profile = matches.length === 1 ? matches[0].id : (state.dataset.profile && matches.find(p => p.measurement.kind === 'pins'))?.id || '';
  cn.mapping = cn.profile ? Connector.emptyMapping(cnProfile(), state.dataset.n) : null;
  cn.configuration = cn.profile ? cnProfile().configurations.at(-1).id : '';
  cn.detection = null; cn.candidate = '';
}
function cnSetProfile(id) {
  const cn = state.connector, p = Connector.profile(id);
  cn.profile = p && Connector.portCount(p) === state.dataset.n ? id : '';
  cn.mapping = cn.profile ? Connector.emptyMapping(p, state.dataset.n) : null;
  cn.configuration = cn.profile ? p.configurations.at(-1).id : '';
  cn.detection = null; cn.candidate = ''; cn.selected = ''; cn.channels = []; cn.paths = []; cn.path = '';
  persistSettings(); renderConnector();
}
function cnDetect() {
  const cn = state.connector, p = cnProfile();
  if (!p) return;
  const t = performance.now();
  cn.detection = Connector.detect(state.dataset, p);
  cn.detection.ms = Math.round(performance.now() - t);
  const best = cn.detection.candidates?.[0];
  if (best && best.category !== 'unresolved') { cn.mapping = structuredClone(best.mapping); cn.candidate = best.id; }
  renderConnector();
  toast(best ? Connector.CATEGORY[best.category] + ' · ' + best.name : Connector.CATEGORY[cn.detection.status] || 'Keine Zuordnung gefunden.');
  persistSettings();
}
function cnUseCandidate(id) {
  const c = state.connector.detection?.candidates.find(x => x.id === id);
  if (!c) return;
  state.connector.mapping = structuredClone(c.mapping); state.connector.candidate = id;
  persistSettings(); renderConnector();
}
function cnTransform(kind) {
  const cn = state.connector, p = cnProfile();
  if (!cn.mapping) return;
  if (kind === 'sides') cn.mapping = Connector.swapSides(cn.mapping);
  else { const sym = p.symmetries.find(s => s.id === kind); if (sym) cn.mapping = Connector.applySymmetry(cn.mapping, sym); }
  cn.mapping.source = cn.mapping.source.map(s => s ? 'manual' : s);
  cn.candidate = '';
  persistSettings(); renderConnector();
}
// Assign a port to a node; the port's previous node and the node's previous port are freed (no double assignment).
function cnAssign(node, port) {
  const m = state.connector.mapping;
  if (!m) return;
  m.ports.forEach((x, i) => { if (x === node) { m.ports[i] = null; m.source[i] = ''; } });
  if (Number.isInteger(port) && port >= 0) { m.ports[port] = node; m.source[port] = 'manual'; }
  state.connector.candidate = '';
  persistSettings(); renderConnector();
}
// Swap the ports of + and − of a pair (on both sides), or exchange the ports of two pairs.
function cnSwapPair(pairId, otherId = '', only = null) {
  const p = cnProfile(), m = state.connector.mapping, pair = p.pairs.find(x => x.id === pairId);
  if (!pair || !m) return;
  const sides = p.measurement.kind === 'thru' ? (only ? [only] : p.measurement.sides) : [null];
  const swapNodes = (a, b) => m.ports.forEach((x, i) => { if (x === a) { m.ports[i] = b; m.source[i] = 'manual'; } else if (x === b) { m.ports[i] = a; m.source[i] = 'manual'; } });
  if (!otherId) for (const s of sides) swapNodes(Connector.nodeId(pair.plus, s), Connector.nodeId(pair.minus, s));
  else {
    const other = p.pairs.find(x => x.id === otherId);
    if (!other) return;
    for (const s of sides) { swapNodes(Connector.nodeId(pair.plus, s), Connector.nodeId(other.plus, s)); swapNodes(Connector.nodeId(pair.minus, s), Connector.nodeId(other.minus, s)); }
  }
  state.connector.candidate = '';
  persistSettings(); renderConnector();
}
function cnApply(form) {
  const cn = state.connector, p = cnProfile(), data = new FormData(form);
  const pairs = p.pairs.map(x => x.id).filter(id => data.get('pair-' + id));
  if (!pairs.length) { toast('Wähle mindestens ein Paar.'); return; }
  const v = Connector.validateMapping(p, cn.mapping, state.dataset.n);
  if (!v.ok) { toast('Die Zuordnung hat Fehler: ' + v.issues.find(i => i.level === 'error').text); return; }
  const { config, channels } = Connector.toConfig(p, cn.mapping, state.dataset.n, { pairs, others: String(data.get('others') || 'match'), taps: String(data.get('taps') || 'open') });
  if (!config.pairs.length) { toast('Für die gewählten Paare sind nicht beide Ports zugeordnet.'); return; }
  state.config = config;
  cn.channels = channels;
  cn.paths = Connector.directedPaths(channels, cnChecks(p, cn.mapping));
  cn.applied = { pairs, others: String(data.get('others') || 'match'), taps: String(data.get('taps') || 'open') };
  state.basis = 'mm'; state.sKeys.mm = null; state.pairIn = 1; state.pairOut = Math.min(2, config.pairs.length);
  state.pairDraft = null;
  toast(plural(config.pairs.length, 'Paar', 'Paare') + ' aus der Zuordnung übernommen · übrige Ports ' + ({ match: 'angepasst abgeschlossen', open: 'offen', active: 'aktiv' }[cn.applied.others]) + '.');
  persistSettings();
  refreshNetwork();
}
// Curves of one channel or one matrix cell in the S-parameter view (rows: response mode, columns: excitation mode).
function cnOpenPath(id) {
  const cn = state.connector, path = cn.paths.find(p => p.id === id);
  if (!path || !cnPathCurrent(path)) return;
  cn.path = id;
  const index = cn.freq ?? state.markers[0] ?? Math.floor(state.dataset.freq.length / 2);
  state.markers[0] = index;
  state.activeMarker = 0;
  const { a, b } = path;
  const source = sessionItem(session.current);
  cn.plotSource = { dataset: state.dataset.name, fileRevision: source?.entryId ?? source?.id ?? null,
    profile: cn.profile, revision: cnProfile().revision,
    mappingRevision: JSON.stringify([cn.mapping.ports, cn.mapping.links ?? null]),
    path: id, fromPorts: [a.plus + 1, a.minus + 1], toPorts: [b.plus + 1, b.minus + 1], freq: state.dataset.freq[index] };
  cnOpenCurves(['D' + b.id + ':D' + a.id]);
  persistSettings();
}

function cnPathCurrent({ a, b }) {
  const cn = state.connector;
  if (!state.network || state.network.layout !== state.layout || !cn.mapping) return false;
  const aKey = Connector.pairKey(a.pair,a.side), bKey = Connector.pairKey(b.pair,b.side);
  if (cn.mapping.links && !cn.mapping.links.some(l =>
    (l.fromKey === aKey && l.toKey === bKey) || (l.fromKey === bKey && l.toKey === aKey))) return false;
  return [a,b].every(c => {
    const pair = cnProfile().pairs.find(p => p.id === c.pair);
    return pair && cn.mapping.ports[c.plus] === Connector.nodeId(pair.plus,c.side) &&
      cn.mapping.ports[c.minus] === Connector.nodeId(pair.minus,c.side) &&
      state.config.pairs.some(p => p.id === c.id && p.p === c.plus && p.q === c.minus);
  });
}

function cnOpenCurves(keys) {
  state.basis = 'mm'; state.sKeys.mm = keys; state.sFormat = 'db';
  setTab('s');
}
async function cnSaveTemplate() {
  const cn = state.connector, p = cnProfile();
  if (!p || !cn.mapping?.ports.some(Boolean)) { toast('Keine Zuordnung zum Speichern.'); return; }
  const name = (state.dataset.name || 'Zuordnung').replace(/\.[^.]+$/, '') + ' · ' + p.family;
  const mapping = { ...cn.mapping, links: cnChecks(p, cn.mapping) };
  const map = Connector.exportMap(p, mapping, { name, selectedPath: cn.path, created: new Date().toISOString() });
  let list = [];
  try { list = (await Store.getMeta('connector-maps')) || []; } catch { list = []; }
  list = [map, ...list.filter(x => !(x.name === name && x.profile.id === p.id))].slice(0, 50);
  try { await Store.setMeta('connector-maps', list); toast('Vorlage „' + name + '“ gespeichert.'); }
  catch (error) { toast('Vorlage nicht gespeichert: ' + error.message); }
  cn.templates = list; renderConnector();
}
async function cnLoadTemplates() {
  try { state.connector.templates = (await Store.getMeta('connector-maps')) || []; } catch { state.connector.templates = []; }
  if (state.tab === 'connector') renderConnector();
}
function cnUseTemplate(index) {
  const cn = state.connector, t = cn.templates?.[Number(index)];
  if (!t) return;
  try {
    const imported = Connector.importMap(t, state.dataset.n);
    cnAcceptMap(imported);
    const { name } = imported;
    toast('Vorlage „' + name + '“ angewendet. Prüfe die Zuordnung, bevor du sie übernimmst.');
    persistSettings(); renderConnector();
  } catch (error) { toast(error.message); }
}
function cnExport() {
  const p = cnProfile();
  if (!p || !state.connector.mapping) return;
  const cn = state.connector;
  const mapping = { ...cn.mapping, links: cnChecks(p, cn.mapping) };
  const map = Connector.exportMap(p, mapping, { name: state.dataset.name, selectedPath: cn.path, created: new Date().toISOString() });
  saveBlob(new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }), (state.dataset.name || 'zuordnung').replace(/\.[^.]+$/, '') + '.port-map.json');
}
function cnAcceptMap({ profile, mapping, selectedPath }) {
  const cn = state.connector;
  if (profile.status === 'file') Connector.register(profile);
  if (cn.profile !== profile.id) {
    cn.path = '';
    cn.configuration = profile.configurations.at(-1).id;
    cn.channels = []; cn.paths = []; cn.selected = '';
  }
  cn.profile = profile.id; cn.mapping = mapping; cn.candidate = ''; cn.detection = null;
  cn.path = selectedPath || cn.path;
}

async function cnImport(file) {
  const dataset = state.dataset;
  try {
    if (file.size > 1 << 20) throw new Error('Die Datei ist zu groß für eine Port-Zuordnung.');
    const json = JSON.parse(await file.text());
    if (dataset !== state.dataset) return;
    const sidecar = /portmap\.v1$/.test(String(json?.schema || ''));
    const imported = sidecar ? Connector.fromSidecar(json, dataset.n) : Connector.importMap(json, dataset.n);
    cnAcceptMap(imported);
    toast('Zuordnung „' + (imported.name || file.name) + '“ geladen.');
    persistSettings(); renderConnector();
  } catch (error) { toast(file.name + ' · ' + error.message); }
}

// Technical drawing of one side (thru) or of the part (pins). Generated from the profile, not a picture.
function cnDrawing(p, side, portOf, verdict, face = null) {
  const cn = state.connector;
  const positions = face ? p.contacts.filter(c => !face.side || c.side === face.side).filter(c =>
    face.kind === 'hdmi' ? /^[0-9]+$/.test(c.pin) && Number(c.pin) <= 19 :
      face.kind === 'magjack' ? /^J[1-8]$/.test(c.pin) : /^[1-8]$/.test(c.pin ?? c.id)).map(c => {
    const pin = Number((c.pin ?? c.id).replace(/^J/, ''));
    return { ...c, pin, x: face.kind === 'hdmi' ? (19 - pin) / 2 : 8 - pin,
      y: face.kind === 'hdmi' ? (pin % 2 ? 0 : 1.5) : 0 };
  }) : p.contacts;
  const xs = positions.map(c => c.x), ys = positions.map(c => c.y);
  const W = 46, H = 40, pad = 24, sx = c => pad + ((face && cn.mirrored !== (face.gender === 'plug') ? Math.max(...xs) - c.x : c.x - Math.min(...xs))) * W, sy = c => pad + 18 + (c.y - Math.min(...ys)) * H;
  const width = pad * 2 + (Math.max(...xs) - Math.min(...xs)) * W + 34, height = pad * 2 + 36 + (Math.max(...ys) - Math.min(...ys)) * H + 26;
  const group = pair => pair.channelKey ?? pair.id;
  const colors = [...new Set(p.pairs.map(group))];
  const colorIndex = pair => colors.indexOf(group(pair));
  const pairOf = new Map();
  p.pairs.forEach(pair => { pairOf.set(pair.plus, pair); pairOf.set(pair.minus, pair); });
  const shapes = positions.map(c => {
    const node = Connector.nodeId(c.id, side), port = portOf.get(node), sel = state.connector.selected === node, pair = pairOf.get(c.id), k = pair ? colorIndex(pair) : 0;
    const color = pair ? 'var(--pair-' + (k % 8 + 1) + ', ' + PAIR_COLORS[k % PAIR_COLORS.length] + ')' : c.role === 'ground' ? 'var(--muted)' : c.role === 'power' ? '#b25f2c' : 'var(--ink-2, #555)';
    const state_ = port === undefined ? 'free' : verdict.get(node) || 'ok';
    const mark = { ok: '✓', unconfirmed: '?', conflict: '!', free: '' }[state_];
    return '<g class="cn-pin is-' + state_ + (sel ? ' is-selected' : '') + '" data-node="' + esc(node) + '" role="button" tabindex="0" aria-pressed="' + sel + '" aria-label="' + esc(c.id + ' ' + c.label + (side ? ', ' + cnSide(p, side) : '') + (port !== undefined ? ', Port ' + (port + 1) : lang() === 'en' ? ', not assigned' : ', nicht zugeordnet')) + '">' +
      '<rect x="' + (sx(c) - 17) + '" y="' + (sy(c) - 15) + '" width="34" height="30" rx="4" style="--pin:' + color + '"/>' +
      '<text class="cn-pin-id" x="' + sx(c) + '" y="' + (sy(c) - 2) + '">' + esc(c.pin ?? c.id) + '</text>' +
      '<text class="cn-pin-port" x="' + sx(c) + '" y="' + (sy(c) + 10) + '">' + (port !== undefined ? 'P' + (port + 1) : '–') + '</text>' +
      (mark ? '<text class="cn-pin-mark" x="' + (sx(c) + 14) + '" y="' + (sy(c) - 9) + '">' + mark + '</text>' : '') +
      (face && c.pin === 1 ? '<circle class="cn-pin-one" cx="' + (sx(c) - 15) + '" cy="' + (sy(c) - 19) + '" r="3"/>' : '') +
      '<text class="cn-pin-label" x="' + sx(c) + '" y="' + (c.y > (Math.min(...ys) + Math.max(...ys)) / 2 || p.measurement.kind === 'pins' ? sy(c) + 27 : sy(c) - 21) + '">' + esc(c.label.replace(' · ', ' ').length > 14 ? c.label.replace(' · ', ' ').slice(0, 13) + '…' : c.label.replace(' · ', ' ')) + '<title>' + esc(c.label) + '</title></text></g>';
  }).join('');
  // differential pairs: a bracket between + and −
  const brackets = p.pairs.map(pair => {
    const k = colorIndex(pair);
    const a = positions.find(c => c.id === pair.plus), b = positions.find(c => c.id === pair.minus);
    if (!a || !b) return '';
    if (Math.abs(a.y - b.y) > 0.1 && p.measurement.kind !== 'pins') return '';
    const nested = face && face.kind !== 'hdmi' && Math.abs(a.x - b.x) > 1.5;
    const y = !face && p.measurement.kind === 'pins' ? null :
      (a.y > (Math.min(...ys) + Math.max(...ys)) / 2 ? sy(a) + 36 : sy(a) - (nested ? 39 : 31));
    if (y === null) return '<line class="cn-pair-line" x1="' + (sx(a) - 22) + '" y1="' + sy(a) + '" x2="' + (sx(b) - 22) + '" y2="' + sy(b) + '" style="--pin:' + PAIR_COLORS[k % PAIR_COLORS.length] + '"/>';
    return '<path class="cn-pair-line" data-pair="' + esc(pair.id) + '" d="M' + sx(a) + ' ' + y + 'H' + sx(b) + '" style="--pin:' + PAIR_COLORS[k % PAIR_COLORS.length] + '"/>';
  }).join('');
  const symbol = !face && p.measurement.kind === 'pins' ? (() => {
    // transformer symbol between primary (x = 0) and secondary (x = 4) pins of each channel
    return p.pairs.filter(x => x.side === 'P').map(pp => {
      const a = p.contacts.find(c => c.id === pp.plus), b = p.contacts.find(c => c.id === pp.minus), x1 = sx(a) + 30, x2 = sx(a) + 4 * W - 30, top = sy(a), bot = sy(b);
      const coil = x => { let d = 'M' + x + ' ' + top; const n = 4, h = (bot - top) / n; for (let i = 0; i < n; i++) d += ' a' + (h / 2) + ' ' + (h / 2) + ' 0 0 ' + (x < x2 ? 1 : 0) + ' 0 ' + h; return '<path class="cn-coil" d="' + d + '"/>'; };
      return coil(x1) + coil(x2) + '<line class="cn-core" x1="' + ((x1 + x2) / 2 - 3) + '" y1="' + top + '" x2="' + ((x1 + x2) / 2 - 3) + '" y2="' + bot + '"/><line class="cn-core" x1="' + ((x1 + x2) / 2 + 3) + '" y1="' + top + '" x2="' + ((x1 + x2) / 2 + 3) + '" y2="' + bot + '"/>' +
        '<circle class="cn-dot" cx="' + (x1 + 8) + '" cy="' + (top + 4) + '" r="2.6"/><circle class="cn-dot" cx="' + (x2 - 8) + '" cy="' + (top + 4) + '" r="2.6"/>';
    }).join('');
  })() : '';
  const title = face
    ? [face.side ?? cnSide(p, side), face.kind === 'hdmi' ? 'HDMI Type A' : 'RJ45',
      face.gender === 'plug' ? (lang() === 'en' ? 'Plug' : 'Stecker') : (lang() === 'en' ? 'Jack' : 'Buchse'),
      lang() === 'en' ? 'Mating side' : 'Steckseite', cn.mirrored ? (lang() === 'en' ? 'mirrored' : 'gespiegelt') : ''].filter(Boolean).join(' · ')
    : side ? cnSide(p, side) : (p.status === 'file' ? 'Logische Anschlussliste · ' : '') + cnT(p, 'view');
  const left = 3, right = width - 27;
  const body = face ? face.kind === 'hdmi'
    ? '<path class="cn-body" d="M' + left + ' 15 H' + right + ' V' + (height-32) + ' l-11 12 H14 l-11 -12 Z"/>'
    : '<path class="cn-body" d="M' + left + ' 16 H' + right + ' V72 H' + (width/2+26) + ' v16 h-52 v-16 H3 Z"/>'
    : p.measurement.kind === 'thru' ? '<rect class="cn-body" x="2" y="14" width="' + (width-7) + '" height="' + (height-18) + '" rx="12"/>' : '';
  return '<figure class="cn-figure"' + (face ? ' data-face="' + esc(face.kind) + '"' : '') + '><figcaption>' + cnSpan(title) + '</figcaption><svg class="cn-svg" viewBox="0 0 ' + width + ' ' + height + '" style="max-width:' + Math.round(width * 1.35) + 'px;min-width:' + Math.min(560, Math.round(width)) + 'px" data-side="' + (side || 0) + '" role="group" data-no-i18n aria-label="' + esc(cnT(p, 'name') + ' · ' + title) + '">' +
    '<g class="cn-zoom" transform="translate(' + cn.pan[0] + ' ' + cn.pan[1] + ') scale(' + cn.zoom + ')">' + body +

    symbol + brackets + shapes + '</g></svg></figure>';
}

function cnVerdicts(p, mapping) {
  // ✓ the two sides of a contact are a measured conductor · ? not confirmed by the data · ! node or port assigned twice
  const out = new Map(), v = Connector.validateMapping(p, mapping), seen = new Map();
  mapping.ports.forEach((node, port) => { if (node) seen.set(node, (seen.get(node) || 0) + 1); });
  const det = state.connector.detection, thru = det?.thru ?? Connector.thruPaths(state.dataset);
  const partner = new Map(); thru.paths.forEach(x => { partner.set(x.a, x.b); partner.set(x.b, x.a); });
  // For file profiles use observed transmission. An anchored polarity conflict takes precedence.
  const fileState = new Map();
  if (p.status === 'file') for (const c of cnChecks(p, mapping)) {
    const verdictOf = c.polarity === 'inverted' ? 'conflict' : c.polarity === 'none' ? 'unconfirmed' : 'ok';
    for (const id of [c.from, c.to]) { const pair = p.pairs.find(x => x.id === id); if (!pair) continue; for (const k of [pair.plus, pair.minus]) if (fileState.get(k) !== 'conflict') fileState.set(k, verdictOf); }
  }
  mapping.ports.forEach((node, port) => {
    if (!node) return;
    if (seen.get(node) > 1) { out.set(node, 'conflict'); return; }
    if (p.measurement.kind === 'thru') {
      const { contact, side } = Connector.splitNode(node), other = v.portOf(Connector.nodeId(contact, 3 - side));
      out.set(node, other !== undefined && partner.get(port) === other ? 'ok' : 'unconfirmed');
    } else if (p.status === 'file') out.set(node, fileState.get(Connector.splitNode(node).contact) || 'unconfirmed');
    else out.set(node, mapping.source[port] === 'manual' ? 'unconfirmed' : 'ok');
  });
  return { verdict: out, validation: v };
}

// Channel check, cached per dataset, profile and mapping (it is used by the pin verdicts, the check card and the apply step).
const cnCheckCache = { dataset: null, key: '', rows: null };
function cnChecks(p, mapping) {
  const key = JSON.stringify([p.id, p.revision, mapping.ports, mapping.links]);
  if (cnCheckCache.dataset !== state.dataset || cnCheckCache.key !== key) Object.assign(cnCheckCache, { dataset: state.dataset, key, rows: Connector.checkChannels(p, mapping, state.dataset) });
  return cnCheckCache.rows;
}
// Transmission and polarity per channel from the S-matrix of the current mapping (no limits, no pass/fail).
function cnCheck(p) {
  const rows = cnChecks(p, state.connector.mapping);
  if (!rows.length) return '';
  const POL = { ok: ['ok', '✓ richtig gepolt'], inverted: ['bad', '! + und − an einem Ende vertauscht'], open: ['warn', lang() === 'en' ? '? Polarity undetermined' : '? Polarität unbestimmt'], none: ['bad', 'kein Durchgang'] };
  return '<section class="config-card"><div class="config-head"><h2>Kanalprüfung</h2><p>Frequenz und Phase werden angezeigt. Ein Polaritätsurteil erfordert eine dokumentierte Basisbandreferenz und einen ausreichenden Durchgang.</p></div><div class="config-content"><div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Enden</th><th scope="col">max. |SDD21|</th><th scope="col">Phase</th><th scope="col">bei</th><th scope="col">Polarität</th></tr></thead><tbody>' +
    rows.map(r => '<tr><th scope="row">' + cnSpan(r.channel) + (r.fromData ? ' <small>(aus der Messung verknüpft)</small>' : '') + '</th><td class="mono">' + cnSpan(r.from + ' → ' + r.to) + '</td><td class="mono">' + (r.maxDb > -200 ? r.maxDb.toFixed(2) + ' dB' : '–') + '</td><td class="mono">' + (Number.isFinite(r.phase) ? Math.round(r.phase) + '°' : '–') + '</td><td class="mono">' + (Number.isFinite(r.freq) ? esc(hz(r.freq)) : '–') + '</td><td><span class="cn-badge is-' + POL[r.polarity][0] + '">' + POL[r.polarity][1] + '</span>' +
      (r.reference ? '<small> · ' + esc(r.reference) + '</small>' : r.polarity === 'open' ? '<small> · ' +
        (lang() === 'en' ? 'No suitable baseband reference' : 'Keine geeignete Basisbandreferenz') + '</small>' : '') + '</td></tr>').join('') +
    '</tbody></table></div></div></section>';
}

function cnMatrix() {
  const cn = state.connector, net = state.network, layout = state.layout;
  if (!net || !cn.channels.length || cn.paths.some(path => !cnPathCurrent(path))) return '';
  const fs = state.dataset.freq, fi = Number.isInteger(cn.freq) && cn.freq < fs.length ? cn.freq : (state.markers[0] ?? Math.floor(fs.length / 2));
  const s = net.mm[fi];
  if (!s) return '';
  const modes = layout.mmModes.filter(m => m.type === 'D' || (cn.matrixModes === 'DC' && m.type === 'C'));
  const n = layout.mmModes.length, idx = mode => layout.mmModes.indexOf(mode);
  const chOf = id => cn.channels.find(c => c.id === id);
  const label = mode => { const c = chOf(mode.id); return mode.type + mode.id + (c ? ' · ' + c.pair + (c.side ? ' S' + c.side : '') : ''); };
  const endOf = c => c.end ?? c.side;
  const KIND_EN = { Konversion: 'conversion', Kopplung: 'coupling' }, kindText = k => lang() === 'en' ? KIND_EN[k] || k : k;
  const kind = (r, c) => {
    const a = chOf(r.id), b = chOf(c.id);
    if (!a || !b) return '';
    // Labels from the mapping: the same channel end to end is insertion loss; between channels, the same end is NEXT and the other end FEXT.
    if (r === c) return 'RL';
    if (r.id === c.id) return 'Konversion';
    if (cn.paths.some(p => p.a.id === b.id && p.b.id === a.id)) return r.type === c.type ? 'IL' : 'Konversion';
    return endOf(a) === endOf(b) ? 'NEXT' : endOf(a) && endOf(b) ? 'FEXT' : 'Kopplung';
  };
  const db = (r, c) => { const k = 2 * (idx(r) * n + idx(c)); return 20 * Math.log10(Math.max(Math.hypot(s[k], s[k + 1]), 1e-12)); };
  const shade = v => { const t = Math.max(0, Math.min(1, (v + 80) / 80)); return 'hsl(' + Math.round(210 - 190 * t) + ' 70% ' + Math.round(94 - 44 * t) + '%)'; };
  const head = '<tr><th scope="col">Antwort ↓ · Anregung →</th>' + modes.map(m => '<th scope="col" class="mono">' + esc(label(m)) + '</th>').join('') + '</tr>';
  const rows = modes.map(r => '<tr><th scope="row" class="mono">' + esc(label(r)) + '</th>' + modes.map(c => {
    const v = db(r, c), k = kind(r, c);
    return '<td><button type="button" class="cn-cell" data-action="cn-cell" data-value="' + esc(r.key + ':' + c.key) + '" style="background:' + shade(v) + '" title="' + esc('S ' + label(r) + ' ← ' + label(c) + (k ? ' · ' + kindText(k) : '') + ' · ' + v.toFixed(1) + ' dB') + '" data-no-i18n>' + v.toFixed(0) + (k ? '<small>' + esc(kindText(k)) + '</small>' : '') + '</button></td>';
  }).join('') + '</tr>').join('');
  return '<section class="config-card cn-matrix"><div class="config-head"><h2>Matrix · Übertragung und Kopplung</h2><p>|S| in dB bei ' + esc(hz(fs[fi])) +
    '. NEXT: Anregung und Antwort auf derselben Seite, FEXT: auf verschiedenen Seiten, IL: dasselbe Paar durch den Connector. Die Bezeichnung folgt aus der Zuordnung, nicht aus der Portnummer. Ein Klick öffnet die Kurve.</p></div><div class="config-content">' +
    '<div class="preset-row"><label class="control"><span>Frequenz</span><input type="range" id="cn-freq" min="0" max="' + (fs.length - 1) + '" value="' + fi + '" aria-label="Frequenz der Matrix"></label>' +
    '<label class="control narrow"><span>Moden</span><select id="cn-modes"><option value="D"' + (cn.matrixModes === 'D' ? ' selected' : '') + '>Nur Differential</option><option value="DC"' + (cn.matrixModes === 'DC' ? ' selected' : '') + '>Differential und Gleichtakt</option></select></label></div>' +
    '<div class="table-scroll"><table class="cn-heat">' + head + rows + '</table></div></div></section>';
}

// Phase 2: crosstalk power sums, delay and skew per channel of the applied mapping.
function cnCrosstalk() {
  const cn = state.connector, net = state.network, layout = state.layout;
  if (!net || !cn.channels.length || cn.paths.some(path => !cnPathCurrent(path))) return '';
  const key = state.dataset.name + '|' + layout.mmModes.length + '|' + JSON.stringify(cn.paths);
  if (cn.xtKey !== key || cn.xtNet !== net) {
    const sig = list => JSON.stringify((list || []).map(c => [c.id, c.channel, c.end, c.plus, c.minus]));
    if (net.xt && sig(net.xtChannels) === sig(cn.channels) && JSON.stringify(net.xtPaths) === JSON.stringify(cn.paths)) { cn.xt = net.xt; cn.xtKey = key; cn.xtNet = net; }
    else if (computeWorker() && cn.xtFailed !== key + '|' + state.job && cn.xtPending !== key + '|' + state.job) {
      // not part of the network job (channels applied later): computed in the worker, the card follows when it is done
      const job = state.job; cn.xtPending = key + '|' + job;
      computeCall({ type: 'crosstalk', args: { freq: state.dataset.freq, mm: net.mm, se: net.se, modes: layout.mmModes, active: layout.active, channels: cn.channels, paths: cn.paths } })
        .then(result => { if (job !== state.job || state.network !== net) return; cn.xt = result; cn.xtKey = key; cn.xtNet = net; cn.xtPending = ''; if (state.tab === 'connector') renderConnector(); })
        .catch(() => {
          if (job !== state.job || state.network !== net) return;
          cn.xtPending = ''; cn.xtFailed = key + '|' + job;
          if (state.tab === 'connector') renderConnector();
        });
    }
    if (cn.xtKey !== key || cn.xtNet !== net) {
      if (cn.xtPending === key + '|' + state.job) return '<section class="config-card"><div class="config-head"><h2>Übersprechen und Laufzeit</h2><p class="busy-note">Wird im Hintergrund berechnet …</p></div></section>';
      cn.xt = Connector.crosstalk({ freq: state.dataset.freq, mm: net.mm, se: net.se, modes: layout.mmModes, active: layout.active, channels: cn.channels, paths: cn.paths }); cn.xtKey = key; cn.xtNet = net; cn.xtPending = '';
    }
  }
  const res = cn.xt, fs = state.dataset.freq;
  if (!res.length) return '';
  const ps = v => Number.isFinite(v) ? (v * 1e12).toFixed(2) + ' ps' : '–';
  const maxOf = a => { if (!a) return null; let i = -1; a.forEach((v, k) => { if (Number.isFinite(v) && (i < 0 || v > a[i])) i = k; }); return i < 0 ? null : { v: a[i], f: fs[i] }; };
  const cellMax = a => { const m = maxOf(a); return '<td class="mono">' + (m ? m.v.toFixed(1) + ' dB <small>@ ' + esc(hz(m.f)) + '</small>' : (lang() === 'en' ? 'undefined' : 'nicht definiert')) + '</td>'; };
  const rows = res.filter(r => !r.reverse).map(r => '<tr><th scope="row">' + cnSpan(r.channel) + '</th><td class="mono">' + ps(r.delay) + '</td><td class="mono">' + ps(r.laneSkew) + '</td><td class="mono">' + ps(r.skew) + '</td>' +
    cellMax(r.psnext1) + cellMax(r.psnext2) + cellMax(r.psfext) + '<td><small>' + (r.worstNext ? cnSpan(r.worstNext.aggressor + ' · ' + r.worstNext.db.toFixed(1) + ' dB') : '–') + '</small></td></tr>').join('');
  const sel = res.find(r => r.id === cn.xtChannel) || res.find(r => r.channel === cn.xtChannel) || res[0];
  const x = Array.from(fs), series = [
    sel.il && { name: 'SDD21 (IL)', color: '#2b2a27', x, y: sel.il },
    sel.psnext1 && { name: lang() === 'en' ? 'PSNEXT end 1' : 'PSNEXT Ende 1', color: '#c62f4b', x, y: sel.psnext1 },
    sel.psnext2 && { name: lang() === 'en' ? 'PSNEXT end 2' : 'PSNEXT Ende 2', color: '#e07b0f', x, y: sel.psnext2, dash: true },
    sel.psfext && { name: 'PSFEXT', color: '#1f6fb2', x, y: sel.psfext },
    sel.scd && { name: lang() === 'en' ? 'SCD21 (conversion)' : 'SCD21 (Konversion)', color: '#7a4fc2', x, y: sel.scd, dash: true }
  ].filter(Boolean);
  const guided = res.some(r => r.guided > 0);
  return '<section class="config-card"><div class="config-head"><h2>Übersprechen und Laufzeit</h2><p>Leistungssummen über zulässige Störer. Gemeinsame Abzweige werden dabei ausgespart. PSNEXT am selben Ende, PSFEXT von der Quell- zur Zielseite. Laufzeit: Gruppenlaufzeit von SDD21 (Median, wo |SDD21| > −6 dB); Lane: Abweichung vom Mittel aller Kanäle; Skew: τ(+) − τ(−) innerhalb des Paars aus den Single-Ended-Pfaden. Keine Grenzwerte.</p></div><div class="config-content">' +
    (guided ? '<p class="inline-notice">Die Abtastung ist für die Phase zu grob: Mindestens ein Phasenschritt war größer als 90°. Die Phase wurde über die Laufzeit-Kontinuität entfaltet (Annahme einer glatten Laufzeit). Für verlässliche Laufzeiten dichter messen.</p>' : '') +
    '<div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Laufzeit</th><th scope="col">Lane</th><th scope="col">Skew im Paar</th><th scope="col">PSNEXT Ende 1 max.</th><th scope="col">PSNEXT Ende 2 max.</th><th scope="col">PSFEXT max.</th><th scope="col">stärkster Störer</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="preset-row"><label class="control"><span>Kanal im Diagramm</span><select id="cn-xt-channel">' + res.map(r => '<option value="' + esc(r.channel) + '"' + (r === sel ? ' selected' : '') + ' data-no-i18n>' + esc(r.channel) + '</option>').join('') + '</select></label></div>' +
    miniChart(series, { xLog: true, xFmt: v => hz(v), yFmt: v => v.toFixed(0), yLabel: 'dB', yRange: (() => { const all = series.flatMap(s => s.y).filter(Number.isFinite), hi = Math.max(...all), lo = Math.min(...all); return [Math.max(lo, hi - 140), hi + 5]; })(), xLabel: lang() === 'en' ? 'Frequency' : 'Frequenz', label: 'Crosstalk ' + sel.channel }) + '</div></section>';
}

function cnChannels() {
  const cn = state.connector, net = state.network, layout = state.layout;
  if (!net || !cn.channels.length || cn.paths.some(path => !cnPathCurrent(path))) return '';
  const fs = state.dataset.freq, fi = state.markers[0] ?? Math.floor(fs.length / 2), s = net.mm[fi], n = layout.mmModes.length;
  const mode = key => layout.mmModes.findIndex(m => m.key === key);
  const val = (r, c) => { const i = mode(r), j = mode(c); if (!s || i < 0 || j < 0) return NaN; const k = 2 * (i * n + j); return 20 * Math.log10(Math.max(Math.hypot(s[k], s[k + 1]), 1e-12)); };
  const rows = cn.paths.filter(path => !path.reverse && cnPathCurrent(path)).map(path => {
    const { a,b } = path;
    const cell = v => '<td class="mono">' + (Number.isFinite(v) ? v.toFixed(2) + ' dB' : '–') + '</td>';
    const pa = cnProfile().pairs.find(x => x.id === a.pair);
    const title = typeof pa?.channel === 'number' ? (lang() === 'en' ? 'Channel ' : 'Kanal ') + pa.channel + ' · ' + a.pair + ' → ' + b.pair : path.channel;
    const keys = ['D' + b.id + ':D' + a.id, 'D' + a.id + ':D' + a.id, 'D' + b.id + ':D' + b.id, 'C' + b.id + ':D' + a.id];
    return '<tr><th scope="row">' + cnSpan(title) + '</th><td class="mono">D' + a.id + ' → D' + b.id + '</td>' +
      cell(val('D' + b.id, 'D' + a.id)) + cell(val('D' + a.id, 'D' + a.id)) + cell(val('C' + b.id, 'D' + a.id)) +
      '<td>' + actionButton('Kurven', 'cn-curves', keys.join(','), 'quiet-button') + '</td></tr>';
  }).join('');
  if (!rows) return '';
  return '<section class="config-card"><div class="config-head"><h2>Kanäle</h2><p>Werte bei ' + esc(hz(fs[fi])) + ' (Marker 1). SDD21: Einfügedämpfung durch den Connector, SDD11: Reflexion, SCD21: Umwandlung Differential → Gleichtakt. Keine Grenzwerte: Für eine Konformitätsaussage fehlen Normversion und Messbedingungen.</p></div>' +
    '<div class="config-content"><div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Moden</th><th scope="col">SDD21</th><th scope="col">SDD11</th><th scope="col">SCD21</th><th scope="col"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div></section>';
}

function renderConnector() {
  const box = $('connector-panel');
  if (!box || state.tab !== 'connector') return;
  cnEnsure();
  const cn = state.connector, n = state.dataset.n, p = cnProfile();
  if (!cn.templates) cnLoadTemplates();
  const options = cnAll().map(x => '<option value="' + esc(x.id) + '"' + (x.id === cn.profile ? ' selected' : '') + (Connector.portCount(x) !== n ? ' disabled' : '') + ' data-no-i18n>' +
    esc(cnT(x, 'name') + (Connector.portCount(x) !== n ? (lang() === 'en' ? ' – expects ' : ' – erwartet ') + Connector.portCount(x) + ' Ports' : '')) + '</option>').join('');
  let html = '<section class="config-card"><div class="config-head"><h2>Connector-Profil</h2><p>Wähle, was gemessen wurde. Ein Profil ist eine Interpretation der ' + n + ' Messports; die Software prüft, ob die Messdaten dazu passen. Die Originaldaten bleiben unverändert.</p></div>' +
    '<div class="config-content"><div class="preset-row"><label class="control"><span>Profil</span><select id="cn-profile"><option value="">– kein Profil –</option>' + options + '</select></label>' +
    (p ? '<label class="control"><span>Betriebsart</span><select id="cn-config">' + p.configurations.map(c => '<option value="' + esc(c.id) + '"' + (c.id === cn.configuration ? ' selected' : '') + ' data-no-i18n>' + esc(cnT(c, 'name')) + '</option>').join('') + '</select></label>' : '') + '</div>' +
    (!cnMatches().length ? '<p class="inline-notice">Kein eingebautes Profil passt zu ' + n + ' Ports. Lade eine passende Port-Map, z. B. für HDMI oder MagJack.</p>' : '') +
    '<div class="preset-row">' + actionButton('Port-Map-Datei laden', 'cn-import', '', 'button') + '<small class="note">JSON mit Pins, Seiten und Differenzpaaren je Port (simonlation.portmap.v1) oder eine exportierte Zuordnung.</small></div>' +
    (p ? '<dl class="cn-facts"><dt>Bauform</dt><dd>' + cnSpan(cnT(p, 'family') + ' · ' + cnT(p, 'variant')) + '</dd><dt>Ansicht</dt><dd>' + cnSpan(cnT(p, 'view')) + '</dd><dt>Messmodell</dt><dd>' + cnSpan(cnT(p.measurement, 'note')) + '</dd><dt>Profil</dt><dd>' + cnSpan(p.id + ' · rev. ' + p.revision + ' · schema ' + p.version) + '</dd></dl>' +
      '<details class="cn-sources"><summary>Quellen</summary><ul data-no-i18n>' + p.sources.map(s => '<li><strong>' + esc(cnT(s, 'title')) + '</strong> · ' + esc(cnT(s, 'ref')) + (s.note ? '<br><small>' + esc(cnT(s, 'note')) + '</small>' : '') + '</li>').join('') + '</ul></details>' : '') +
    '</div></section>';
  if (!p) { box.innerHTML = html; return; }
  const { verdict, validation } = cnVerdicts(p, cn.mapping);
  const portOf = new Map(); cn.mapping.ports.forEach((node, port) => node && !portOf.has(node) && portOf.set(node, port));
  // ---- mapping candidates
  const det = cn.detection;
  const scorePct = v => v === null || v === undefined ? '–' : Math.round(100 * v) + ' %';
  const cands = det ? (det.candidates.length ? det.candidates.map(c => '<li class="cn-cand' + (c.id === cn.candidate ? ' is-current' : '') + '"><div><span class="cn-badge is-' + CN_CATEGORY_CLASS[c.category] + '">' + esc(Connector.CATEGORY[c.category]) + '</span> <strong>' + esc(c.name) + '</strong>' +
    '<small>' + (c.score.thru !== null ? 'Durchgänge ' + scorePct(c.score.thru) + ' · ' : '') + (c.score.adjacency !== null ? 'Nachbarkopplung r = ' + (c.score.adjacency ?? 0).toFixed(2) + ' · ' : '') + (c.score.sides !== null && c.score.sides !== undefined ? 'Seiten ' + scorePct(c.score.sides) + ' · ' : '') + 'Portnamen ' + scorePct(c.score.names) + '</small>' +
    (c.conflict ? '<small class="cn-warn">' + esc(c.conflict) + '</small>' : '') +
    (c.alternatives?.some(a => a.equivalent) ? '<small><span>Aus den Daten gleichwertig:</span> ' + cnSpan(c.alternatives.filter(a => a.equivalent).map(a => cnT(p.symmetries.find(s => s.id === a.id), 'name') || (lang() === 'en' ? 'Sides 1 and 2 swapped' : a.name)).join(' · ')) + '</small>' : '') + '</div>' +
    (c.id !== cn.candidate ? actionButton('Übernehmen', 'cn-candidate', c.id, 'quiet-button') : '<span class="cn-current">aktiv</span>') + '</li>').join('') : '') : '';
  html += '<section class="config-card"><div class="config-head"><h2>Zuordnung</h2><p>Automatik in Stufen: Portnamen der Datei, Durchgänge (|S| bei tiefen Frequenzen), Nah-/Fernkopplung zwischen Nachbarn, Portreihenfolge-Konventionen. Eine unsichere Zuordnung wird nie als sicher übernommen.</p></div>' +
    '<div class="config-content"><div class="preset-row">' + actionButton('Automatisch zuordnen', 'cn-detect', '', 'button primary', 'reset') + actionButton('Zuordnung leeren', 'cn-clear', '', 'button') +
    (p.measurement.kind === 'thru' ? actionButton('Seiten tauschen', 'cn-transform', 'sides', 'button') : '') +
    p.symmetries.map(s => actionButton(cnT(s, 'name'), 'cn-transform', s.id, 'button', '', ' data-no-i18n')).join('') + '</div>' +
    (det ? '<p class="cn-status"><span class="cn-badge is-' + CN_CATEGORY_CLASS[det.status] + '">' + esc(Connector.CATEGORY[det.status] || det.status) + '</span> ' + (det.notes || []).map(x => '<span>' + esc(x) + '</span>').join(' ') + ' <small>(' + det.ms + ' ms)</small></p><ul class="cn-cands">' + cands + '</ul>' : '<p class="note">Noch keine automatische Zuordnung. Du kannst auch direkt in der Pinansicht oder der Tabelle zuordnen.</p>') +
    (validation.issues.length ? '<ul class="cn-issues">' + validation.issues.map(i => '<li class="is-' + i.level + '">' + esc(i.text) + '</li>').join('') + '</ul>' : '') + '</div></section>' + cnCheck(p);
  // ---- pin view + inspector
  const sel = cn.selected, selNode = sel ? Connector.splitNode(sel) : null, selContact = selNode ? p.contacts.find(c => c.id === selNode.contact) : null;
  const selPair = selContact ? p.pairs.find(x => x.plus === selContact.id || x.minus === selContact.id) : null;
  const portOptions = '<option value="-1">– keiner –</option>' + Array.from({ length: n }, (_, i) => '<option value="' + i + '"' + (portOf.get(sel) === i ? ' selected' : '') + '>' + esc('P' + (i + 1) + (state.dataset.portNames[i] ? ' · ' + state.dataset.portNames[i] : '') + (cn.mapping.ports[i] && cn.mapping.ports[i] !== sel ? ' (jetzt ' + cn.mapping.ports[i] + ')' : '')) + '</option>').join('');
  const selectedKey = selPair ? Connector.pairKey(selPair.id,selNode.side) : '';
  const pinPaths = cn.paths.filter(path => [path.a,path.b].some(c => Connector.pairKey(c.pair,c.side) === selectedKey) && cnPathCurrent(path));
  const closePath = c => c.pair + (c.side ? ' · ' + cnSide(p, c.side) : '');
  const pinCurves = pinPaths.map(path =>
    '<button type="button" class="button cn-path" data-action="cn-path" data-value="' + esc(path.id) +
      '" aria-pressed="' + (cn.path === path.id) + '" data-no-i18n>' + esc(closePath(path.a) + ' → ' + closePath(path.b)) + '</button>').join('');
  const unconfigured = selPair && !pinCurves ? '<p class="note">' + (lang() === 'en' ? 'Apply the mapped pairs to open a path. Both ends must be assigned.' :
    'Zuordnung übernehmen, um einen Signalweg zu öffnen. Beide Enden müssen zugeordnet sein.') + '</p>' : '';
  const inspector = selContact ? '<div class="cn-inspector"><h3 data-no-i18n>' + esc((selContact.pin ?? selContact.id) + ' · ' + selContact.label) + '</h3><p><small>' + (selContact.normative !== selContact.label ? '<span>Normativ:</span> ' + cnSpan(cnT(selContact, 'normative')) + ' · ' : '') + '<span>' + esc(CN_ROLE[selContact.role] || selContact.role) + '</span>' + (selNode.side ? ' · ' + cnSpan(cnSide(p, selNode.side)) : '') + '</small></p>' +
    (selContact.side || selPair ? '<p class="note">' +
      esc([selContact.side, selPair ? cnT(selPair, 'name') + ' ' + (selPair.plus === selContact.id ? '+' : '−') : ''].filter(Boolean).join(' · ')) +
      '</p>' : '') +
    '<label class="control"><span>Messport</span><select id="cn-port">' + portOptions + '</select></label>' +
    (selPair ? '<div class="preset-row">' + (selNode.side ? actionButton('Polarität von ' + selPair.id + ' tauschen · nur ' + cnSide(p, selNode.side), 'cn-swap', selPair.id + '|' + selNode.side, 'button') +
      actionButton('… beide Seiten', 'cn-swap', selPair.id, 'button') : actionButton('Polarität von ' + selPair.id + ' tauschen', 'cn-swap', selPair.id, 'button')) +
      '<label class="control narrow"><span>Paar tauschen mit</span><select id="cn-move"><option value="">–</option>' + p.pairs.filter(x => x.id !== selPair.id).map(x => '<option value="' + esc(x.id) + '" data-no-i18n>' + esc(cnT(x, 'name')) + '</option>').join('') + '</select></label></div>' : '') + '</div>'
    : '<div class="cn-inspector"><p class="note">Kontakt anklicken (oder mit Tab und Enter wählen), dann den Messport zuweisen. ✓ Durchgang durch die Messung bestätigt · ? nicht bestätigt · ! doppelt belegt.</p></div>';
  const faces = p.faces?.length ? p.faces : p.id === 'rj45-8p8c-thru' ? [{ kind: 'rj45', gender: 'receptacle' }] : [];
  const drawings = p.measurement.kind === 'thru'
    ? p.measurement.sides.map(s => cnDrawing(p, s, portOf, verdict, cn.logical ? null : faces[0])).join('')
    : faces.length && !cn.logical ? faces.map(f => cnDrawing(p, null, portOf, verdict, f)).join('') : cnDrawing(p, null, portOf, verdict);
  html += '<section class="config-card cn-view"><div class="config-head"><h2>Pinansicht</h2><p>' + cnSpan(cnT(p, 'view') + '.') + ' <span>Farben: Differentialpaare; grau: Masse; braun: Versorgung.</span></p></div><div class="config-content">' +
    '<div class="preset-row cn-zoombar">' + iconButton('Vergrößern', 'cn-zoom', 'in', 'plus') + actionButton('−', 'cn-zoom', 'out', 'icon-button', '', ' title="Verkleinern" aria-label="Verkleinern"') + actionButton('Ansicht zurücksetzen', 'cn-zoom', 'reset', 'quiet-button') + (faces.length ? actionButton(cn.logical ? 'Steckgesicht' : 'Logische Liste', 'cn-logical', '', 'quiet-button') +
      (!cn.logical ? actionButton('Ansicht spiegeln', 'cn-mirror', '', 'quiet-button') : '') : '') + '</div>' +
    '<div class="cn-drawings">' + drawings + '</div>' + inspector +
    (pinCurves ? '<div class="cn-paths preset-row">' + pinCurves + '</div>' : unconfigured) + '</div></section>';
  // ---- port table
  const thru = det?.thru ?? Connector.thruPaths(state.dataset), partner = new Map(); thru.paths.forEach(x => { partner.set(x.a, x); partner.set(x.b, x); });
  const nodes = Connector.nodesOf(p);
  html += '<section class="config-card"><div class="config-head"><h2>Messports</h2><p>Jeder Port lässt sich einzeln korrigieren. „Durchgang“ ist der gemessene Partnerport mit der stärksten Übertragung bei tiefen Frequenzen.</p></div><div class="config-content"><div class="table-scroll cn-ports"><table class="ports-table"><thead><tr><th scope="col">Port</th><th scope="col">Name in der Datei</th><th scope="col">Knoten</th><th scope="col">Quelle</th><th scope="col">Durchgang</th></tr></thead><tbody>' +
    Array.from({ length: n }, (_, i) => {
      const node = cn.mapping.ports[i], x = partner.get(i), other = x ? (x.a === i ? x.b : x.a) : null;
      return '<tr class="' + (node && verdict.get(node) === 'conflict' ? 'is-conflict' : '') + '"><td><span class="port-id">P' + (i + 1) + '</span></td><td><small>' + esc(state.dataset.portNames[i] || '–') + '</small></td>' +
        '<td><select class="cn-node" data-port="' + i + '" data-lazy="1" aria-label="Knoten für Port ' + (i + 1) + '"><option value="">–</option>' + (node ? '<option value="' + esc(node) + '" selected>' + esc(node.replace('@', ' · S')) + '</option>' : '') + '</select></td>' +
        '<td><small>' + esc(CN_SOURCE[cn.mapping.source[i] || '']) + '</small></td><td class="mono"><small>' + (other !== null ? 'P' + (other + 1) + ' · ' + x.mag.toFixed(2) + (x.clear ? '' : ' ?') : '–') + '</small></td></tr>';
    }).join('') + '</tbody></table></div></div></section>';
  // ---- apply
  const conf = p.configurations.find(c => c.id === cn.configuration) || p.configurations.at(-1);
  const mapped = new Set(Connector.mappedPairs(p, cn.mapping).map(x => x.pair));
  const applied = cn.applied || { others: 'match', taps: 'open' };
  html += '<section class="config-card"><div class="config-head"><h2>In die Analyse übernehmen</h2><p>Die gewählten Paare werden Mixed-Mode-Paare (D/C je Seite). Alle anderen Ports werden abgeschlossen. Danach stehen alle Kurven im Tab S-Parameter, im Smith-Chart, in Z und im ESB-Modell zur Verfügung.</p></div><div class="config-content"><form id="cn-apply-form">' +
    '<fieldset class="cn-pairs"><legend><span>Paare</span>' + (conf.note ? ' · ' + cnSpan(cnT(conf, 'note')) : '') + '</legend>' + p.pairs.map(x => '<label class="cn-check"><input type="checkbox" name="pair-' + esc(x.id) + '"' + (conf.pairs.includes(x.id) && mapped.has(x.id) ? ' checked' : '') + (mapped.has(x.id) ? '' : ' disabled') + '> ' + cnSpan(cnT(x, 'name')) + (mapped.has(x.id) ? '' : ' <small>(nicht zugeordnet)</small>') + '</label>').join('') + '</fieldset>' +
    '<div class="preset-row"><label class="control"><span>Übrige Ports</span><select name="others"><option value="match"' + (applied.others === 'match' ? ' selected' : '') + '>angepasst abschließen (Bezugsimpedanz)</option><option value="open"' + (applied.others === 'open' ? ' selected' : '') + '>offen</option><option value="active"' + (applied.others === 'active' ? ' selected' : '') + '>aktiv lassen (Single Ended)</option></select></label>' +
    (p.contacts.some(c => c.role === 'tap') ? '<label class="control"><span>Mittelanzapfungen</span><select name="taps"><option value="open"' + (applied.taps === 'open' ? ' selected' : '') + '>offen</option><option value="match"' + (applied.taps === 'match' ? ' selected' : '') + '>angepasst abschließen</option><option value="active"' + (applied.taps === 'active' ? ' selected' : '') + '>aktiv lassen</option></select></label>' : '') +
    '<button class="button primary" type="submit">In Analyse übernehmen</button></div></form>' +
    '<div class="preset-row">' + actionButton('Als Vorlage speichern', 'cn-save', '', 'button') + actionButton('Zuordnung exportieren', 'cn-export', '', 'button') + actionButton('Zuordnung importieren', 'cn-import', '', 'button') +
    ((cn.templates || []).length ? '<label class="control"><span>Gespeicherte Vorlage</span><select id="cn-template"><option value="">–</option>' + cn.templates.map((t, i) => '<option value="' + i + '"' + (t.profile.id !== p.id || t.ports !== n ? ' disabled' : '') + '>' + esc(t.name + ' · ' + t.ports + ' Ports') + '</option>').join('') + '</select></label>' : '') + '</div></div></section>';
  html += cnChannels() + cnCrosstalk() + cnMatrix();
  insertHtml(box, html);
  cnFillIdle();
}

registerActions({
  'cn-detect': cnDetect,
  'cn-clear': () => { state.connector.mapping = Connector.emptyMapping(cnProfile(), state.dataset.n); state.connector.candidate = ''; persistSettings(); renderConnector(); },
  'cn-transform': cnTransform,
  'cn-candidate': cnUseCandidate,
  'cn-swap': value => { const [pair, side] = String(value).split('|'); cnSwapPair(pair, '', side ? Number(side) : null); },
  'cn-zoom': value => { const cn = state.connector; cn.zoom = value === 'reset' ? 1 : Math.max(0.5, Math.min(4, cn.zoom * (value === 'in' ? 1.25 : 0.8))); if (value === 'reset') cn.pan = [0, 0]; renderConnector(); },
  'cn-save': cnSaveTemplate,
  'cn-export': cnExport,
  'cn-import': () => $('cn-file').click(),
  'cn-path': cnOpenPath,
  'cn-logical': () => { state.connector.logical = !state.connector.logical; renderConnector(); },
  'cn-mirror': () => { state.connector.mirrored = !state.connector.mirrored; renderConnector(); },
  'cn-curves': value => cnOpenCurves(value.split(',')),
  'cn-cell': value => cnOpenCurves([value]),
});

registerForms({
  'cn-apply-form': cnApply,
});

registerView({ id: 'connector', title: 'Connector', panel: 'connector-panel', render: renderConnector, context: 'Steckverbinder und Magnetics · Kontakte, Messports, Kanäle' });

// The mapping travels with the file. A profile read from a port-map file is stored with it, so it is there again after a reload.
registerFileState('connector', {
  blank: cnBlank,
  save: cn => cn.profile && cn.mapping ? {
    profile: cn.profile, custom: Connector.profile(cn.profile)?.status === 'file' ? Connector.profile(cn.profile) : null,
    revision: cnProfile().revision, configuration: cn.configuration, ports: cn.mapping.ports,
    source: cn.mapping.source, links: cn.mapping.links, channels: cn.channels, applied: cn.applied || null,
    path: cn.path, xtChannel: cn.xtChannel, freq: cn.freq, plotSource: cn.plotSource
  } : null,
  load: (saved, dataset) => {
    if (!saved.profile) return undefined;
    try {
      const candidate = saved.custom || Connector.profile(saved.profile);
      const { profile: cp, mapping } = Connector.importMap({
        schema: Connector.MAP_SCHEMA, version: Connector.VERSION,
        profile: { id: saved.profile, revision: saved.revision || candidate?.revision },
        profileDefinition: saved.custom ?? undefined, ports: dataset.n, map: saved.ports, paths: saved.links,
      }, dataset.n);
      mapping.source = Array.isArray(saved.source) && saved.source.length === dataset.n ? saved.source.map(String) : mapping.source;
      const channels = saved.applied ? Connector.toConfig(cp, mapping, dataset.n, saved.applied).channels : [];
      const paths = Connector.directedPaths(channels, Connector.checkChannels(cp, mapping, dataset));
      if (saved.custom) Connector.register(cp);
      return { ...cnBlank(), profile: cp.id, configuration: saved.configuration || cp.configurations.at(-1).id, mapping,
        channels, paths, applied: saved.applied || null, path: saved.path || '', xtChannel: saved.xtChannel,
        freq: Number.isInteger(saved.freq) && saved.freq >= 0 && saved.freq < dataset.freq.length ? saved.freq : null,
        plotSource: saved.plotSource };
    } catch (error) { console.warn('Connector-Zuordnung konnte nicht wiederhergestellt werden: ' + error.message); return undefined; }
  },

});

document.addEventListener('input', event => { if (event.target.id === 'cn-freq') { state.connector.freq = Number(event.target.value); renderConnector(); $('cn-freq')?.focus({ preventScroll: true }); } });
// Pin view: click or Enter/Space selects a contact node; wheel zooms, dragging pans.
document.addEventListener('click', event => {
  const pin = event.target.closest?.('.cn-pin');
  if (!pin || state.tab !== 'connector') return;
  state.connector.selected = state.connector.selected === pin.dataset.node ? '' : pin.dataset.node;
  renderConnector();
  document.querySelector('.cn-pin[data-node="' + CSS.escape(pin.dataset.node) + '"]')?.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  const pin = event.target.closest?.('.cn-pin');
  if (!pin || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault(); pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
document.addEventListener('wheel', event => {
  if (!event.target.closest?.('.cn-svg') || !event.ctrlKey && !event.altKey) return;
  event.preventDefault();
  const cn = state.connector; cn.zoom = Math.max(0.5, Math.min(4, cn.zoom * (event.deltaY < 0 ? 1.1 : 0.9))); renderConnector();
}, { passive: false });
let cnDrag = null;
document.addEventListener('pointerdown', event => { const svg = event.target.closest?.('.cn-svg'); if (svg && !event.target.closest('.cn-pin')) cnDrag = { x: event.clientX, y: event.clientY, pan: [...state.connector.pan] }; });
document.addEventListener('pointermove', event => {
  if (!cnDrag) return;
  state.connector.pan = [cnDrag.pan[0] + event.clientX - cnDrag.x, cnDrag.pan[1] + event.clientY - cnDrag.y];
  document.querySelectorAll('.cn-zoom').forEach(g => g.setAttribute('transform', 'translate(' + state.connector.pan[0] + ' ' + state.connector.pan[1] + ') scale(' + state.connector.zoom + ')'));
});
document.addEventListener('pointerup', () => { cnDrag = null; });

document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'cn-profile') { cnSetProfile(el.value); return; }
  if (el.id === 'cn-config') { state.connector.configuration = el.value; persistSettings(); renderConnector(); return; }
  if (el.id === 'cn-port') { cnAssign(state.connector.selected, Number(el.value)); return; }
  if (el.id === 'cn-move') { if (el.value) cnSwapPair(Connector.profile(state.connector.profile).pairs.find(x => x.plus === Connector.splitNode(state.connector.selected).contact || x.minus === Connector.splitNode(state.connector.selected).contact)?.id, el.value); return; }
  if (el.matches('select.cn-node')) { const port = Number(el.dataset.port), m = state.connector.mapping; if (el.value) cnAssign(el.value, port); else { m.ports[port] = null; m.source[port] = ''; persistSettings(); renderConnector(); } return; }
  if (el.id === 'cn-template') { if (el.value !== '') cnUseTemplate(el.value); return; }
  if (el.id === 'cn-modes') { state.connector.matrixModes = el.value; renderConnector(); return; }
  if (el.id === 'cn-xt-channel') { state.connector.xtChannel = el.value; persistSettings(); renderConnector(); return; }
  if (el.id === 'cn-file') { const file = el.files?.[0]; el.value = ''; if (file) cnImport(file); return; }
});
