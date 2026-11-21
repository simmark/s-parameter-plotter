  // ---- Session: several files at once, folders and ZIP archives, quick stepping and comparison. ----
  const SPICE_NAME = /\.(?:lib|sub|cir|mod|spi|sp)$/i;
  const TOUCHSTONE_NAME = /\.(?:s\d+p|ts|snp|lib|sub|cir|mod|spi|sp)$/i, ZIP_NAME = /\.zip$/i;
  const MAX_SESSION = 1000, MAX_COMPARE = 6, KEEP_PARSED = 6;
  const FILE_COLORS = ['#c4622d', '#3266ce', '#008879', '#8a55b6', '#a26016', '#ca5260'];
  const FILE_DASH = [[7, 3], [2, 3], [9, 3, 2, 3], [12, 4], [4, 2], [1, 2]];
  const session = { items: [], current: null, seq: 0, filter: '', parsed: [], selecting: false, picked: new Set(), notices: [] };
  const compareCache = new Map();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sessionItem = id => session.items.find(item => item.id === id);
  const blankProfile = () => ({ name: '', source: 'default', score: null, matches: [], key: '', blocked: null });
  const configKey = () => JSON.stringify(state.config);
  // A descriptor is a file on its way into the store: { path, name, size, read() }.
  const descKey = desc => (desc.path ? desc.path + '/' : '') + desc.name;
  const fileDesc = (file, path = '') => ({ path, name: file.name, size: file.size, read: async () => file });
  const handleDesc = (handle, path = '') => ({ path, name: handle.name, size: null, handle, read: () => handle.getFile() });
  // Sources feed the session list. Stored ones read from the durable store; volatile ones only live in memory.
  const entrySource = (entry, handle = null) => ({
    name: entry.name, path: entry.path, size: entry.size, handle, entryId: entry.id, importId: entry.importId, pack: entry.source || '',
    filePath: entry.path, fileName: entry.name, saved: entry.settings ?? null, subs: entry.subs ?? null, volatile: false,
    getFile: async () => Store.fileOf(await Store.entry(entry.id) ?? entry)
  });
  const volatileSource = desc => ({
    name: desc.name, path: desc.path, size: desc.size ?? null, handle: desc.handle ?? null, entryId: null, importId: null, pack: '',
    filePath: desc.path, fileName: desc.name, saved: null, subs: null, volatile: true,
    getFile: async () => { const data = await desc.read(); return new File([data], desc.name); }
  });

  function addItems(sources) {
    const added = [];
    for (const source of sources) {
      const key = (source.path ? source.path + '/' : '') + source.name;
      let item = session.items.find(existing => existing.key === key);
      if (item) {
        Object.assign(item, source, { dataset: null, error: '' });
        compareCache.delete(item.id);
      } else {
        if (session.items.length >= MAX_SESSION) break;
        item = { id: 'f' + (++session.seq), key, ports: Number(source.name.match(/\.s(\d+)p$/i)?.[1]) || null,
          dataset: null, settings: source.saved ?? null, profile: source.saved ? { ...blankProfile(), source: 'local', name: source.saved.profileName || '' } : null, error: '', ...source };
        session.items.push(item);
      }
      added.push(item);
    }
    session.items.sort((a, b) => collator.compare(a.path, b.path) || collator.compare(a.name, b.name));
    return added;
  }

  function keepParsed(item) {
    session.parsed = [item.id, ...session.parsed.filter(id => id !== item.id)];
    for (const id of session.parsed.slice(KEEP_PARSED)) {
      if (id === session.current || state.compare.ids.includes(id)) continue;
      const old = sessionItem(id);
      if (old) old.dataset = null;
    }
    session.parsed = session.parsed.filter(id => sessionItem(id)?.dataset);
  }

  async function loadDataset(item) {
    if (!item.dataset && item.make) {
      item.dataset = item.make();
      item.dataset.name = item.name;
      item.ports = item.dataset.n;
      item.error = '';
    }
    if (!item.dataset) {
      const file = await item.getFile();
      if (file.size > 100 * 1024 * 1024) throw new Error('Die Datei überschreitet 100 MiB.');
      item.size = file.size;
      item.dataset = await parseFile(file.name === item.name ? file : new File([file], item.name));
      item.ports = item.dataset.n;
      item.error = '';
    }
    keepParsed(item);
    return item.dataset;
  }

  function snapshotSettings() {
    const fs = state.dataset.freq;
    return JSON.parse(JSON.stringify({
      config: state.config, tab: state.tab, basis: state.basis, sFormat: state.sFormat, sKeys: state.sKeys,
      z: state.z, cispr: state.cispr, cmc: state.cmc, esb: state.esb, pairIn: state.pairIn, pairOut: state.pairOut,
      markers: state.markers.map(i => i === null ? null : fs[i]), profileName: state.profile.name, axes: state.axes, zFamily: state.zFamily,
      time: state.time ? { row: state.time.row, col: state.time.col, mode: state.time.mode, window: state.time.window, rise: state.time.rise, tmax: state.time.tmax, rate: state.time.rate, amp: state.time.amp, order: state.time.order } : null,
      connector: state.connector?.profile && state.connector.mapping ? { profile: state.connector.profile, custom: Connector.profile(state.connector.profile)?.status === 'file' ? Connector.profile(state.connector.profile) : null, configuration: state.connector.configuration, ports: state.connector.mapping.ports,
        source: state.connector.mapping.source, channels: state.connector.channels, applied: state.connector.applied || null } : null
    }));
  }

  function settingsFromEmbedded(dataset) {
    const e = dataset.embedded, n = dataset.n;
    if (!e) return null;
    const valid = p => Number.isInteger(p) && p >= 0 && p < n;
    const positive = value => Number.isFinite(value) && value > 0;
    const loads = RF.indices(n).map(() => ({ type: 'active' }));
    for (const { port, load } of e.loads) {
      if (load.type === 'join') {
        if (!valid(port) || !valid(load.to) || load.to === port) return null;
        loads[port] = { type: 'join', to: load.to };
        continue;
      }
      if (!valid(port) || !LOADS.some(([type]) => type === load.type)) return null;
      const value = k => Number.isFinite(load[k]) ? load[k] : 0;
      loads[port] = EDITABLE_LOADS.includes(load.type)
        ? { type: load.type, r: Math.max(0, value('r')), x: value('x'), l: Math.max(0, value('l')), c: Math.max(0, value('c')) }
        : { type: load.type };
    }
    const used = new Set();
    const pairs = [...e.pairs].sort((a, b) => a.id - b.id).map((pair, i) => ({
      id: i + 1, p: pair.p, q: pair.q, ...(positive(pair.zd) ? { zd: pair.zd } : {}), ...(positive(pair.zc) ? { zc: pair.zc } : {})
    }));
    for (const pair of pairs) {
      if (!valid(pair.p) || !valid(pair.q) || pair.p === pair.q || used.has(pair.p) || used.has(pair.q) ||
        loads[pair.p].type !== 'active' || loads[pair.q].type !== 'active') return null;
      used.add(pair.p); used.add(pair.q);
    }
    if (!loads.some(load => load.type === 'active') || loads.some(load => load.type === 'join' && loads[load.to].type === 'join')) return null;
    return {
      config: { loads, pairs, ref: positive(e.ref) ? e.ref : null }, tab: e.view.tab, basis: e.view.basis, sFormat: e.view.format,
      sKeys: { mm: e.traces.mm ?? null, se: e.traces.se ?? null }, markers: e.markers.length ? e.markers : undefined, profileName: e.name
    };
  }

  // Order: this session, this device, profile inside the file, learned template, previous file, default.
  async function resolveSettings(item, alive) {
    if (item.settings) return { settings: item.settings, profile: item.profile ?? blankProfile() };
    const dataset = item.dataset, base = blankProfile();
    const stored = dataset.spice && spiceStore()[dataset.spice.lib + '|' + dataset.spice.sub];
    if (stored) return { settings: stored, profile: { ...base, source: 'local', name: stored.profileName || '' } };
    const embedded = settingsFromEmbedded(dataset);
    if (embedded) return { settings: embedded, profile: { ...base, source: 'file', name: dataset.embedded.name } };
    const matches = await Templates.match(dataset, alive);
    let blocked = null;
    if (matches[0] && matches[0].score <= Templates.AUTO) {
      const conflict = templateConflict(matches[0].tpl, physicsOf(dataset));
      if (!conflict) return { settings: Templates.settings(matches[0], dataset.n), profile: { ...base, source: 'template', name: matches[0].tpl.name, score: matches[0].score, matches } };
      blocked = { name: matches[0].tpl.name, score: matches[0].score, reason: conflict };
    }
    if (state.dataset && !state.dataset.demo && state.dataset.n === dataset.n) {
      const carry = snapshotSettings();
      delete carry.cmc;
      delete carry.axes;
      return { settings: carry, profile: { ...base, source: 'carry', name: state.profile.name, matches, blocked } };
    }
    return { settings: null, profile: { ...base, source: dataset.profile ? 'builtin' : 'default', matches, blocked } };
  }

  async function openItem(id, { keepTab = false } = {}) {
    const item = sessionItem(id);
    if (!item) return;
    const tabBefore = keepTab && state.dataset && !state.dataset.demo ? state.tab : null;
    const job = ++state.importJob;
    flushSettings();
    const previous = sessionItem(session.current);
    if (previous && previous.dataset === state.dataset && state.dataset) {
      previous.settings = snapshotSettings();
      previous.profile = state.profile;
    }
    if (state.collapsed && !mobile.matches) {
      state.collapsed = false;
      renderSidebar();
    }
    notice('import-notice', 'Touchstone-Datei wird gelesen …');
    $('import-notice').classList.add('neutral');
    try {
      const dataset = await loadDataset(item);
      if (job !== state.importJob) return;
      const resolved = await resolveSettings(item, () => job === state.importJob);
      if (job !== state.importJob) return;
      if (mobile.matches) state.collapsed = true;
      session.current = id;
      rememberCurrent(item);
      state.profile = { ...resolved.profile };
      initDataset(dataset, resolved.settings);
      state.profile.key = configKey();
      // Stepping through files keeps the view the user is looking at instead of the tab stored with the file.
      if (tabBefore && state.tab !== tabBefore) setTab(tabBefore);
      if (state.profile.source === 'template') {
        toast('Vorlage „' + state.profile.name + '“ erkannt · ' + Templates.similarity(state.profile.score) + ' % · Ports automatisch zugeordnet');
      } else if (dataset.warnings.length && mobile.matches) toast(dataset.warnings[0]);
      renderSession();
      renderShelf();
    } catch (error) {
      if (job !== state.importJob) return;
      item.error = error.message;
      notice('import-notice', error.message);
      if (session.items.length > 1) toast(item.name + ' · ' + error.message);
      renderSession();
    } finally {
      if (job === state.importJob) $('import-notice').classList.remove('neutral');
    }
  }

