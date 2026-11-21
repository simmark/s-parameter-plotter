// module/ports/ports – Tab „Ports & Lasten“: Portpaare, Dreiergruppen, Bezugsimpedanz.
import { refreshNetwork } from '../../analyse/netzwerk.js';
import { $, actionButton, disabled, esc, icon, iconButton, insertHtml, notice, options, pressed, textField } from '../../basis/dom.js';
import { registerActions, registerForms, registerView } from '../../basis/erweiterung.js';
import { modeMarkup, pairColor } from '../../basis/farben.js';
import { display, numberValue, portName } from '../../basis/format.js';
import { EDITABLE_LOADS, LOADS, state } from '../../basis/zustand.js';
import { persistSettings } from '../../dateien/einstellungen.js';
import { physicsCard, profileCard } from './physik.js';
import { loadDescription, loadName, topoHtml } from '../../oberflaeche/seitenleiste.js';

function displacedPairs(ports, currentId) {
  return state.config.pairs.filter(pair => pair.id !== currentId && (ports.includes(pair.p) || ports.includes(pair.q)));
}

function renderPairEditor(groupFor) {
  const { dataset, config } = state;
  if (dataset.n < 2) return '<p class="note">Für ein Portpaar sind mindestens zwei physische Ports nötig.</p>';
  const draft = state.pairDraft ??= { id: null, plus: null, minus: null, side: 'plus' };
  const ports = [draft.plus, draft.minus].filter(port => port !== null);
  const target = (side, label) => actionButton(label + ' · ' + (draft[side] === null ? 'wählen' : portName(draft[side])),
    'pair-target', side, 'button pair-target', '', ' id="pair-target-' + side + '"' + pressed(draft.side === side));
  const draftColor = pairColor(draft.id ?? config.pairs.length + 1);
  const cards = RF.indices(dataset.n).map(port => {
    const pair = groupFor(port);
    const load = config.loads[port];
    const isLoaded = load.type !== 'active';
    const role = pair ? 'D' + pair.id + (pair.p === port ? ' +' : ' −') : isLoaded ? loadName(load) : 'Einzeln';
    const chosen = draft.plus === port ? '+' : draft.minus === port ? '−' : '';
    const name = dataset.portNames[port];
    // Ports that already belong to another pair are greyed out but stay selectable (they are then moved).
    const taken = pair && pair.id !== draft.id && !chosen;
    const color = chosen ? draftColor : pair ? pairColor(pair.id) : '';
    return '<button type="button" class="assign-port' + (taken ? ' is-taken' : '') + (pair ? ' is-paired' : '') + '" id="assign-port-' + port +
      '" data-action="pair-port" data-value="' + port + '"' + (color ? ' style="--pc:' + color + '"' : '') +
      pressed(!!chosen) + ' aria-label="' + esc([portName(port), name, role, chosen && ('gewählt für ' + (chosen === '+' ? 'Plus' : 'Minus'))].filter(Boolean).join(' · ')) + '">' +
      '<span class="assign-port-line"><strong>' + portName(port) + '</strong><span class="assign-role' +
      (pair ? ' paired' : isLoaded ? ' terminated' : '') + '">' + esc(role) + '</span></span>' +
      (name ? '<small title="' + esc(name) + '">' + esc(name) + '</small>' : '') +
      (chosen ? '<span class="assign-selection" aria-hidden="true">' + chosen + '</span>' : '') + '</button>';
  }).join('');
  const activated = ports.filter(port => config.loads[port].type !== 'active');
  const displaced = displacedPairs(ports, draft.id);
  const changes = [
    activated.length ? 'Abschlüsse an ' + activated.map(portName).join(', ') + ' werden entfernt.' : '',
    ...displaced.map(pair => 'Paar ' + pair.id + ' (' + portName(pair.p) + '/' + portName(pair.q) + ') wird aufgelöst.')
  ].filter(Boolean).join(' ');
  return '<form id="pair-form"><div class="pair-editor-head"><h3>' +
    (draft.id === null ? 'Neues Paar' : 'Paar ' + draft.id + ' bearbeiten') + '</h3></div>' +
    '<input type="hidden" name="plus" value="' + (draft.plus ?? '') + '"><input type="hidden" name="minus" value="' + (draft.minus ?? '') + '">' +
    '<div class="pair-targets" role="group" aria-label="Polarität wählen">' + target('plus', '+ Plus') + target('minus', '− Minus') + '</div>' +
    '<div class="assign-ports" role="group" aria-label="Alle ' + dataset.n + ' physischen Ports">' + cards + '</div>' +
    (changes ? '<p class="pair-impact" role="status">' + esc(changes) + '</p>' : '') +
    '<div class="pair-editor-actions"><button class="button primary" type="submit"' + disabled(ports.length < 2) + '>' +
    (draft.id === null ? icon('plus') + ' Paar anlegen' : icon('check') + ' Änderungen übernehmen') + '</button>' +
    (draft.id !== null || ports.length ? actionButton('Auswahl zurücksetzen', 'cancel-pair', '', 'quiet-button') : '') + '</div>' +
    '<p class="inline-notice" id="config-error" role="alert" hidden></p></form>';
}

