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

  const cnBlank = () => ({ profile: '', configuration: '', mapping: null, detection: null, candidate: '', selected: '', channels: [], zoom: 1, pan: [0, 0], freq: null, matrixModes: 'D' });
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
    cn.detection = null; cn.candidate = ''; cn.selected = ''; cn.channels = [];
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
    const v = Connector.validateMapping(p, cn.mapping);
    if (!v.ok) { toast('Die Zuordnung hat Fehler: ' + v.issues.find(i => i.level === 'error').text); return; }
    const { config, channels } = Connector.toConfig(p, cn.mapping, state.dataset.n, { pairs, others: String(data.get('others') || 'match'), taps: String(data.get('taps') || 'open') });
    if (!config.pairs.length) { toast('Für die gewählten Paare sind nicht beide Ports zugeordnet.'); return; }
    state.config = config;
    const links = new Map(cnChecks(p, cn.mapping).filter(c => c.fromData).map(c => [c.to, p.pairs.find(x => x.id === c.from)?.channelKey]));
    cn.channels = channels.map(c => ({ id: c.id, pair: c.pair, side: c.side, channel: links.get(c.pair) ?? c.channel, end: c.end, name: c.name, plus: c.plus, minus: c.minus }));
    cn.applied = { pairs, others: String(data.get('others') || 'match'), taps: String(data.get('taps') || 'open') };
    state.basis = 'mm'; state.sKeys.mm = null; state.pairIn = 1; state.pairOut = Math.min(2, config.pairs.length);
    state.pairDraft = null;
    toast(plural(config.pairs.length, 'Paar', 'Paare') + ' aus der Zuordnung übernommen · übrige Ports ' + ({ match: 'angepasst abgeschlossen', open: 'offen', active: 'aktiv' }[cn.applied.others]) + '.');
    persistSettings();
    refreshNetwork();
  }
  // Curves of one channel or one matrix cell in the S-parameter view (rows: response mode, columns: excitation mode).
  function cnOpenCurves(keys) {
    state.basis = 'mm'; state.sKeys.mm = keys; state.sFormat = 'db';
    setTab('s');
  }
  async function cnSaveTemplate() {
    const cn = state.connector, p = cnProfile();
    if (!p || !cn.mapping?.ports.some(Boolean)) { toast('Keine Zuordnung zum Speichern.'); return; }
    const name = (state.dataset.name || 'Zuordnung').replace(/\.[^.]+$/, '') + ' · ' + p.family;
    const map = Connector.exportMap(p, cn.mapping, { name, created: new Date().toISOString() });
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
      const { profile, mapping, name } = Connector.importMap(t);
      if (Connector.portCount(profile) !== state.dataset.n) throw new Error('Die Vorlage gilt für ' + Connector.portCount(profile) + ' Ports.');
      cn.profile = profile.id; cn.mapping = mapping; cn.candidate = ''; cn.detection = null;
      toast('Vorlage „' + name + '“ angewendet. Prüfe die Zuordnung, bevor du sie übernimmst.');
      persistSettings(); renderConnector();
    } catch (error) { toast(error.message); }
  }
  function cnExport() {
    const p = cnProfile();
    if (!p || !state.connector.mapping) return;
    const map = Connector.exportMap(p, state.connector.mapping, { name: state.dataset.name, created: new Date().toISOString() });
    saveBlob(new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }), (state.dataset.name || 'zuordnung').replace(/\.[^.]+$/, '') + '.port-map.json');
  }
  async function cnImport(file) {
    try {
      if (file.size > 1 << 20) throw new Error('Die Datei ist zu groß für eine Port-Zuordnung.');
      const text = await file.text(), json = JSON.parse(text);
      const sidecar = /portmap\.v1$/.test(String(json?.schema || ''));
      const { profile, mapping, name } = sidecar ? Connector.fromSidecar(json, state.dataset.n) : Connector.importMap(json);
      if (Connector.portCount(profile) !== state.dataset.n) throw new Error('Die Zuordnung gilt für ' + Connector.portCount(profile) + ' Ports, die Datei hat ' + state.dataset.n + '.');
      if (sidecar) Connector.register(profile);
      // another profile: the applied channels belonged to the old one; the same profile keeps them (the analysis is unchanged)
      if (state.connector.profile !== profile.id) { state.connector.configuration = profile.configurations.at(-1).id; state.connector.channels = []; state.connector.selected = ''; }
      state.connector.profile = profile.id; state.connector.mapping = mapping; state.connector.candidate = ''; state.connector.detection = null;
      toast(sidecar ? 'Port-Map „' + name + '“ geladen. Belegung aus der Datei; die Kanalprüfung vergleicht sie mit der Messung.' : 'Zuordnung „' + (name || file.name) + '“ geladen.');
      persistSettings(); renderConnector();
    } catch (error) { toast(file.name + ' · ' + error.message); }
  }

  // Technical drawing of one side (thru) or of the part (pins). Generated from the profile, not a picture.
  function cnDrawing(p, side, portOf, verdict) {
    const xs = p.contacts.map(c => c.x), ys = p.contacts.map(c => c.y), pitch = p.measurement.kind === 'pins' ? 1 : 1;
    const W = 46, H = 40, pad = 24, sx = c => pad + (c.x - Math.min(...xs)) * W * pitch, sy = c => pad + 18 + (c.y - Math.min(...ys)) * H;
    const width = pad * 2 + (Math.max(...xs) - Math.min(...xs)) * W + 34, height = pad * 2 + 36 + (Math.max(...ys) - Math.min(...ys)) * H + 26;
    const pairOf = new Map(); p.pairs.forEach((pair, k) => { pairOf.set(pair.plus, [pair, '+', k]); pairOf.set(pair.minus, [pair, '−', k]); });
    const shapes = p.contacts.map(c => {
      const node = Connector.nodeId(c.id, side), port = portOf.get(node), sel = state.connector.selected === node, [pair, sign, k] = pairOf.get(c.id) || [];
      const color = pair ? 'var(--pair-' + (k % 8 + 1) + ', ' + PAIR_COLORS[k % PAIR_COLORS.length] + ')' : c.role === 'ground' ? 'var(--muted)' : c.role === 'power' ? '#b25f2c' : 'var(--ink-2, #555)';
      const state_ = port === undefined ? 'free' : verdict.get(node) || 'ok';
      const mark = { ok: '✓', unconfirmed: '?', conflict: '!', free: '' }[state_];
      return '<g class="cn-pin is-' + state_ + (sel ? ' is-selected' : '') + '" data-node="' + esc(node) + '" role="button" tabindex="0" aria-pressed="' + sel + '" aria-label="' + esc(c.id + ' ' + c.label + (side ? ', ' + cnSide(p, side) : '') + (port !== undefined ? ', Port ' + (port + 1) : lang() === 'en' ? ', not assigned' : ', nicht zugeordnet')) + '">' +
        '<rect x="' + (sx(c) - 17) + '" y="' + (sy(c) - 15) + '" width="34" height="30" rx="4" style="--pin:' + color + '"/>' +
        '<text class="cn-pin-id" x="' + sx(c) + '" y="' + (sy(c) - 2) + '">' + esc(c.id) + '</text>' +
        '<text class="cn-pin-port" x="' + sx(c) + '" y="' + (sy(c) + 10) + '">' + (port !== undefined ? 'P' + (port + 1) : '–') + '</text>' +
        (mark ? '<text class="cn-pin-mark" x="' + (sx(c) + 14) + '" y="' + (sy(c) - 9) + '">' + mark + '</text>' : '') +
        '<text class="cn-pin-label" x="' + sx(c) + '" y="' + (c.y > (Math.min(...ys) + Math.max(...ys)) / 2 || p.measurement.kind === 'pins' ? sy(c) + 27 : sy(c) - 21) + '">' + esc(c.label.replace(' · ', ' ').length > 14 ? c.label.replace(' · ', ' ').slice(0, 13) + '…' : c.label.replace(' · ', ' ')) + '<title>' + esc(c.label) + '</title></text></g>';
    }).join('');
    // differential pairs: a bracket between + and −
    const brackets = p.pairs.map((pair, k) => {
      const a = p.contacts.find(c => c.id === pair.plus), b = p.contacts.find(c => c.id === pair.minus);
      if (Math.abs(a.y - b.y) > 0.1 && p.measurement.kind !== 'pins') return '';
      const y = p.measurement.kind === 'pins' ? null : (a.y > (Math.min(...ys) + Math.max(...ys)) / 2 ? sy(a) + 36 : sy(a) - 34);
      if (y === null) return '<line class="cn-pair-line" x1="' + (sx(a) - 22) + '" y1="' + sy(a) + '" x2="' + (sx(b) - 22) + '" y2="' + sy(b) + '" style="--pin:' + PAIR_COLORS[k % PAIR_COLORS.length] + '"/>';
      return '<path class="cn-pair-line" d="M' + sx(a) + ' ' + y + 'H' + sx(b) + '" style="--pin:' + PAIR_COLORS[k % PAIR_COLORS.length] + '"/>';
    }).join('');
    const symbol = p.measurement.kind === 'pins' ? (() => {
      // transformer symbol between primary (x = 0) and secondary (x = 4) pins of each channel
      return p.pairs.filter(x => x.side === 'P').map(pp => {
        const a = p.contacts.find(c => c.id === pp.plus), b = p.contacts.find(c => c.id === pp.minus), x1 = sx(a) + 30, x2 = sx(a) + 4 * W - 30, top = sy(a), bot = sy(b);
        const coil = x => { let d = 'M' + x + ' ' + top; const n = 4, h = (bot - top) / n; for (let i = 0; i < n; i++) d += ' a' + (h / 2) + ' ' + (h / 2) + ' 0 0 ' + (x < x2 ? 1 : 0) + ' 0 ' + h; return '<path class="cn-coil" d="' + d + '"/>'; };
        return coil(x1) + coil(x2) + '<line class="cn-core" x1="' + ((x1 + x2) / 2 - 3) + '" y1="' + top + '" x2="' + ((x1 + x2) / 2 - 3) + '" y2="' + bot + '"/><line class="cn-core" x1="' + ((x1 + x2) / 2 + 3) + '" y1="' + top + '" x2="' + ((x1 + x2) / 2 + 3) + '" y2="' + bot + '"/>' +
          '<circle class="cn-dot" cx="' + (x1 + 8) + '" cy="' + (top + 4) + '" r="2.6"/><circle class="cn-dot" cx="' + (x2 - 8) + '" cy="' + (top + 4) + '" r="2.6"/>';
      }).join('');
    })() : '';
    const title = side ? cnSide(p, side) : cnT(p, 'view');
    return '<figure class="cn-figure"><figcaption>' + cnSpan(title) + '</figcaption><svg class="cn-svg" viewBox="0 0 ' + width + ' ' + height + '" style="max-width:' + Math.round(width * 1.35) + 'px;min-width:' + Math.min(560, Math.round(width)) + 'px" data-side="' + (side || 0) + '" role="group" data-no-i18n aria-label="' + esc(cnT(p, 'name') + ' · ' + title) + '">' +
      '<g class="cn-zoom" transform="translate(' + state.connector.pan[0] + ' ' + state.connector.pan[1] + ') scale(' + state.connector.zoom + ')">' +
      (p.measurement.kind === 'thru' ? '<rect class="cn-body" x="' + (pad - 26) + '" y="' + (pad - 10) + '" width="' + (width - 2 * pad + 52) + '" height="' + (height - 2 * pad + 22) + '" rx="12"/>' : '') +
      symbol + brackets + shapes + '</g></svg></figure>';
  }

  function cnVerdicts(p, mapping) {
    // ✓ the two sides of a contact are a measured conductor · ? not confirmed by the data · ! node or port assigned twice
    const out = new Map(), v = Connector.validateMapping(p, mapping), seen = new Map();
    mapping.ports.forEach((node, port) => { if (node) seen.set(node, (seen.get(node) || 0) + 1); });
    const det = state.connector.detection, thru = det?.thru ?? Connector.thruPaths(state.dataset);
    const partner = new Map(); thru.paths.forEach(x => { partner.set(x.a, x.b); partner.set(x.b, x.a); });
    // file profiles: + and − of a pair are confirmed when its channel shows transmission with the right polarity
    const fileState = new Map();
    if (p.status === 'file') for (const c of cnChecks(p, mapping)) {
      const verdictOf = c.polarity === 'ok' ? 'ok' : c.polarity === 'inverted' ? 'conflict' : 'unconfirmed';
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
    const key = p.id + '|' + mapping.ports.join(',');
    if (cnCheckCache.dataset !== state.dataset || cnCheckCache.key !== key) Object.assign(cnCheckCache, { dataset: state.dataset, key, rows: Connector.checkChannels(p, mapping, state.dataset) });
    return cnCheckCache.rows;
  }
  // Transmission and polarity per channel from the S-matrix of the current mapping (no limits, no pass/fail).
  function cnCheck(p) {
    const rows = cnChecks(p, state.connector.mapping);
    if (!rows.length) return '';
    const POL = { ok: ['ok', '✓ richtig gepolt'], inverted: ['bad', '! + und − an einem Ende vertauscht'], open: ['warn', '? Phase nicht eindeutig'], none: ['bad', 'kein Durchgang'] };
    return '<section class="config-card"><div class="config-head"><h2>Kanalprüfung</h2><p>Für jeden Kanal: größte differentielle Übertragung |SDD21| zwischen den Enden und die Polarität. Bewertet wird die Phase bei der tiefsten Frequenz, an der |SDD21| 90 % des Maximums erreicht: nahe 0° richtig gepolt, nahe 180° vertauscht. Das prüft die Zuordnung, nicht das Bauteil.</p></div><div class="config-content"><div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Enden</th><th scope="col">max. |SDD21|</th><th scope="col">Phase</th><th scope="col">bei</th><th scope="col">Polarität</th></tr></thead><tbody>' +
      rows.map(r => '<tr><th scope="row">' + cnSpan(r.channel) + (r.fromData ? ' <small>(aus der Messung verknüpft)</small>' : '') + '</th><td class="mono">' + cnSpan(r.from + ' → ' + r.to) + '</td><td class="mono">' + (r.maxDb > -200 ? r.maxDb.toFixed(2) + ' dB' : '–') + '</td><td class="mono">' + (Number.isFinite(r.phase) ? Math.round(r.phase) + '°' : '–') + '</td><td class="mono">' + (Number.isFinite(r.freq) ? esc(hz(r.freq)) : '–') + '</td><td><span class="cn-badge is-' + POL[r.polarity][0] + '">' + POL[r.polarity][1] + '</span></td></tr>').join('') +
      '</tbody></table></div></div></section>';
  }

  function cnMatrix() {
    const cn = state.connector, net = state.network, layout = state.layout;
    if (!net || !cn.channels.length) return '';
    const fs = state.dataset.freq, fi = Number.isInteger(cn.freq) && cn.freq < fs.length ? cn.freq : (state.markers[0] ?? Math.floor(fs.length / 2));
    const s = net.mm[fi];
    if (!s) return '';
    const modes = layout.mmModes.filter(m => m.type === 'D' || (cn.matrixModes === 'DC' && m.type === 'C'));
    const n = layout.mmModes.length, idx = mode => layout.mmModes.indexOf(mode);
    const chOf = id => cn.channels.find(c => c.id === id);
    const label = mode => { const c = chOf(mode.id); return mode.type + mode.id + (c ? ' · ' + c.pair + (c.side ? ' S' + c.side : '') : ''); };
    const endOf = c => c.end ?? c.side, chanOf = c => c.channel ?? c.pair;
    const KIND_EN = { Konversion: 'conversion', Kopplung: 'coupling' }, kindText = k => lang() === 'en' ? KIND_EN[k] || k : k;
    const kind = (r, c) => {
      const a = chOf(r.id), b = chOf(c.id);
      if (!a || !b) return '';
      // Labels from the mapping: the same channel end to end is insertion loss; between channels, the same end is NEXT and the other end FEXT.
      if (r === c) return 'RL';
      if (r.id === c.id) return 'Konversion';
      if (chanOf(a) === chanOf(b)) return r.type === c.type ? (endOf(a) === endOf(b) ? '' : 'IL') : 'Konversion';
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

  // Small SVG line chart for derived curves (crosstalk sums, time domain). Series: { name, color, x, y, dash }. Text bypasses i18n.
  function miniChart(series, { xLog = false, xFmt = v => String(v), yFmt = v => String(v), yLabel = '', xLabel = '', yRange = null, height = 260, label = '' } = {}) {
    const W = 760, H = height, L = 56, R = 12, T = 12, B = 34;
    const pts = series.flatMap(s => s.x.map((x, i) => [x, s.y[i]])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0));
    if (!pts.length) return '';
    const tx = v => xLog ? Math.log10(v) : v;
    let x0 = Math.min(...pts.map(p => tx(p[0]))), x1 = Math.max(...pts.map(p => tx(p[0])));
    let [y0, y1] = yRange || [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
    if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.05; if (!yRange) { y0 -= pad; y1 += pad; }
    if (x1 === x0) x1 = x0 + 1;
    const sx = v => L + (tx(v) - x0) / (x1 - x0) * (W - L - R), sy = v => T + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (H - T - B);
    const nice = (a, b, n) => { const step0 = (b - a) / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 5, 10].map(m => m * mag).find(m => m >= step0); const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * step; v += step) out.push(+v.toPrecision(12)); return out; };
    const xt = xLog ? Array.from({ length: Math.floor(x1) - Math.ceil(x0) + 1 }, (_, i) => 10 ** (Math.ceil(x0) + i)) : nice(x0, x1, 6), yt = nice(y0, y1, 5);
    const grid = xt.map(v => '<line class="grid" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="axis" x="' + sx(v) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + esc(xFmt(v)) + '</text>').join('') +
      yt.map(v => '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/><text class="axis" x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + esc(yFmt(v)) + '</text>').join('');
    const paths = series.map(s => {
      let d = '', pen = false;
      s.x.forEach((x, i) => { const y = s.y[i]; if (!Number.isFinite(x) || !Number.isFinite(y) || (xLog && !(x > 0))) { pen = false; return; } d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1); pen = true; });
      return '<path class="series" d="' + d + '" stroke="' + s.color + '"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
    }).join('');
    return '<figure class="mini-figure" data-no-i18n><svg class="mini-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + grid +
      '<text class="axis" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + esc(xLabel) + '</text><text class="axis" x="4" y="' + (T + 2) + '">' + esc(yLabel) + '</text>' + paths + '</svg>' +
      '<ul class="mini-legend">' + series.map(s => '<li><i' + (s.dash ? ' class="dashed"' : '') + ' style="--c:' + s.color + '"></i>' + esc(s.name) + '</li>').join('') + '</ul></figure>';
  }

