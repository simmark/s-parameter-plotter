  window.I18N.start();
  const $ = id => document.getElementById(id);
  document.querySelector('#lang-button .lang-code').textContent = window.I18N.lang === 'de' ? 'EN' : 'DE';
  document.getElementById('menu-lang-code').textContent = window.I18N.lang === 'de' ? 'EN' : 'DE';
  const LOCALE = window.I18N.locale;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const num = Plot.formatNumber, hz = Plot.formatFreq, parseHz = Plot.parseFreq;
  const portName = i => 'P' + (i + 1);
  const omega = f => RF.TAU * f;
  const disabled = value => value ? ' disabled' : '';
  const checked = value => value ? ' checked' : '';
  const pressed = value => ' aria-pressed="' + Boolean(value) + '"';
  const options = (items, selected) => items.map(([key, label]) =>
    '<option value="' + esc(key) + '"' + (String(key) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  // Mixed-mode colour families: differential blue, common mode green, conversion C→D (Sdc, immunity) amber,
  // conversion D→C (Scd, emission) crimson, single-ended ports violet. Reflections dashed, transmissions solid.
  const MODE_PALETTE = {
    dd: ['#1f5fd1', '#5b8ee6', '#163f8c', '#3d78dc', '#2a4fa8', '#86aaf0'],
    cc: ['#08875a', '#3fb07f', '#055e3e', '#21a06c', '#2c7a52', '#78c9a2'],
    dc: ['#e07b0f', '#b45f06', '#f2a23f', '#8a4705'],
    cd: ['#c62f4b', '#962036', '#e0687f', '#701628'],
    p: ['#7a4fc2', '#a07bdc', '#55348f', '#8d63cf', '#6a45a9', '#c1a5ea'],
    m0: ['#7a5a12', '#a9821f', '#5a420c'],
    mab: ['#1f6fb2', '#3d8fd1', '#14507f', '#5aa7e0'],
    mx: ['#b23a8e', '#d16ab0', '#7f2766']
  };
  const MODE_COLOR = { D: 'var(--mode-d)', C: 'var(--mode-c)', P: 'var(--mode-p)', Z: '#7a5a12', A: '#1f6fb2', B: '#1f6fb2' };
  const MODAL_TYPES = new Set(['Z', 'A', 'B']), MODAL_SYMBOL = { Z: '0', A: 'α', B: 'β', D: 'd', C: 'c' };
  const REFLECTION_DASH = [6, 4];

  function traceFamily(row, col) {
    if (MODAL_TYPES.has(row.type) || MODAL_TYPES.has(col.type)) {
      if (row.type === col.type) return row.type === 'Z' ? 'm0' : 'mab';
      return 'mx';
    }
    if (row.type === 'P' && col.type === 'P') return 'se';
    if (row.type === 'P' || col.type === 'P') return 'p';
    if (row.type !== col.type) return row.type === 'D' ? 'dc' : 'cd';
    return row.type === 'D' ? 'dd' : 'cc';
  }

  function modeMarkup(text) {
    return text.replace(/\b(D\d+)/g, '<b class="d">$1</b>').replace(/\b(C\d+)/g, '<b class="c">$1</b>');
  }

  // One colour per differential pair, used wherever ports appear (editor, table, schematic).
  const PAIR_COLORS = ['#3a9fbf', '#d98a0b', '#7b8a92', '#a8a21e', '#a06cc7', '#d0607a', '#4c9f70', '#5b6fd6', '#b5713a', '#2f8f9f', '#8f6bb0', '#c25555'];
  const pairColor = id => PAIR_COLORS[(Math.max(1, id) - 1) % PAIR_COLORS.length];

  const COLORS = ['#3266ce', '#008879', '#a26016', '#8a55b6', '#ca5260', '#4f842f', '#157eab', '#a04d7b', '#967234', '#5059a8', '#47616d', '#bb6235', '#007385', '#6b4d33', '#a32c63', '#6b7428'];
  const MAX_TRACES = COLORS.length;
  // "z" and "cispr" are two evaluation families inside the one main tab "Z"; settings saved with either key keep working.
  const TABS = { s: 'S-Parameter', ports: 'Ports & Lasten', connector: 'Connector', time: 'Zeitbereich', smith: 'Smith-Chart', z: 'Impedanz', cispr: 'CISPR 17', cmc: 'ESB-Modell' };
  const tabButton = tab => tab === 'cispr' ? 'z' : tab;
  const Z_EVALUATIONS = [
    ['z:reflection', 'Eingangsimpedanz · Reflexion Zᵢₙ'], ['z:zmatrix', 'Z-Matrix · Zᵢⱼ'], ['z:ymatrix', 'Y-Matrix · Yᵢⱼ'],
    ['z:txseries', 'Serienimpedanz · Transmission'], ['z:txshunt', 'Shuntimpedanz · Transmission'],
    ['cispr:one', 'CISPR 17 · Eintor · Reflexion'], ['cispr:series', 'CISPR 17 · Zweitor · Serie'], ['cispr:shunt', 'CISPR 17 · Zweitor · Shunt'], ['cispr:four', 'CISPR 17 · Vierport · CM / DM']
  ];
  const S_FORMATS = [
    ['db', 'Betrag · dB'], ['mag', 'Betrag · linear'], ['phase', 'Phase · ±180°'], ['unwrap', 'Phase · entfaltet'],
    ['re', 'Realteil'], ['im', 'Imaginärteil'], ['delay', 'Gruppenlaufzeit']
  ];
  const Z_FORMATS = [
    ['mag', 'Betrag |Z|'], ['re', 'Realteil · R / ESR'], ['im', 'Imaginärteil · X'], ['phase', 'Phase'],
    ['ls', 'L · Serie / ESL'], ['cs', 'C · Serie'], ['lp', 'L · Parallel'], ['cp', 'C · Parallel'], ['q', 'Güte Q = |X|/R']
  ];
  const Z_METHODS = [
    ['reflection', 'Reflexion · Zᵢₙ'], ['zmatrix', 'Z-Matrix · Zᵢⱼ'], ['ymatrix', 'Y-Matrix · Yᵢⱼ'],
    ['txseries', 'Transmission · Serie'], ['txshunt', 'Transmission · Shunt']
  ];
  const CISPR_METHODS = [
    ['four', 'Vierport · CM / DM'], ['series', 'Zweitor · Serie'], ['shunt', 'Zweitor · Shunt'], ['one', 'Eintor · Reflexion']
  ];
  const LOADS = [
    ['active', 'Aktiv'], ['match', 'Load Z₀'], ['open', 'Open'], ['short', 'Short'],
    ['resistor', 'R-Last'], ['complex', 'R + jX'], ['series', 'RLC-Serie'], ['parallel', 'RLC-Parallel']
  ];
  const EDITABLE_LOADS = ['resistor', 'complex', 'series', 'parallel'];
  const help = '<button class="quiet-button" type="button" data-action="method">Methodik ' + icon('chevron') + '</button>';
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const mobile = matchMedia('(max-width: 850px)');
  const coarse = matchMedia('(pointer: coarse)');
  // Defaults: impedances on a log axis; signed equivalent values (L, C) on the symmetric log axis so that sign changes and peaks show.
  const defaultAxes = tab => ({ x: 'log', xRange: null, y: ['z', 'cispr'].includes(tab) ? 'log' : tab === 'cmc' ? 'symlog' : 'linear', yRange: null });
  const Y_SCALES = ['log', 'symlog', 'linear'];
  const state = {
    dataset: null, config: null, layout: null, network: null, tab: 's', basis: 'mm',
    sFormat: 'db', sKeys: { se: null, mm: null }, smith: '',
    z: { method: 'reflection', format: 'mag', input: '', output: '' },
    cispr: { method: 'four', format: 'mag', input: '', output: '' },
    cmc: { format: 'cap', band: null }, pairIn: 1, pairOut: 2,
    esb: { model: 'auto', fixture: 'auto', tFormat: 'ocl', eFormat: 'z', input: '', output: '', evalFreq: 100e3 },
    axes: {}, markers: [0, null, null, null], activeMarker: 0,
    compare: { ids: [], delta: false }, profile: { name: '', source: 'default', score: null, matches: [], key: '' }, connector: null, time: null,
    viewMode: 0, hiddenTraces: new Set(), collapsed: mobile.matches, job: 0, importJob: 0,
    busy: false, error: '', memo: new Map(), view: null, dialogLoad: null, pairDraft: null, toastTimer: null
  };
  // The phone drawer starts closed before the first render, so it never flashes open while the app loads.
  $('app-layout').classList.toggle('sidebar-collapsed', state.collapsed);
  $('sidebar').inert = mobile.matches && state.collapsed;
  const axis = () => state.axes[state.tab] ??= defaultAxes(state.tab);
  // Log Y only for quantities that are positive by nature (|Z|, Q); signed quantities get the symmetric log axis instead,
  // so a log axis never drops negative values silently. dB and phase stay linear.
  function yScales() {
    const view = state.view;
    if (!view || view.smith) return ['linear'];
    if (view.signed) return ['symlog', 'linear'];
    return view.positive || view.format === 'mag' ? ['log', 'linear'] : ['linear'];
  }
  function effectiveY() {
    const allowed = yScales(), y = axis().y;
    if (allowed.includes(y)) return y;
    return y === 'log' && allowed.includes('symlog') ? 'symlog' : 'linear';
  }

  function numberValue(text) {
    const raw = String(text ?? '').trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw)) return NaN;
    return Number(raw.replace(',', '.'));
  }

  function display(value) {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '−∞';
    if (!Number.isFinite(value)) return '—';
    return num(value).replace(/^-/, '−');
  }

  function valueWith(value, unit) {
    return Number.isNaN(value) || value === undefined || value === null ? '—' : display(value) + (unit ? ' ' + unit : '');
  }

  function freqInput(value) {
    return Number.isFinite(value) ? Plot.formatFreq(value, true) : '';
  }

  function complexText(value, unit = '') {
    if (!value?.every(Number.isFinite)) return '—';
    const [re, im] = value;
    return display(re) + (im < 0 ? ' − j' : ' + j') + display(Math.abs(im)) + (unit ? ' ' + unit : '');
  }

  function traceValue(trace, index) {
    return index === null ? NaN : trace.values[index];
  }

  function complexAt(raw, index) {
    return raw && index !== null ? [raw[2 * index], raw[2 * index + 1]] : null;
  }

  function textField(label, name, value, placeholder = '', id = '') {
    return '<label class="control"><span>' + esc(label) + '</span><input class="field-input mono" type="text" name="' + esc(name) +
      '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" autocomplete="off" inputmode="text"' + (id ? ' id="' + esc(id) + '"' : '') + '></label>';
  }

  function selectField(label, action, items, value, narrow = false) {
    return '<label class="control' + (narrow ? ' narrow' : '') + '"><span>' + esc(label) +
      '</span><select id="control-' + action + '" data-change="' + action + '">' + options(items, value) + '</select></label>';
  }

  function actionButton(label, action, value = '', klass = 'button', image = '', attributes = '') {
    return '<button type="button" class="' + klass + '" data-action="' + action + '" data-value="' + esc(value) + '"' +
      attributes + '>' + (image ? icon(image) : '') + esc(label) + '</button>';
  }

  function iconButton(title, action, value, image, extra = '') {
    return actionButton('', action, value, 'icon-button', image, ' title="' + esc(title) + '" aria-label="' + esc(title) + '"' + extra);
  }

  function insertHtml(node, html) {
    const active = node.contains(document.activeElement) ? document.activeElement.id : '';
    node.innerHTML = html;
    if (active) $(active)?.focus({ preventScroll: true });
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { element.hidden = true; }, 4000);
  }

  function notice(id, text) {
    const element = $(id);
    element.textContent = text;
    element.hidden = !text;
  }

  function openDialog(id) {
    const d = $(id);
    if (!d.open) d.showModal();
  }

  function formError(form, message) {
    const target = form.querySelector('.form-error');
    target.textContent = message;
    target.hidden = !message;
  }

  const formErrorHtml = '<p class="inline-notice form-error" role="alert" hidden></p>';
  const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

  function initDataset(dataset, saved = null) {
    const pairs = dataset.profile?.pairs ?? dataset.sourcePairs;
    const config = {
      loads: RF.indices(dataset.n).map(() => ({ type: 'active' })),
      pairs: pairs.map((pair, i) => ({ ...pair, id: i + 1 })),
      ref: null
    };
    for (const tap of dataset.profile?.taps ?? []) config.loads[tap] = { type: 'open' };
    if (dataset.demo && dataset.n === 8) {
      config.loads[5] = { type: 'match' };
      config.loads[7] = { type: 'open' };
    }
    state.dataset = dataset;
    state.config = config;
    state.connector = cnBlank();
    state.time = tdBlank();
    state.pairDraft = null;
    state.basis = config.pairs.length ? 'mm' : 'se';
    state.sKeys = { se: null, mm: null };
    state.smith = '';
    state.z = { method: 'reflection', format: 'mag', input: '', output: '' };
    state.cispr = { method: 'four', format: 'mag', input: '', output: '' };
    const fs = dataset.freq;
    const start = fs[0] > 0 ? fs[0] : fs[1] ?? 0;
    const end = fs.at(-1);
    state.zFamily = 'z';
    state.cmc = { format: 'cap', band: dataset.demo ? [1e6, 100e6] : [start, end] };
    state.esb = { model: 'auto', fixture: 'auto', tFormat: 'ocl', eFormat: 'z', input: '', output: '', evalFreq: 100e3 };
    state.pairIn = config.pairs[0]?.id ?? 1;
    state.pairOut = config.pairs[1]?.id ?? 2;
    state.hiddenTraces.clear();
    state.axes = {};
    const target = dataset.demo ? 10e6 : Math.sqrt(start) * Math.sqrt(end);
    state.markers = [Plot.nearest(fs, target, true), null, null, null];
    state.activeMarker = 0;
    state.tab = 's';
    state.curveApply = true;
    if (saved) {
      try { applySettings(dataset, saved); } catch { /* ignore outdated settings */ }
    }
    notice('import-notice', dataset.warnings.join(' '));
    refreshNetwork();
  }

  async function refreshNetwork() {
    const id = ++state.job;
    const { dataset, config } = state;
    state.network = null;
    state.memo = new Map();
    state.error = '';
    if (config.triples?.length) {
      const taken = new Set(config.pairs.flatMap(p => [p.p, p.q])), keep = [];
      for (const t of config.triples) {
        const ports = [t.a, t.b, t.c];
        if (ports.some(p => taken.has(p) || config.loads[p]?.type !== 'active')) toast('Dreileitergruppe T' + t.id + ' aufgelöst: einer ihrer Ports ist jetzt anders belegt.');
        else { keep.push(t); ports.forEach(p => taken.add(p)); }
      }
      config.triples = keep.map((t, i) => ({ ...t, id: i + 1 }));
      if (!config.triples.length) delete config.triples;
    }
    try {
      state.layout = RF.prepareNetwork(dataset, config);
      if (!state.layout.active.length) throw new Error('Mindestens ein physischer Port muss aktiv bleiben.');
      if (!state.layout.hasMixed) state.basis = 'se';
      state.busy = true;
      render();
      await nextTick();
      const channels = state.connector?.channels?.length ? state.connector.channels : null;
      const network = await computeNetwork(dataset, config, state.layout, () => id === state.job, 'main', channels);
      if (!network || id !== state.job) return;
      state.network = network;
    } catch (error) {
      if (id !== state.job) return;
      state.error = error.message;
    }
    if (id !== state.job) return;
    state.busy = false;
    render();
    syncCompare();
  }

  function decodeText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  // Large files are parsed in a worker built from the same RF source, so the page stays responsive.
  let workerUrl = null;
  function parseInWorker(bytes, name) {
    workerUrl ??= URL.createObjectURL(new Blob([$('rf-core').textContent + `
      self.onmessage = event => {
        const { bytes, name } = event.data;
        try {
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch { text = new TextDecoder('windows-1252').decode(bytes); }
          const dataset = RF.parseTouchstone(text, name);
          self.postMessage({ dataset }, [dataset.freq.buffer, ...dataset.samples.map(s => s.buffer)]);
        } catch (error) {
          self.postMessage({ error: error.message });
        }
      };`], { type: 'text/javascript' }));
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(workerUrl); } catch (error) { reject(Object.assign(error, { fallback: true })); return; }
      worker.onmessage = event => {
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.dataset);
      };
      worker.onerror = event => {
        worker.terminate();
        event.preventDefault?.();
        reject(Object.assign(new Error(event.message || 'Worker-Fehler'), { fallback: true }));
      };
      worker.postMessage({ bytes, name }, [bytes]);
    });
  }

  // Long model fits run in a worker built from the same RF source, so the page stays responsive (a fit of a four-terminal
  // model takes seconds, on a phone longer). Only one fit runs at a time: a new one ends the previous worker. Without workers
  // (or if the worker fails to start) the call runs on the page as before.
  let jobUrl = null, jobWorker = null;
  function rfJob(name, args) {
    const direct = () => new Promise(resolve => setTimeout(() => resolve(RF[name](...args)), 30));
    if (typeof Worker !== 'function') return direct();
    jobUrl ??= URL.createObjectURL(new Blob([$('rf-core').textContent + `
      self.onmessage = event => {
        const { name, args } = event.data;
        try { self.postMessage({ result: RF[name](...args) }); }
        catch (error) { self.postMessage({ error: error.message }); }
      };`], { type: 'text/javascript' }));
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(jobUrl); } catch { direct().then(resolve, reject); return; }
      jobWorker?.terminate();
      jobWorker = worker;
      const done = () => { worker.terminate(); if (jobWorker === worker) jobWorker = null; };
      worker.onmessage = event => { done(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
      worker.onerror = event => { event.preventDefault?.(); done(); direct().then(resolve, reject); };
      worker.postMessage({ name, args });
    });
  }

  // Compute worker: network (all frequency points), crosstalk of applied channels and eye diagrams run off the page, built from
  // the same rf-core, td-core and connector-core source. Datasets are sent once and kept (the last three). A newer network job of
  // the same lane (current file, comparison) ends the older one at its next pause. Results are identical to the page path (same
  // code); if workers are missing or fail, everything runs on the page as before. window.SPA_NO_WORKER = true forces the page.
  const compute = { url: null, worker: null, ids: new WeakMap(), sent: new Set(), next: 1, jobs: new Map(), failed: false, stats: { worker: 0, page: 0 } };
  // local diagnostics for tests and the console (how many network jobs ran where); nothing leaves the browser
  window.SPA_COMPUTE_STATS = () => ({ ...compute.stats, failed: compute.failed, running: !!compute.worker });
  function computeWorker() {
    if (compute.failed || typeof Worker !== 'function' || window.SPA_NO_WORKER) return null;
    if (compute.worker) return compute.worker;
    compute.url ??= URL.createObjectURL(new Blob([$('rf-core').textContent, '\n', $('td-core').textContent, '\n', $('connector-core').textContent, `
      const sets = new Map(), latest = {};
      const pause = () => new Promise(resolve => setTimeout(resolve, 0));
      async function network(m) {
        const ds = sets.get(m.id);
        if (!ds) throw new Error('missing dataset');
        const layout = RF.prepareNetwork(ds, m.config), se = [], mm = [];
        let gaps = 0, start = performance.now();
        for (let i = 0; i < ds.freq.length; i++) {
          if ((i & 31) === 0 && performance.now() - start > 40) { await pause(); if (latest[m.lane] !== m.job) return null; start = performance.now(); }
          const [a, b] = RF.processPoint(ds, m.config, layout, i);
          se.push(a); mm.push(b); if (!a || !b) gaps++;
        }
        let xt = null;
        if (m.channels?.length) xt = Connector.crosstalk({ freq: ds.freq, mm, se, modes: layout.mmModes, active: layout.active, channels: m.channels });
        // one buffer per basis instead of one per point (thousands of transfers cost the page more than one copy here);
        // this also leaves the cached dataset intact (without loads a point is the dataset's own matrix)
        const pack = list => {
          const len = list.find(Boolean)?.length || 0, data = new Float64Array(len * list.length), mask = new Uint8Array(list.length);
          list.forEach((x, i) => { if (x) { data.set(x, i * len); mask[i] = 1; } });
          return { len, data, mask };
        };
        const se2 = pack(se), mm2 = mm.every((x, i) => x === se[i]) ? null : pack(mm);
        return { se: se2, mm: mm2, gaps, xt };
      }
      self.onmessage = async event => {
        const m = event.data;
        if (m.type === 'dataset') { sets.delete(m.id); sets.set(m.id, m.dataset); while (sets.size > 3) sets.delete(sets.keys().next().value); return; }
        try {
          if (m.type === 'network') {
            latest[m.lane] = m.job;
            const r = await network(m);
            if (!r) { self.postMessage({ job: m.job, cancelled: true }); return; }
            self.postMessage({ job: m.job, result: r }, [r.se.data.buffer, r.se.mask.buffer, ...(r.mm ? [r.mm.data.buffer, r.mm.mask.buffer] : [])]);
          } else if (m.type === 'eye') {
            const e = TD.eye(m.step, m.dt, m.opts);
            self.postMessage({ job: m.job, result: e }, [e.wave.buffer]);
          } else if (m.type === 'crosstalk') {
            self.postMessage({ job: m.job, result: Connector.crosstalk(m.args) });
          }
        } catch (error) { self.postMessage({ job: m.job, error: error.message, missing: error.message === 'missing dataset' }); }
      };`], { type: 'text/javascript' }));
    try { compute.worker = new Worker(compute.url); } catch { compute.failed = true; return null; }
    compute.worker.onmessage = event => {
      const { job, result, error, cancelled, missing } = event.data, pending = compute.jobs.get(job);
      if (!pending) return;
      compute.jobs.delete(job);
      if (cancelled) pending.resolve(null);
      else if (error) pending.reject(Object.assign(new Error(error), { missing }));
      else pending.resolve(result);
    };
    compute.worker.onerror = event => {
      event.preventDefault?.();
      compute.failed = true; compute.worker?.terminate(); compute.worker = null; compute.sent.clear();
      for (const pending of compute.jobs.values()) pending.reject(Object.assign(new Error('Worker-Fehler'), { fallback: true }));
      compute.jobs.clear();
    };
    return compute.worker;
  }
  function computeCall(message, transfer = []) {
    const worker = computeWorker();
    if (!worker) return null;
    const job = compute.next++;
    return new Promise((resolve, reject) => { compute.jobs.set(job, { resolve, reject }); worker.postMessage({ ...message, job }, transfer); });
  }
  function computeDataset(dataset) {
    let id = compute.ids.get(dataset);
    if (!id) { id = compute.next++; compute.ids.set(dataset, id); }
    if (!compute.sent.has(id)) {
      // a structured copy: the page keeps its dataset
      compute.worker.postMessage({ type: 'dataset', id, dataset: { n: dataset.n, freq: dataset.freq, samples: dataset.samples, refs: dataset.refs, name: dataset.name } });
      compute.sent.add(id);
      if (compute.sent.size > 3) compute.sent.delete(compute.sent.values().next().value);
    }
    return id;
  }
  async function networkInWorker(dataset, config, lane, channels) {
    if (!computeWorker()) return undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = computeDataset(dataset);
      try {
        const r = await computeCall({ type: 'network', id, config, lane, channels: channels?.length ? channels : null });
        if (r) compute.stats.worker++;
        return r;
      } catch (error) {
        if (error.missing) { compute.sent.delete(id); continue; }   // dropped from the worker's cache: send again
        if (error.fallback) return undefined;
        throw error;
      }
    }
    return undefined;
  }

  async function parseFile(file) {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 2 * 1024 * 1024 && typeof Worker === 'function') {
      try {
        return await parseInWorker(bytes.slice(0), file.name);
      } catch (error) {
        if (!error.fallback) throw error;
      }
    }
    return RF.parseTouchstone(decodeText(bytes), file.name);
  }