function renderConfig() {
  const { dataset, config, layout } = state;
  const groupFor = port => config.pairs.find(p => p.p === port || p.q === port);
  const modeRef = (type, id) => layout.mmModes.find(m => m.key === type + id);
  const pairs = config.pairs.map(pair => {
    const d = modeRef('D', pair.id), c = modeRef('C', pair.id);
    return '<div class="pair-card" style="--pc:' + pairColor(pair.id) + '"><span class="pair-name">' + modeMarkup('D' + pair.id + ' / C' + pair.id) + '</span><div><strong>' +
      portName(pair.p) + ' (+) &nbsp; ' + portName(pair.q) + ' (−)</strong><small>Z<sub>D</sub> ' + esc(display(d?.ref)) + ' Ω · Z<sub>C</sub> ' +
      esc(display(c?.ref)) + ' Ω' + (d && (d.ref !== d.natRef || c.ref !== c.natRef) ? ' · angepasst' : '') + '</small></div><div class="pair-buttons">' +
      iconButton('Paar ' + pair.id + ' bearbeiten', 'edit-pair', pair.id, 'edit') +
      iconButton('Polarität von Paar ' + pair.id + ' tauschen', 'swap-pair', pair.id, 'swap') +
      iconButton('Paar ' + pair.id + ' auflösen', 'remove-pair', pair.id, 'close') + '</div></div>';
  }).join('');
  const half = Math.floor(dataset.n / 2);
  const presets = dataset.n >= 2 ? '<div class="preset-row"><span>Vorlagen</span>' +
    (dataset.profile ? actionButton(dataset.profile.part + ' · CT Open', 'pair-preset', 'lan') : '') +
    actionButton('Benachbart (1,2)(3,4)…', 'pair-preset', 'adjacent') +
    (dataset.n >= 4 ? actionButton('Gekreuzt (1,3)(2,4)…', 'pair-preset', 'cross') : '') +
    (dataset.n >= 4 ? actionButton('Hälften (1,' + (half + 1) + ')(2,' + (half + 2) + ')…', 'pair-preset', 'half') : '') +
    (config.pairs.length ? actionButton('Alle auflösen', 'pair-preset', 'none') : '') + '</div>' : '';
  const impedance = config.pairs.length ? '<section class="config-card"><div class="config-head"><h2>Modenimpedanz je Paar</h2>' +
    '<p>Bezugsimpedanz der D- und C-Moden. Leer = Standard (Z_D = 2R, Z_C = R/2). Für Netzfilter z. B. 0,1 Ω an einer Seite und 100 Ω an der anderen (CISPR 17).</p></div>' +
    '<div class="config-content"><form id="pairz-form"><div class="table-scroll"><table class="ports-table pairz-table"><thead><tr><th scope="col">Paar</th>' +
    '<th scope="col">Z<sub>D</sub> [Ω]</th><th scope="col">Z<sub>C</sub> [Ω]</th></tr></thead><tbody>' +
    config.pairs.map(pair => {
      const d = modeRef('D', pair.id), c = modeRef('C', pair.id);
      return '<tr style="--pc:' + pairColor(pair.id) + '"><td><span class="pair-chip">' + modeMarkup('D' + pair.id + ' / C' + pair.id) + '</span></td>' +
        '<td><input class="field-input mono" name="zd-' + pair.id + '" inputmode="decimal" value="' + esc(pair.zd ?? '') + '" placeholder="' + esc(display(d?.natRef)) + '" aria-label="Z D Paar ' + pair.id + '"></td>' +
        '<td><input class="field-input mono" name="zc-' + pair.id + '" inputmode="decimal" value="' + esc(pair.zc ?? '') + '" placeholder="' + esc(display(c?.natRef)) + '" aria-label="Z C Paar ' + pair.id + '"></td></tr>';
    }).join('') + '</tbody></table></div><div class="preset-row"><button class="button primary" type="submit">Anwenden</button>' +
    actionButton('Standard', 'pairz-preset', 'reset') +
    (config.pairs.length >= 2 ? actionButton('0,1 Ω → 100 Ω', 'pairz-preset', 'low-high') + actionButton('100 Ω → 0,1 Ω', 'pairz-preset', 'high-low') : '') +
    '</div><p class="inline-notice" id="pairz-error" role="alert" hidden></p></form></div></section>' : '';
  const triples = config.triples || [];
  const tripleFor = port => triples.find(t => [t.a, t.b, t.c].includes(port));
  const freePorts = RF.indices(dataset.n).filter(port => !groupFor(port) && !tripleFor(port) && config.loads[port].type === 'active');
  const sel = (name, k) => '<label class="control narrow"><span>' + ['Leiter 1', 'Leiter 2', 'Leiter 3'][k] + '</span><select name="' + name + '">' + freePorts.map((port, i) => '<option value="' + port + '"' + (i === k ? ' selected' : '') + '>' + esc(portName(port)) + '</option>').join('') + '</select></label>';
  const tripleCard = dataset.n >= 3 ? '<section class="config-card"><div class="config-head"><h2>Dreileitergruppen (0/α/β)</h2><p>Für Drehstrom- und Dreileiter-Netzwerke, z. B. 3-Phasen-CMC. Leistungsinvariante Clarke-Transformation: V₀ = (V₁+V₂+V₃)/√3, Vα = (2V₁−V₂−V₃)/√6, Vβ = (V₂−V₃)/√2. 0 ist das Nullsystem (alle Leiter gleichphasig, Gleichtakt gegen Masse), α und β sind Leiter-Leiter-Moden. Die Bezugsimpedanz jeder Mode ist die der Ports.</p></div><div class="config-content">' +
    (triples.length ? '<div class="pair-list">' + triples.map(t => '<div class="pair-card" style="--pc:#7a5a12"><span class="pair-name">T' + t.id + '</span><div><strong>' + [t.a, t.b, t.c].map(portName).join(' · ') + '</strong><small>0' + t.id + ' · α' + t.id + ' · β' + t.id + '</small></div><div class="pair-buttons">' + iconButton('Gruppe T' + t.id + ' auflösen', 'triple-remove', t.id, 'close') + '</div></div>').join('') + '</div>' : '') +
    (freePorts.length >= 3 ? '<form id="triple-form"><div class="preset-row">' + sel('a', 0) + sel('b', 1) + sel('c', 2) + '<button class="button primary" type="submit">Gruppe bilden</button></div></form>' : '<p class="note">Für eine weitere Gruppe sind nicht genug freie aktive Ports da (Paare und Gruppen belegen sie).</p>') +
    (dataset.n === 6 && !config.pairs.length && !triples.length ? '<div class="preset-row"><span>Vorlagen</span>' + actionButton('(1,2,3)(4,5,6)', 'triple-preset', 'halves') + '</div>' : '') +
    '<p class="inline-notice" id="triple-error" role="alert" hidden></p></div></section>' : '';
  const rows = RF.indices(dataset.n).map(port => {
    const pair = groupFor(port), triple = tripleFor(port);
    const load = config.loads[port];
    const currentRef = layout.seRefs[layout.active.indexOf(port)];
    const physicalRef = dataset.refs[port];
    const label = dataset.portNames[port];
    return '<tr><td><span class="port-id">' + portName(port) + '</span>' +
      (label ? '<small title="' + esc(label) + '">' + esc(label) + '</small>' : '') +
      '</td><td>' + (triple ? '<span class="badge pair-badge" style="--pc:#7a5a12">Gruppe T' + triple.id + ' · L' + ([triple.a, triple.b, triple.c].indexOf(port) + 1) + '</span>' : pair ? '<span class="badge pair-badge" style="--pc:' + pairColor(pair.id) + '">Paar ' + pair.id + ' ' + (pair.p === port ? '+' : '−') + '</span>' :
        '<div class="load-cell"><select id="port-load-' + port + '" aria-label="Abschluss ' + portName(port) +
        '" data-change="load-type" data-port="' + port + '">' + options([...LOADS, ...RF.indices(dataset.n).filter(other => other !== port && config.loads[other].type !== 'join')
          .map(other => ['join:' + other, 'Verbinden mit ' + portName(other)])], load.type === 'join' ? 'join:' + load.to : load.type) + '</select>' +
        (EDITABLE_LOADS.includes(load.type) ? iconButton('Last an ' + portName(port) + ' bearbeiten', 'edit-load', port, 'edit') : '') +
        '</div>' + (load.type !== 'active' ? '<small title="' + esc(loadDescription(load, physicalRef)) + '">' +
          esc(loadDescription(load, physicalRef)) + '</small>' : '')) + '</td>' +
      '<td class="port-ref">' + esc(display(physicalRef)) + ' Ω</td><td class="port-ref">' +
      (currentRef === undefined ? '—' : esc(display(currentRef)) + ' Ω') + '</td></tr>';
  }).join('');
  const automatic = layout.notices.map(p => 'Paar ' + p.id + ' → ' + display(p.ref) + ' Ω').join(' · ');
  const schematic = '<details class="port-schematic" id="port-schematic"' + ($('port-schematic')?.open ? ' open' : '') +
    '><summary>Portschema</summary>' + topoHtml(true) + '</details>';
  const html = profileCard() + physicsCard() + '<div class="config-grid"><div>' +
    '<section class="config-card"><div class="config-head"><h2>Portzuordnung</h2><p>' + dataset.n +
    ' physische Ports · Tippe nacheinander auf Plus- und Minus-Port.</p></div><div class="config-content">' +
    renderPairEditor(groupFor) + (pairs ? '<div class="pair-list">' + pairs + '</div>' : '') + presets + schematic + '</div></section>' + impedance + tripleCard +
    '<section class="config-card"><div class="config-head"><h2>Bezugsimpedanz</h2><p>Renormierung der aktiven Single-Ended-Ports.</p></div>' +
    '<div class="config-content"><form id="reference-form" class="reference-form">' +
    textField('Einheitlich [Ω]', 'reference', config.ref ?? '', 'Wie Datei') +
    '<button class="button primary" type="submit">Anwenden</button>' +
    actionButton('Dateireferenz', 'reset-ref', '', 'button', '', disabled(config.ref === null)) +
    '</form><p class="inline-notice" id="reference-error" role="alert" hidden></p><p class="note">' + (automatic ? esc('Paarweise Renormierung · ' + automatic) :
      'Ein leeres Feld verwendet die Dateireferenzen.') + '</p></div></section></div>' +
    '<section class="config-card"><div class="config-head"><h2>Physische Ports</h2><p>Lasten wirken gegen Masse. Gepaarte Ports bleiben aktiv.</p></div>' +
    '<div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Port</th><th scope="col">Zuordnung / Abschluss</th>' +
    '<th scope="col">Z₀ Datei</th><th scope="col">Z₀ aktiv</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="note">Load Z₀ schließt mit der Dateireferenz ab. Die Werte rechts gelten für die Berechnung des aktiven Netzes.</p></section></div>';
  insertHtml($('config-panel'), html);
}

