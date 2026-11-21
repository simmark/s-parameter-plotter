  // ---- Batch: learn fingerprints from every profiled file of the loaded set, then recognise the rest with them. ----
  const batch = { running: false, cancel: false, rows: [], done: 0, total: 0, pass: '' };
  const BATCH_LABEL = { learned: 'Gelernt', known: 'Erkannt', unknown: 'Unbekannt', error: 'Fehler', wait: 'Wartet' };

  function openBatch() { renderBatch(); openDialog('batch-dialog'); }

  function renderBatch() {
    const box = $('batch-content');
    if (!box) return;
    const count = key => batch.rows.filter(r => r.status === key).length;
    const items = session.items.length;
    const rows = batch.rows.slice(0, 300).map(r => '<li class="batch-row is-' + r.status + '"><button type="button" class="batch-open" data-action="batch-file" data-value="' + esc(r.id) + '">' +
      '<span class="batch-state">' + esc(BATCH_LABEL[r.status] || r.status) + '</span><span class="batch-name">' + esc(r.name) + '</span><small>' + esc(r.detail + (r.physics ? tx(' · Physik: ', ' · physics: ') + r.physics : '')) + '</small></button></li>').join('');
    insertHtml(box,
      '<p class="note">Dateien mit gespeichertem Port-Profil (Paare, Abschlüsse, Bauteiltyp) liefern Fingerabdrücke. Alle anderen werden damit verglichen und, wenn sie passen, automatisch zugeordnet. ' +
      'Dateien ohne Profil und ohne passende Vorlage bleiben „Unbekannt“: Ordne bei einer davon die Ports zu und lerne sie als Vorlage, danach werden ähnliche erkannt.</p>' +
      '<div class="pack-actions">' + (batch.running ? actionButton('Abbrechen', 'batch-cancel', '', 'button') : actionButton(batch.rows.length ? 'Erneut starten' : items + ' Dateien analysieren', 'batch-run', '', 'button primary', 'network', disabled(items < 1))) +
      '<span class="batch-progress mono">' + (batch.running ? esc(batch.pass) + ' ' + batch.done + ' / ' + batch.total : batch.rows.length ? batch.rows.length + ' Dateien' : '') + '</span></div>' +
      (batch.rows.length ? '<p class="batch-summary">' + count('learned') + ' Fingerabdrücke gelernt · ' + count('known') + ' erkannt · ' + count('unknown') + ' unbekannt' +
        (count('error') ? ' · ' + count('error') + ' Fehler' : '') + '</p><ul class="batch-list">' + rows + '</ul>' : ''));
  }

  async function runBatch() {
    if (batch.running) return;
    const items = session.items.slice();
    Object.assign(batch, { running: true, cancel: false, rows: [], done: 0, total: items.length, pass: 'Lernen' });
    const rowOf = new Map(items.map(item => [item.id, { id: item.id, name: item.name, status: 'wait', detail: '' }]));
    batch.rows = [...rowOf.values()];
    renderBatch();
    const pending = [];
    const leaf = path => String(path || '').split('/').filter(Boolean).pop() || '';
    const step = async () => { batch.done++; if (batch.done % 3 === 0) { renderBatch(); await nextTick(); } };
    for (const item of items) {
      if (batch.cancel) break;
      const row = rowOf.get(item.id);
      try {
        const dataset = await loadDataset(item);
        const ph = physicsOf(dataset);
        row.physics = ph?.status === 'candidate' && ph.verdict.category && ph.verdict.level !== 'unklar' ? short(ph.verdict.category) + ' (' + level(ph.verdict.level) + ')' : ph?.status === 'candidate' ? level('unklar') : '';
        const embedded = settingsFromEmbedded(dataset);
        if (embedded && embedded.config.pairs.length) {
          const name = embedded.profileName || leaf(item.path) || dataset.n + '-Port';
          Templates.learn(name, dataset, embedded.config, { tab: 's', basis: 'mm', sFormat: embedded.sFormat || 'db', sKeys: { mm: embedded.sKeys?.mm ?? null } });
          Object.assign(row, { status: 'learned', detail: name + ' · ' + dataset.n + ' Ports' });
        } else pending.push(item);
      } catch (error) { Object.assign(row, { status: 'error', detail: error.message }); }
      await step();
    }
    batch.pass = 'Erkennen'; batch.done = 0; batch.total = pending.length;
    for (const item of pending) {
      if (batch.cancel) break;
      const row = rowOf.get(item.id);
      try {
        const dataset = await loadDataset(item);
        const matches = await Templates.match(dataset, () => !batch.cancel);
        const conflict = matches[0] && matches[0].score <= Templates.AUTO ? templateConflict(matches[0].tpl, physicsOf(dataset)) : null;
        if (matches[0] && matches[0].score <= Templates.AUTO && !conflict) Object.assign(row, { status: 'known', detail: matches[0].tpl.name + ' · ' + Templates.similarity(matches[0].score) + ' %' });
        else Object.assign(row, { status: 'unknown', detail: dataset.n + ' Ports' + (conflict ? tx(' · Vorlage ' + matches[0].tpl.name + ' gesperrt', ' · template ' + matches[0].tpl.name + ' blocked') : '') });
      } catch (error) { Object.assign(row, { status: 'error', detail: error.message }); }
      await step();
    }
    batch.running = false;
    renderBatch();
    if ($('pack-dialog').open) renderPacks();
    if (state.dataset) renderConfig();
    toast(batch.cancel ? 'Stapel abgebrochen.' : 'Stapel fertig: ' + batch.rows.filter(r => r.status === 'learned').length + ' gelernt · ' + batch.rows.filter(r => r.status === 'known').length + ' erkannt.');
  }

  async function packAction(kind) {
    try {
      if (kind === 'export') {
        saveBlob(new Blob([JSON.stringify(packData(), null, 1)], { type: 'application/json' }), 'S-Analyzer-Vorlagen-' + new Date().toISOString().slice(0, 10) + '.json');
      } else if (kind === 'import') {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
          const file = input.files[0];
          if (!file) return;
          try { applyPack(await file.text(), file.name); } catch (error) { toast(error.message); }
        });
        input.click();
      } else if (kind === 'reset') {
        Prefs.clear(); renderPacks(); renderTraces?.();
        toast('Gemerkte Kurvenwahl gelöscht.');
      } else if (kind === 'default') {
        const response = await fetch(new URL('fingerprints/default.json', location.href), { cache: 'no-cache' });
        if (!response.ok) throw new Error('Noch kein Standardpaket veröffentlicht. Lege fingerprints/default.json ins Repository oder lade eine Adresse.');
        applyPack(await response.text(), 'Standardpaket');
      }
    } catch (error) { toast(error.message || 'Das Paket konnte nicht geladen werden.'); }
  }

  function curvePreset(preset) {
    const modes = currentModes().filter(mode => preset !== 'modal-all' || mode.type !== 'P');
    let next = [];
    if (preset === 'default' || preset === 'basic') next = typeTraces(modes, false);
    if (preset === 'ext') next = typeTraces(modes, true);
    if (preset === 'reflect') next = modes.map(mode => traceKey(mode, mode));
    if (preset === 'all' || preset === 'modal-all') next = modes.flatMap(row => modes.map(col => traceKey(row, col)));
    if (preset === 'through' || preset === 'convert') {
      for (const [i, row] of modes.entries()) {
        for (const [j, col] of modes.entries()) {
          const through = preset === 'through' && i > j && row.type === col.type;
          const conversion = preset === 'convert' && row.type !== col.type && row.type !== 'P' && col.type !== 'P';
          if (through || conversion) next.push(traceKey(row, col));
        }
      }
    }
    if (next.length > MAX_TRACES) toast('Die ersten ' + MAX_TRACES + ' passenden Matrixelemente wurden gewählt.');
    state.sKeys[state.basis] = next.slice(0, MAX_TRACES);
    state.sKeys[state.basis].forEach(key => state.hiddenTraces.delete('s:' + state.basis + ':' + key));
    rememberCurves();
    if ($('matrix-dialog').open) renderMatrix();
    renderAnalysis();
  }

  function toggleTrace(key) {
    const trace = state.view?.traces.find(t => t.key === key);
    if (!trace) return;
    trace.visible = !trace.visible;
    if (trace.visible) state.hiddenTraces.delete(key);
    else state.hiddenTraces.add(key);
    rememberCurves();
    updatePlot();
    renderTraces();
    renderMarker(false);
    document.querySelectorAll('.trace-row').forEach(button => {
      if (button.dataset.value === key) button.focus({ preventScroll: true });
    });
  }

  function setYScale(value) {
    const a = axis();
    if (a.y === value) return;
    a.y = value;
    a.yRange = null;
    renderAnalysis();
  }

  function openAxes() {
    const a = axis();
    $('axes-content').innerHTML =
      '<div class="axis-group"><h3>Frequenzachse</h3>' +
      '<label class="control"><span>Skala</span><select name="x-scale">' +
      options(state.dataset.freq.at(-1) > 0 ? [['log', 'Logarithmisch'], ['linear', 'Linear']] : [['linear', 'Linear']], a.x) +
      '</select></label><div class="dialog-grid">' +
      textField('Von', 'x-start', a.xRange ? freqInput(a.xRange[0]) : '', 'Automatisch') +
      textField('Bis', 'x-stop', a.xRange ? freqInput(a.xRange[1]) : '', 'Automatisch') +
      '</div></div><div class="axis-group"><h3>Vertikale Achse</h3>' +
      '<label class="control"><span>Skala</span><select name="y-scale">' +
      options(yScales().map(key => [key, { linear: 'Linear', log: 'Logarithmisch · positive Werte', symlog: 'Symmetrisch logarithmisch · mit Vorzeichen' }[key]]), effectiveY()) +
      '</select></label><div class="dialog-grid">' +
      textField('Minimum ' + (state.view.unit ? '[' + state.view.unit + ']' : ''), 'y-start', a.yRange?.[0] ?? '', 'Automatisch') +
      textField('Maximum ' + (state.view.unit ? '[' + state.view.unit + ']' : ''), 'y-stop', a.yRange?.[1] ?? '', 'Automatisch') +
      '</div></div><p class="form-note">Leere Grenzwerte verwenden die automatische Skalierung. Frequenzen akzeptieren z. B. 20 MHz. Mit der Maus: Mausrad oder Ziehen auf der Y-Skala zoomt und verschiebt die vertikale Achse, Doppelklick dort setzt sie zurück. Am Touchscreen: Y-Skala links ziehen, zwei Finger übereinander zoomen, Doppeltippen auf die Skala setzt zurück.</p>' + formErrorHtml;
    openDialog('axes-dialog');
  }

  function applyAxes(form) {
    const data = new FormData(form), x = data.get('x-scale'), y = data.get('y-scale');
    const xa = data.get('x-start').trim(), xb = data.get('x-stop').trim();
    const ya = data.get('y-start').trim(), yb = data.get('y-stop').trim();
    const fs = state.dataset.freq;
    const min = x === 'log' && fs[0] === 0 ? fs[1] : fs[0], max = fs.at(-1);
    const xr = xa || xb ? [xa ? parseHz(xa) : min, xb ? parseHz(xb) : max] : null;
    const yr = ya || yb ? [numberValue(ya), numberValue(yb)] : null;
    if (xr && (!xr.every(Number.isFinite) || !(xr[1] > xr[0]) || xr[0] < 0 || (x === 'log' && xr[0] <= 0))) {
      formError(form, 'Gib einen aufsteigenden Frequenzbereich ein. Bei Log-Skalierung muss die untere Grenze positiv sein.');
      return;
    }
    if (yr && (!yr.every(Number.isFinite) || !(yr[1] > yr[0]) || (y === 'log' && yr[0] <= 0))) {
      formError(form, 'Gib zwei aufsteigende Y-Grenzen ein. Bei Log-Skalierung müssen beide positiv sein.');
      return;
    }
    Object.assign(axis(), { x, xRange: xr, y, yRange: yr });
    $('axes-dialog').close();
    renderAnalysis();
  }

  function setXScale(value) {
    const a = axis();
    if (a.x === value) return;
    a.x = value;
    if (value === 'log' && a.xRange?.[0] <= 0) a.xRange = null;
    renderAnalysis();
  }

  function resetPlot() {
    Object.assign(axis(), { xRange: null, yRange: null });
    renderAnalysis();
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

  function mayTerminate(port) {
    return state.config.loads[port].type !== 'active' || state.config.loads.some((load, i) => i !== port && load.type === 'active');
  }

  function openLoad(port, type) {
    if (!mayTerminate(port)) {
      toast('Mindestens ein physischer Port muss aktiv bleiben.');
      return;
    }
    const load = state.config.loads[port], d = state.dataset;
    state.dialogLoad = { port, type };
    const displayName = d.portNames[port] ? ' · ' + d.portNames[port] : '';
    $('load-subtitle').textContent = portName(port) + displayName + ' · ' + loadName({ type });
    let fields = textField('R [Ω]', 'r', load.r ?? d.refs[port], '0');
    if (type === 'complex') fields += textField('X [Ω]', 'x', load.x ?? 0, '0');
    if (type === 'series' || type === 'parallel') {
      fields += textField('L [nH]', 'l', load.l ? load.l * 1e9 : 0, '0') +
        textField('C [pF]', 'c', load.c ? load.c * 1e12 : 0, '0');
    }
    $('load-content').innerHTML = '<div class="dialog-grid">' + fields + '</div>' +
      (type === 'series' || type === 'parallel'
        ? '<p class="form-note">0 oder ein leeres Feld lässt das jeweilige Bauteil weg.</p>'
        : type === 'complex' ? '<p class="form-note">X bleibt über den Sweep konstant. Verwende für ein L oder C die RLC-Last.</p>' : '') +
      formErrorHtml;
    openDialog('load-dialog');
  }

  function applyLoad(form) {
    const { port, type } = state.dialogLoad;
    const data = new FormData(form);
    const read = name => {
      const text = data.get(name)?.trim();
      return text ? numberValue(text) : 0;
    };
    const r = read('r'), x = read('x'), l = read('l'), c = read('c');
    if (![r, x, l, c].every(Number.isFinite) || r < 0 || l < 0 || c < 0) {
      formError(form, 'R, L und C müssen nichtnegative Zahlen sein. X kann ein Vorzeichen haben.');
      return;
    }
    if (!mayTerminate(port)) {
      formError(form, 'Mindestens ein physischer Port muss aktiv bleiben.');
      return;
    }
    state.config.loads[port] = { type, r, x, l: l * 1e-9, c: c * 1e-12 };
    $('load-dialog').close();
    refreshNetwork();
  }

  function setLoadType(select) {
    const port = Number(select.dataset.port), type = select.value;
    if (type.startsWith('join:')) {
      const to = Number(type.slice(5)), now = state.config.loads[port];
      if (!mayTerminate(port)) {
        select.value = now.type === 'join' ? 'join:' + now.to : now.type;
        toast('Mindestens ein physischer Port muss aktiv bleiben.');
        return;
      }
      // Ports that were tied to this one follow to the common node.
      state.config.loads.forEach(load => { if (load.type === 'join' && load.to === port) load.to = to; });
      state.config.loads[port] = { type: 'join', to };
      refreshNetwork();
      return;
    }
    if (type !== 'active' && !mayTerminate(port)) {
      select.value = state.config.loads[port].type;
      toast('Mindestens ein physischer Port muss aktiv bleiben.');
      return;
    }
    if (EDITABLE_LOADS.includes(type)) {
      select.value = state.config.loads[port].type;
      openLoad(port, type);
    } else {
      state.config.loads[port] = { type };
      refreshNetwork();
    }
  }

  function applyFit(form) {
    const data = new FormData(form);
    const start = parseHz(data.get('start')), stop = parseHz(data.get('stop'));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || !(start > 0 && stop > start)) {
      toast('Gib ein positives, aufsteigendes Fit-Band ein.');
      return;
    }
    state.cmc.band = [start, stop];
    renderControls();
    renderAnalysis();
  }

  function setEvalFreq(f) {
    const fs = state.dataset.freq;
    if (!(f > 0) || f < fs[0] || f > fs.at(-1)) { toast('Wähle eine Frequenz innerhalb des Messbereichs.'); return; }
    state.esb.evalFreq = f;
    renderControls();
    renderAnalysis();
    toast('Auswertefrequenz ' + hz(f) + ' · OCL, n und k werden dort bestimmt');
  }

  function choosePair(which, id) {
    const other = which === 'pairIn' ? 'pairOut' : 'pairIn';
    if (state[other] === id) state[other] = state[which];
    state[which] = id;
  }

  function chooseMode(settings, field, value, distinct) {
    const other = field === 'input' ? 'output' : 'input';
    if (distinct && settings[other] === value) settings[other] = settings[field];
    settings[field] = value;
  }

  function handleSelect(select) {
    const key = select.dataset.change, value = select.value;
    if (key === 'model-sections') { modelSections(Number(value)); return; }
    if (key === 'load-type') {
      setLoadType(select);
      return;
    }
    if (['s-format', 'z-format', 'cispr-format', 'cmc-format'].includes(key)) axis().yRange = null;
    switch (key) {
      case 's-format': state.sFormat = value; break;
      case 'smith-port': state.smith = value; break;
      case 'z-eval': {
        const [family, method] = value.split(':');
        if (family === 'cispr') state.cispr.method = method;
        else {
          state.z.method = method;
          if (method === 'ymatrix' && !Z_FORMATS.slice(0, 4).some(([f]) => f === state.z.format)) state.z.format = 'mag';
        }
        state.tab = state.zFamily = family;
        axis().yRange = null;
        break;
      }
      case 'z-method':
        state.z.method = value;
        if (value === 'ymatrix' && !Z_FORMATS.slice(0, 4).some(([f]) => f === state.z.format)) state.z.format = 'mag';
        axis().yRange = null;
        break;
      case 'z-input': chooseMode(state.z, 'input', value, state.z.method.startsWith('tx')); break;
      case 'z-output': chooseMode(state.z, 'output', value, state.z.method.startsWith('tx')); break;
      case 'z-format': state.z.format = value; break;
      case 'cispr-method': state.cispr.method = value; break;
      case 'cispr-input': chooseMode(state.cispr, 'input', value, state.cispr.method !== 'one'); break;
      case 'cispr-output': chooseMode(state.cispr, 'output', value, state.cispr.method !== 'one'); break;
      case 'cispr-format': state.cispr.format = value; break;
      case 'cmc-format': state.cmc.format = value; break;
      case 'esb-model': state.esb.model = value; axis().yRange = null; break;
      case 'esb-fixture': state.esb.fixture = value; axis().yRange = null; break;
      case 'esb-tformat': state.esb.tFormat = value; axis().yRange = null; break;
      case 'esb-eformat': state.esb.eFormat = value; axis().yRange = null; break;
      case 'esb-input': chooseMode(state.esb, 'input', value, true); break;
      case 'esb-output': chooseMode(state.esb, 'output', value, true); break;
      case 'pair-in': choosePair('pairIn', Number(value)); break;
      case 'pair-out': choosePair('pairOut', Number(value)); break;
      default: return;
    }
    renderMain();
  }

  function exportDialog() {
    const canExport = !!state.network && state.network.gaps < state.dataset.freq.length;
    const hasPlot = !!state.view?.traces.some(t => t.visible);
    const items = [
      ['csv', 'Kurven als CSV', 'Alle Frequenzen der sichtbaren Kurven · Komma-getrennt, Dezimalpunkt', !hasPlot],
      ['csv-de', 'Kurven als CSV für Excel (DE)', 'Semikolon-getrennt, Dezimalkomma · öffnet direkt in deutschem Excel', !hasPlot],
      ['png', 'Diagramm als PNG', 'Aktuelle Ansicht mit Achsen und Markern', !hasPlot],
      ['touchstone', 'Netzwerk als Touchstone', 'Reduzierte S-Matrix · ' + (state.basis === 'mm' ? 'Mixed Mode' : 'Single Ended') + ' · .ts', !canExport]
    ];
    $('export-content').innerHTML = items.map(([kind, title, subtitle, off]) =>
      '<button class="export-item" type="button" data-action="download" data-value="' + kind + '"' + disabled(off) + '>' +
      icon('export') + '<span><strong>' + esc(title) + '</strong><small>' + esc(subtitle) + '</small></span></button>').join('') +
      (canShareFiles() ? '<label class="checkbox-line share-line"><input type="checkbox" id="export-share"' + checked(shareExports()) +
        '> Über das Teilen-Menü senden (Mail, Drive, Messenger …)</label>' : '');
    openDialog('export-dialog');
  }

  function canShareFiles() {
    try {
      return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
    } catch { return false; }
  }

  function shareExports() {
    try {
      const saved = localStorage.getItem('spa-share-exports');
      return saved === null ? coarse.matches : saved === '1';
    } catch { return coarse.matches; }
  }

  function csvText(german = false) {
    const view = state.view, fs = state.dataset.freq;
    const separator = german ? ';' : ',';
    const decimal = german ? value => value.replace('.', ',') : value => value;
    const traces = view.traces.filter(trace => trace.visible);
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const scalar = value => {
      if (value === -Infinity) return '-Inf';
      if (value === Infinity) return 'Inf';
      return Number.isFinite(value) ? decimal(String(value)) : '';
    };
    const heads = ['Frequenz_Hz'];
    traces.forEach(t => {
      heads.push(t.label + (view.unit ? '_' + view.unit : '_Wert'));
      if (t.complex) {
        const native = view.native ? '_' + view.native : '';
        heads.push(t.label + '_Re' + native, t.label + '_Im' + native);
      }
      if (view.smith) heads.push(t.label + '_Zin_Re_Ω', t.label + '_Zin_Im_Ω');
    });
    const rows = [heads.map(h => quote(window.I18N.t(h))).join(separator)];
    for (let i = 0; i < fs.length; i++) {
      const line = [scalar(fs[i])];
      for (const t of traces) {
        line.push(scalar(t.values[i]));
        const raw = complexAt(t.complex, i);
        if (raw) line.push(scalar(raw[0]), scalar(raw[1]));
        if (view.smith) {
          const z = raw?.every(Number.isFinite) && RF.reflection(raw, view.smithRef);
          line.push(scalar(z?.[0]), scalar(z?.[1]));
        }
      }
      rows.push(line.join(separator));
    }
    return (german ? '\uFEFF' : '') + rows.join('\r\n') + '\r\n';
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function download(value) {
    const base = state.dataset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 85) || 'Netzwerk';
    const suffix = state.tab === 's' ? 'S-Parameter' : TABS[state.tab].replaceAll(' ', '-');
    try {
      let blob, name;
      if (value === 'csv' || value === 'csv-de') {
        blob = new Blob([csvText(value === 'csv-de')], { type: 'text/csv;charset=utf-8' });
        name = base + '-' + suffix + (value === 'csv-de' ? '-Excel' : '') + '.csv';
      } else if (value === 'png') {
        blob = await Plot.image(state.view.title, state.dataset.name + ' · ' + state.view.caption);
        name = base + '-' + suffix + '.png';
      } else {
        blob = new Blob([RF.exportTouchstone(state.dataset, state.network, state.basis)], { type: 'text/plain;charset=utf-8' });
        name = base + '-' + (state.basis === 'mm' ? 'Mixed-Mode' : 'Single-Ended') + '.ts';
      }
      if (!blob) throw new Error('Das Diagramm ist für den Bildexport nicht verfügbar.');
      const shareBox = $('export-share');
      if (shareBox) {
        try { localStorage.setItem('spa-share-exports', shareBox.checked ? '1' : '0'); } catch {}
      }
      if (shareBox?.checked) {
        const file = new File([blob], name, { type: blob.type.split(';')[0] || 'application/octet-stream' });
        try {
          await navigator.share({ files: [file], title: name });
          $('export-dialog').close();
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
          // Some share targets reject a file type; the download keeps working.
        }
      }
      saveBlob(blob, name);
      $('export-dialog').close();
      toast(name + ' gespeichert.');
    } catch (error) {
      $('export-dialog').close();
      toast(error.message);
    }
  }

  const actions = {
    demo: value => loadDemo(Number(value)),
    'open-file': () => { const input = $('file-input'); input.removeAttribute('accept'); input.click(); },
    tab: setTab,
    basis: setBasis,
    'x-scale': setXScale,
    'y-scale': setYScale,
    axes: openAxes,
    'reset-plot': resetPlot,
    matrix: pickCurves,
    'select-curve': selectCurve,
    'curve-preset': curvePreset,
    packs: openPacks,
    'batch-open': () => { $('pack-dialog').open && $('pack-dialog').close(); openBatch(); },
    'batch-run': runBatch,
    'batch-cancel': () => { batch.cancel = true; },
    'batch-file': value => { $('batch-dialog').close(); openItem(value, { keepTab: true }); },
    'pack-export': () => packAction('export'),
    'pack-import': () => packAction('import'),
    'pack-reset': () => packAction('reset'),
    'pack-default': () => packAction('default'),
    'toggle-trace': toggleTrace,
    'active-marker': value => switchMarker(Number(value)),
    'add-marker': addMarker,
    'remove-marker': removeMarker,
    peak: peakSearch,
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
    'cn-detect': cnDetect,
    'cn-clear': () => { state.connector.mapping = Connector.emptyMapping(cnProfile(), state.dataset.n); state.connector.candidate = ''; persistSettings(); renderConnector(); },
    'cn-transform': cnTransform,
    'cn-candidate': cnUseCandidate,
    'cn-swap': value => { const [pair, side] = String(value).split('|'); cnSwapPair(pair, '', side ? Number(side) : null); },
    'cn-zoom': value => { const cn = state.connector; cn.zoom = value === 'reset' ? 1 : Math.max(0.5, Math.min(4, cn.zoom * (value === 'in' ? 1.25 : 0.8))); if (value === 'reset') cn.pan = [0, 0]; renderConnector(); },
    'cn-save': cnSaveTemplate,
    'cn-export': cnExport,
    'cn-import': () => $('cn-file').click(),
    'cn-curves': value => cnOpenCurves(value.split(',')),
    'cn-cell': value => cnOpenCurves([value]),
    'pairz-preset': pairImpedancePreset,
    'reset-ref': () => { state.config.ref = null; refreshNetwork(); },
    'edit-load': value => openLoad(Number(value), state.config.loads[Number(value)].type),
    'close-dialog': (_, button) => button.closest('dialog').close(),
    lang: () => window.I18N.set(window.I18N.lang === 'de' ? 'en' : 'de'),
    'toggle-sidebar': () => {
      state.collapsed = !state.collapsed;
      renderSidebar();
      // The drawer lies over the page; only the desktop sidebar needs the page scrolled to its top.
      if (!state.collapsed && !mobile.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
      if (!state.collapsed && mobile.matches) $('drawer-close').focus({ preventScroll: true });
    },
    'drawer-close': closeDrawer,
    'open-zip': () => { const input = $('file-input'); input.accept = '.zip,application/zip,application/x-zip-compressed'; input.click(); },
    'open-folder': () => openFolder(),
    'open-siblings': () => openFolder(sessionItem(session.current)?.handle),
    'session-open': value => openItem(value, { keepTab: true }),
    'session-select': () => { session.selecting = !session.selecting; if (!session.selecting) session.picked.clear(); renderSession(); renderShelf(); },
    'notice-dismiss': dismissNotice,
    'store-cancel': () => Progress.cancel(),
    'store-conflict': value => Progress.answer(value),
    'store-close': () => Progress.close(),
    'store-retry': () => Progress.retry(),
    storage: openStorage,
    'storage-test': storageTest,
    'storage-persist': async () => { const ok = await Store.requestPersist(); toast(ok ? 'Der Browser hat die dauerhafte Speicherung gewährt.' : 'Der Browser hat die dauerhafte Speicherung nicht gewährt. Die Daten bleiben trotzdem gespeichert, solange der Browser sie nicht bereinigt.'); openStorage(); },
    'backup-export': backupExport,
    'backup-import': () => $('backup-input').click(),
    license: () => openDialog('license-dialog'),
    'session-step': stepSession,
    'session-compare': toggleCompare,
    'session-clear': clearSession,
    'compare-delta': () => { state.compare.delta = !state.compare.delta; renderMain(); },
    'compare-clear': () => { state.compare.ids = []; state.compare.delta = false; renderSession(); syncCompare(true); },
    'learn-template': () => learnTemplate(),
    'view-mode': () => setViewMode((state.viewMode + 1) % 3),
    'shelf-add': () => { shelf.form = true; if (state.collapsed) { state.collapsed = false; renderSidebar(); } renderShelf(); },
    'shelf-cancel': () => { shelf.form = false; renderShelf(); },
    'lib-toggle': value => { shelf.open.has(value) ? shelf.open.delete(value) : shelf.open.add(value); renderShelf(); },
    'lib-open-folder': value => libraryOpen(value, true),
    'lib-open-file': value => libraryOpen(value, false),
    'lib-ask': value => { shelf.confirm = value; shelf.edit = ''; renderShelf(); },
    'lib-edit': value => { shelf.edit = shelf.edit === value ? '' : value; shelf.confirm = ''; renderShelf(); },
    'lib-delete': libraryDelete,
    'lib-new': () => { shelf.naming = !shelf.naming; renderShelf(); },
    'esb-spice': exportModel,
    'eval-marker': () => { const i = state.markers[state.activeMarker]; if (i === null || i === undefined) { toast('Setze zuerst einen Marker auf die Messkurve.'); return; } setEvalFreq(state.dataset.freq[i]); },
    'schematic-zoom': value => { $(value)?.querySelector('.schematic-box')?.classList.toggle('is-zoomed'); },
    'model-fit': modelFit,
    'model-reset': modelReset, 'model-sections-check': modelSectionsCheck,
    'model-window': modelWindow,
    'model-marker': modelFromMarker,
    theme: () => { Theme.toggle(); render(); },
    'menu-toggle': () => toggleMenu(),
    'menu-go': value => {
      toggleMenu(false);
      if (value === 'files') actions['toggle-sidebar']();
      else if (value === 'lang') actions.lang();
      else if (value === 'packs') openPacks();
      else if (value === 'storage') openStorage();
      else if (value === 'license') openDialog('license-dialog');
      else if (value === 'method') $('method-button').click();
      else if (value === 'export') $('export-button').click();
      else if (value === 'install') $('pwa-install').click();
    },
    'match-templates': findTemplates,
    'apply-template': applyTemplate,
    'physics-apply': applyPhysicsMapping,
    'delete-template': value => { Templates.remove(value); state.profile.matches = state.profile.matches.filter(m => m.tpl.n + '|' + m.tpl.name !== value); renderConfig(); },
    method: () => openDialog('method-dialog'),
    download
  };

  function toggleMenu(force) {
    const menu = $('settings-menu'), button = $('settings-button');
    const open = typeof force === 'boolean' ? force : menu.hidden;
    if (open) $('menu-install').hidden = $('pwa-install').hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu-item:not([hidden])')?.focus({ preventScroll: true });
  }
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'pack-url-form') return;
    event.preventDefault();
    const value = $('pack-url').value.trim();
    if (!value) return;
    try { await packFromUrl(value); } catch (error) { toast(error.message || 'Das Paket konnte nicht geladen werden.'); }
  });
  document.addEventListener('pointerdown', event => {
    if (!$('settings-menu').hidden && !event.target.closest('#settings-menu, #settings-button')) toggleMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('settings-menu').hidden) { toggleMenu(false); $('settings-button').focus(); }
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (target && !target.disabled) actions[target.dataset.action]?.(target.dataset.value, target);
  });
  document.addEventListener('change', event => {
    const element = event.target;
    if (element.matches('select[data-change]')) handleSelect(element);
    if (element.matches('input[id^="marker-"]')) enterMarker(element);
  });

  document.addEventListener('submit', event => {
    const handler = {
      'pair-form': savePair, 'triple-form': saveTriple, 'td-form': tdApply, 'eye-form': tdEyeApply, 'profile-form': saveProfile, 'cn-apply-form': cnApply, 'sweep-form': applySweep, 'shelf-form': shelfStore, 'lib-new-form': libraryCreate, 'lib-edit-form': libraryEdit, 'model-form': modelApply, 'eval-form': form => setEvalFreq(parseHz(new FormData(form).get('eval'))), 'pairz-form': applyPairImpedance, 'reference-form': applyReference, 'fit-form': applyFit, 'axes-form': applyAxes, 'load-form': applyLoad
    }[event.target.id];
    if (!handler) return;
    event.preventDefault();
    handler(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input[id^="marker-"]')) {
      event.preventDefault();
      enterMarker(event.target);
      return;
    }
    if (['PageDown', 'PageUp'].includes(event.key) && session.items.length > 1 && !event.target.closest('input, select, textarea, dialog') && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      stepSession(event.key === 'PageDown' ? 1 : -1);
      return;
    }
    if (['ArrowLeft', 'ArrowRight'].includes(event.key) && session.items.length > 1 && !event.altKey && !event.ctrlKey && !event.metaKey &&
      !event.target.closest('input, select, textarea, dialog, [role="tab"], summary') && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      stepSession(event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setTab(tabs[next].dataset.value);
    tabs[next].focus();
  });

  $('sidebar-button').addEventListener('click', () => { state.collapsed = !state.collapsed; renderSidebar(); });
  $('method-button').addEventListener('click', () => openDialog('method-dialog'));
  $('export-button').addEventListener('click', exportDialog);
  $('dropzone').addEventListener('click', () => actions['open-file']());
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  if (history.state?.spaDrawer) history.replaceState(null, '');
  window.addEventListener('popstate', () => {
    drawerSync = false;
    if (mobile.matches && !state.collapsed && !history.state?.spaDrawer) closeDrawer();
  });
  mobile.addEventListener('change', () => { state.collapsed = mobile.matches; renderSidebar(); if (state.dataset) renderMain(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && !state.collapsed && !document.querySelector('dialog[open]')) closeDrawer();
  });
  // Swipe to the left closes the drawer; vertical movement keeps scrolling its content.
  let drawerTouch = null;
  $('sidebar').addEventListener('touchstart', event => {
    drawerTouch = mobile.matches && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  $('sidebar').addEventListener('touchmove', event => {
    if (!drawerTouch) return;
    const dx = event.touches[0].clientX - drawerTouch.x, dy = event.touches[0].clientY - drawerTouch.y;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) drawerTouch = null;
    else if (dx < -56 && Math.abs(dx) > 2 * Math.abs(dy)) { drawerTouch = null; closeDrawer(); }
  }, { passive: true });
  $('sidebar').addEventListener('touchend', () => { drawerTouch = null; }, { passive: true });
  $('file-input').addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) ingest(await expandFiles(files));
  });
  $('folder-input').addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) ingest(await expandFiles(files, true), { kind: 'folder', name: (files[0].webkitRelativePath || '').split('/')[0] });
  });
  $('backup-input').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) backupImport(file);
  });
  $('store-dialog').addEventListener('cancel', event => { if (!Progress.closable()) event.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSettings(); });
  window.addEventListener('pagehide', flushSettings);
  // In the plot the arrow keys step through the files; Shift + arrow moves the marker.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.viewMode && !document.querySelector('dialog[open]')) { setViewMode(0); return; }
    if (event.target.id !== 'plot' || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.shiftKey || session.items.length < 2) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    stepSession(event.key === 'ArrowRight' ? 1 : -1);
  }, true);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.viewMode > 1) setViewMode(1); });
  document.addEventListener('input', event => {
    if (event.target.id === 'lib-query') { shelf.query = event.target.value; renderShelf(); return; }
    if (event.target.id !== 'session-filter') return;
    session.filter = event.target.value;
    renderSession();
  });
  document.addEventListener('input', event => { if (event.target.matches('.model-slider')) modelSlide(event.target, false); });
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
    if (el.matches('.model-slider')) { modelSlide(el, true); return; }
    if (el.id === 'cn-profile') { cnSetProfile(el.value); return; }
    if (el.id === 'cn-config') { state.connector.configuration = el.value; persistSettings(); renderConnector(); return; }
    if (el.id === 'cn-port') { cnAssign(state.connector.selected, Number(el.value)); return; }
    if (el.id === 'cn-move') { if (el.value) cnSwapPair(Connector.profile(state.connector.profile).pairs.find(x => x.plus === Connector.splitNode(state.connector.selected).contact || x.minus === Connector.splitNode(state.connector.selected).contact)?.id, el.value); return; }
    if (el.matches('select.cn-node')) { const port = Number(el.dataset.port), m = state.connector.mapping; if (el.value) cnAssign(el.value, port); else { m.ports[port] = null; m.source[port] = ''; persistSettings(); renderConnector(); } return; }
    if (el.id === 'cn-template') { if (el.value !== '') cnUseTemplate(el.value); return; }
    if (el.id === 'cn-modes') { state.connector.matrixModes = el.value; renderConnector(); return; }
    if (el.id === 'cn-xt-channel') { state.connector.xtChannel = el.value; renderConnector(); return; }
    if (el.id === 'cn-file') { const file = el.files?.[0]; el.value = ''; if (file) cnImport(file); return; }
    if (el.matches('.model-fix input')) {
      const em = currentElement(), key = el.name.slice(4);
      if (em) { em.edit.fixed = el.checked ? [...new Set([...em.edit.fixed, key])] : em.edit.fixed.filter(k => k !== key); persistSettings(); }
      return;
    }
    if (el.matches('.session-pick input')) {
      el.checked ? session.picked.add(el.value) : session.picked.delete(el.value);
      renderShelf();
    } else if (el.id === 'lib-select') { shelf.libId = el.value; shelf.confirm = ''; shelf.edit = ''; shelf.open.clear(); renderShelf(); }
    else if (el.id === 'lib-ports') { shelf.ports = el.value; renderShelf(); }
    else if (el.id === 'lib-type') { shelf.type = el.value; renderShelf(); }
    else if (el.id === 'lib-sort') { shelf.sort = el.value; renderShelf(); }
    else if (el.id === 'shelf-scope') shelfSuggest(el.form);
  });
  document.addEventListener('input', event => { if (event.target.name === 'folder' && event.target.form?.id === 'shelf-form') event.target.dataset.touched = '1'; });
  window.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    $('dropzone').classList.add('is-dragging');
  });
  window.addEventListener('dragleave', event => {
    if (!event.relatedTarget) $('dropzone').classList.remove('is-dragging');
  });
  window.addEventListener('drop', event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    $('dropzone').classList.remove('is-dragging');
    sourcesFromDrop(event.dataTransfer).then(bag => ingest(bag));
  });

  boot();