function editPair(id) {
  const pair = state.config.pairs.find(item => item.id === id);
  if (!pair) return;
  state.pairDraft = { id, plus: pair.p, minus: pair.q, side: 'plus' };
  renderConfig();
  $('pair-target-plus').focus();
}

function choosePairPort(port) {
  const draft = state.pairDraft;
  const side = draft.side;
  const other = side === 'plus' ? 'minus' : 'plus';
  if (port === draft[other]) draft[other] = draft[side];
  draft[side] = port;
  if (side === 'plus') draft.side = 'minus';
  renderConfig();
}

function commitTriples(triples) {
  state.config.triples = triples.map((t, i) => ({ a: t.a, b: t.b, c: t.c, id: i + 1 }));
  if (!state.config.triples.length) delete state.config.triples;
  else state.basis = 'mm';
  state.sKeys.mm = null;
  persistSettings();
  refreshNetwork();
}
function saveTriple(form) {
  const data = new FormData(form), ports = ['a', 'b', 'c'].map(k => Number(data.get(k)));
  if (new Set(ports).size !== 3 || ports.some(p => !Number.isInteger(p) || p < 0 || p >= state.dataset.n)) { notice('triple-error', 'Wähle drei verschiedene Ports.'); return; }
  commitTriples([...(state.config.triples || []), { a: ports[0], b: ports[1], c: ports[2] }]);
}

function commitPairs(pairs) {
  const positionOf = id => pairs.findIndex(pair => pair.id === id) + 1;
  state.pairIn = positionOf(state.pairIn) || 1;
  state.pairOut = positionOf(state.pairOut) || 2;
  state.config.pairs = pairs.map((pair, i) => ({ ...pair, id: i + 1 }));
  state.pairDraft = null;
  state.sKeys.mm = null;
  refreshNetwork();
}

function savePair(form) {
  const data = new FormData(form);
  const selection = [data.get('plus'), data.get('minus')];
  const [p, q] = selection.map(Number);
  if (p === q || selection.some(value => !/^\d+$/.test(value) || Number(value) >= state.dataset.n)) {
    notice('config-error', 'Wähle zwei verschiedene Ports für Plus und Minus.');
    return;
  }
  const config = state.config;
  const id = state.pairDraft.id;
  const displaced = new Set(displacedPairs([p, q], id).map(pair => pair.id));
  const next = config.pairs.filter(pair => !displaced.has(pair.id))
    .map(pair => pair.id === id ? { ...pair, id, p, q } : pair);
  if (id === null) next.push({ id, p, q });
  if (!config.pairs.length) state.basis = 'mm';
  for (const port of [p, q]) config.loads[port] = { type: 'active' };
  commitPairs(next);
}

function applyPairPreset(value) {
  const config = state.config;
  const n = state.dataset.n;
  const profile = state.dataset.profile;
  if (value === 'lan' && profile) {
    config.pairs = profile.pairs.map((pair, i) => ({ ...pair, id: i + 1 }));
    config.loads = config.loads.map((_, i) => ({ type: profile.taps.includes(i) ? 'open' : 'active' }));
  } else {
    const coords = [];
    if (value === 'adjacent') for (let i = 0; i + 1 < n; i += 2) coords.push([i, i + 1]);
    if (value === 'cross') for (let i = 0; i + 3 < n; i += 4) coords.push([i, i + 2], [i + 1, i + 3]);
    if (value === 'half') for (let i = 0; i < Math.floor(n / 2); i++) coords.push([i, i + Math.floor(n / 2)]);
    config.pairs = coords.map(([p, q], i) => ({ p, q, id: i + 1 }));
    for (const [p, q] of coords) { config.loads[p] = { type: 'active' }; config.loads[q] = { type: 'active' }; }
  }
  if (!config.pairs.length) state.basis = 'se';
  state.pairIn = 1; state.pairOut = 2;
  state.pairDraft = null;
  state.sKeys.mm = null;
  if (config.pairs.length) state.basis = 'mm';
  refreshNetwork();
}

function applyPairImpedance(form) {
  const data = new FormData(form);
  const read = name => {
    const text = String(data.get(name) ?? '').trim();
    return text ? numberValue(text) : null;
  };
  const next = state.config.pairs.map(pair => ({ ...pair, zd: read('zd-' + pair.id), zc: read('zc-' + pair.id) }));
  if (next.some(pair => [pair.zd, pair.zc].some(v => v !== null && !(Number.isFinite(v) && v > 0)))) {
    notice('pairz-error', 'Modenimpedanzen müssen reell und positiv sein, z. B. 0,1 oder 100.');
    return;
  }
  state.config.pairs = next;
  refreshNetwork();
}

function pairImpedancePreset(value) {
  const pairs = state.config.pairs;
  pairs.forEach((pair, i) => {
    if (value === 'reset') { pair.zd = null; pair.zc = null; return; }
    const low = value === 'low-high' ? i === 0 : i !== 0;
    pair.zd = low ? 0.1 : 100; pair.zc = low ? 0.1 : 100;
  });
  refreshNetwork();
}

function applyReference(form) {
  const text = new FormData(form).get('reference').trim();
  const ref = text ? numberValue(text) : null;
  if (text && !(Number.isFinite(ref) && ref > 0)) {
    notice('reference-error', 'Die Bezugsimpedanz muss reell und positiv sein.');
    return;
  }
  state.config.ref = ref;
  refreshNetwork();
}

registerActions({
  'pair-target': value => { state.pairDraft.side = value; renderConfig(); },
  'pair-port': value => choosePairPort(Number(value)),
  'edit-pair': value => editPair(Number(value)),
  'cancel-pair': () => { state.pairDraft = null; renderConfig(); },
  'swap-pair': value => {
    const pair = state.config.pairs.find(p => p.id === Number(value));
    if (!pair) return;
    [pair.p, pair.q] = [pair.q, pair.p];
    if (state.pairDraft?.id === pair.id) state.pairDraft = null;
    refreshNetwork();
  },
  'remove-pair': value => commitPairs(state.config.pairs.filter(pair => pair.id !== Number(value))),
  'triple-remove': value => commitTriples((state.config.triples || []).filter(t => t.id !== Number(value))),
  'triple-preset': () => commitTriples([{ a: 0, b: 1, c: 2 }, { a: 3, b: 4, c: 5 }]),
  'pair-preset': applyPairPreset,
  'pairz-preset': pairImpedancePreset,
  'reset-ref': () => { state.config.ref = null; refreshNetwork(); },
});

registerForms({
  'pair-form': savePair,
  'triple-form': saveTriple,
  'pairz-form': applyPairImpedance,
  'reference-form': applyReference,
});

registerView({ id: 'ports', title: 'Ports & Lasten', panel: 'config-panel', render: renderConfig, context: 'Portpaare, physische Abschlüsse und Bezugsimpedanzen' });

export { renderConfig };
