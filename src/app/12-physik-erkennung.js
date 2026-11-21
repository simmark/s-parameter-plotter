  // ---- Physics-based recognition (Magnetic module): cached per dataset; suggestions are applied only on request. ----
  const physicsCache = new WeakMap();
  const EN = () => window.I18N?.lang === 'en';
  const tx = (de, en) => EN() ? en : de;
  const lang = () => EN() ? 'en' : 'de';
  const short = cat => Magnetic.label(cat, lang(), true);
  const LEVEL = { wahrscheinlich: ['wahrscheinlich', 'likely'], 'möglich': ['möglich', 'possible'], unklar: ['unklar', 'unclear'], sicher: ['sicher', 'certain'] };
  const level = value => (LEVEL[value] || [value, value])[EN() ? 1 : 0];
  function physicsOf(dataset) {
    if (!dataset || dataset.demo || typeof Magnetic === 'undefined') return null;
    if (!physicsCache.has(dataset)) {
      let result;
      try { result = Magnetic.analyze(dataset); } catch (error) { result = { status: 'error', reason: error.message, reasonEn: error.message }; }
      physicsCache.set(dataset, result);
    }
    return physicsCache.get(dataset);
  }
  const fitsClass = (label, physical) => label === physical || (label === 'inductor' && ['ferrite-inductor', 'coreless', 'bead'].includes(physical));
  const templateClass = tpl => tpl.category || Magnetic.categoryFromName(tpl.name);

  // Reason why a learned template must not be applied automatically to this file; null = no objection.
  function templateConflict(tpl, physics) {
    const label = templateClass(tpl);
    if (!label || !physics || physics.status !== 'candidate') return null;
    const v = physics.verdict;
    if (v.category && v.category !== 'other' && !fitsClass(label, v.category) && !fitsClass(v.category, label)) {
      return tx('Die Messung spricht für ' + short(v.category) + ' (' + level(v.level) + '), die Vorlage ist als ' + short(label) + ' gelernt.',
        'The measurement indicates ' + short(v.category) + ' (' + level(v.level) + '); the template was learned as ' + short(label) + '.');
    }
    if (!v.category && label === 'cmc' && v.ranked.slice(0, 2).some(r => r.category === 'coupled')) return tx('Die Messung ist nicht eindeutig: CMC oder Doppeldrossel.', 'The measurement is ambiguous: CMC or coupled inductor.');
    const maker = physics.manufacturer?.category;
    if (maker && !fitsClass(label, maker) && !fitsClass(maker, label)) return tx('Laut Dateikopf ist das Bauteil ' + short(maker) + ' (' + physics.manufacturer.family + ').', 'According to the file header the part is a ' + short(maker) + ' (' + physics.manufacturer.family + ').');
    return null;
  }

  // Class and physics fingerprint stored with a learned template (spa-pack v1, optional fields).
  function physicsLabel(name, dataset) {
    const physics = physicsOf(dataset);
    const byName = Magnetic.categoryFromName(name);
    const byPhysics = physics?.status === 'candidate' && physics.verdict.level !== 'unklar' ? physics.verdict.category : null;
    const category = byName || byPhysics || null;
    const phys = Magnetic.fingerprint(physics);
    return { ...(category ? { category, categorySource: byName ? 'name' : 'physik' } : {}), ...(phys ? { phys } : {}), source: 'user_labeled' };
  }

  const samePairs = (a, b) => {
    const norm = list => JSON.stringify(list.map(pair => [...pair].sort((x, y) => x - y)).sort());
    return a.length === b.length && norm(a) === norm(b);
  };

  // Warning when the active pairs do not fit the measured winding paths (four-port, paths certain).
  function pairWarning() {
    const physics = physicsOf(state.dataset);
    if (!physics || physics.kind !== 'four-port' || physics.windings?.confidence !== 'sicher' || !physics.mappings) return '';
    if (state.basis !== 'mm' || state.config.pairs.length !== 2) return '';
    const current = state.config.pairs.map(pair => [pair.p, pair.q]);
    if (physics.mappings.some(m => samePairs(m.pairs, current))) return '';
    const paths = physics.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(tx(' und ', ' and '));
    const line = physics.mappings[0].pairs, crossed = [[line[0][0], line[1][1]], [line[1][0], line[0][1]]];
    return samePairs(crossed, current)
      ? tx('Die Paare verbinden die Wicklungen gegensinnig (Wicklungen ' + paths + '): Gleich- und Gegentakt sind vertauscht.', 'The pairs join the windings in opposite sense (windings ' + paths + '): common and differential mode are swapped.')
      : tx('Die Paare passen nicht zu den gemessenen Wicklungen ' + paths + ': Sdd und Scc sind so physikalisch nicht aussagekräftig.', 'The pairs do not match the measured windings ' + paths + ': Sdd and Scc are not physically meaningful this way.');
  }

  function applyPhysicsMapping(kind) {
    const physics = physicsOf(state.dataset);
    const mapping = physics?.mappings?.find(m => m.kind === kind);
    if (!mapping) return;
    const config = state.config;
    config.pairs = mapping.pairs.map(([p, q], i) => ({ p, q, id: i + 1 }));
    for (const [p, q] of mapping.pairs) { config.loads[p] = { type: 'active' }; config.loads[q] = { type: 'active' }; }
    state.pairIn = 1; state.pairOut = 2; state.pairDraft = null;
    state.sKeys.mm = null; state.basis = 'mm'; state.curveApply = true;
    const category = physics.verdict?.category;
    state.profile = { ...state.profile, source: 'physics', name: state.profile.name || (category && Magnetic.MAGNETIC.includes(category) ? Magnetic.SHORT[category] : ''), key: '' };
    refreshNetwork();
    toast(tx('Portzuordnung übernommen: ' + mapping.text, 'Port assignment applied: ' + mapping.en));
  }

  function physicsCard() {
    const ph = physicsOf(state.dataset);
    if (!ph || ph.status === 'not-applicable') return '';
    const hz = f => Magnetic.fmtHz(f, lang());
    const dec = (v, d) => EN() ? v.toFixed(d) : v.toFixed(d).replace('.', ',');
    let headline, tone = 'neutral';
    if (ph.status === 'insufficient-data' || ph.status === 'error') { headline = tx('Datenlage unzureichend', 'Insufficient data'); tone = 'warn'; }
    else if (ph.verdict.category && ph.verdict.level !== 'unklar') { headline = Magnetic.label(ph.verdict.category, lang()) + ' ' + level(ph.verdict.level); tone = ph.verdict.level === 'wahrscheinlich' ? 'good' : 'neutral'; }
    else if (ph.verdict.ranked?.length >= 2) headline = tx('Nicht eindeutig: ', 'Ambiguous: ') + short(ph.verdict.ranked[0].category) + tx(' oder ', ' or ') + short(ph.verdict.ranked[1].category);
    else headline = tx('Nicht eindeutig', 'Ambiguous');
    const f = ph.features || {};
    let metrics = '';
    if (ph.kind === 'four-port' && ph.windings) {
      metrics += metricText(tx('Wicklungspfade · ', 'Winding paths · ') + level(ph.windings.confidence), ph.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(' · '));
      if (Number.isFinite(f.L1)) {
        metrics += metricText(tx('L₁ · Wicklung 1', 'L₁ · winding 1'), si(f.L1, 'H')) + metricText(tx('L₂ · Wicklung 2', 'L₂ · winding 2'), si(f.L2, 'H')) +
          metricText(tx('k · Kopplung (', 'k · coupling (') + ({ gut: tx('gut', 'good'), 'eingeschränkt': tx('eingeschränkt', 'limited'), unsicher: tx('unsicher', 'uncertain') }[f.kQuality] || f.kQuality) + ')',
            dec(Math.abs(f.k), Math.abs(f.k) >= 0.999 ? 4 : 3) + (f.k < 0 ? tx(' (gegensinnig)', ' (opposite)') : '')) +
          metricText(tx('n · Windungsverhältnis', 'n · turns ratio'), '1 : ' + dec(f.n, 3)) +
          metricText(tx('tan δ · Kernverlust max.', 'tan δ · core loss max.'), Number.isFinite(f.tanMax) ? dec(f.tanMax, 2) : '–') +
          metricText(tx('f_res · Eigenresonanz', 'f_res · self-resonance'), Number.isFinite(f.srf) ? hz(f.srf) : '> ' + hz(ph.quality.fMax)) +
          metricText(tx('Sdc21 · Modenkonversion max.', 'Sdc21 · mode conversion max.'), Number.isFinite(f.sdcMax) ? dec(f.sdcMax, 1) + ' dB' : '–');
      }
    } else if (ph.kind === 'two-pole' && ph.status === 'candidate') {
      metrics += metricText(tx('Topologie', 'Topology'), ({ series: [tx('Serienelement', 'Series element')], shunt: [tx('Querelement', 'Shunt element')], 'one-port': [tx('Eintor', 'One-port')] }[ph.topology] || [tx('kein Zweipol', 'no two-pole')])[0]);
      if (Number.isFinite(f.L)) metrics += metricText(tx('L · Induktivität', 'L · inductance'), si(f.L, 'H'));
      if (Number.isFinite(f.C)) metrics += metricText(tx('C · Kapazität', 'C · capacitance'), si(f.C, 'F'));
      if (Number.isFinite(f.R)) metrics += metricText(tx('R · Widerstand', 'R · resistance'), si(f.R, 'Ω'));
      if (Number.isFinite(f.rDc)) metrics += metricText(tx('R · bei tiefer Frequenz', 'R · at low frequency'), si(f.rDc, 'Ω'));
      if (Number.isFinite(f.esr)) metrics += metricText('ESR', si(f.esr, 'Ω'));
      if ('srf' in f) metrics += metricText(tx('f_res · Eigenresonanz', 'f_res · self-resonance'), Number.isFinite(f.srf) ? hz(f.srf) : tx('nicht im Band', 'not in band'));
      if (Number.isFinite(f.qMax)) metrics += metricText(tx('Q · Güte max.', 'Q · quality factor max.'), f.qMax.toFixed(0));
    }
    const agree = { 'bestätigt': tx('passt zur Messung', 'matches the measurement'), widerspricht: tx('widerspricht der Messung', 'contradicts the measurement'), offen: tx('Messung nicht eindeutig', 'measurement ambiguous') };
    const maker = ph.manufacturer?.family ? '<p class="note physics-maker">' + tx('Herstellerangabe im Dateikopf: ', 'Manufacturer data in the file header: ') + '<strong>' + esc(ph.manufacturer.family + (ph.manufacturer.part ? ' ' + ph.manufacturer.part : '')) + '</strong>' +
      (ph.manufacturer.category ? ' → ' + esc(short(ph.manufacturer.category)) + (ph.agreement ? ' · ' + esc(agree[ph.agreement]) : '') : '') + '</p>' : '';
    const current = state.config.pairs.map(pair => [pair.p, pair.q]);
    const buttons = (ph.mappings || []).map(m => actionButton((m.kind === 'line' ? tx('Als Leitungen übernehmen', 'Apply as lines') : tx('Als Wicklungen übernehmen', 'Apply as windings')) + ' (' + m.pairs.map(([a, b]) => portName(a) + '/' + portName(b)).join(' · ') + ')',
      'physics-apply', m.kind, m.kind === ph.recommended ? 'button primary' : 'button', 'network', disabled(samePairs(m.pairs, current) && state.config.pairs.length === 2))).join('');
    const b = state.profile.blocked;
    const blocked = b ? '<p class="inline-notice">' + esc(tx('Vorlage „' + b.name + '“ (' + Templates.similarity(b.score) + ' %) wurde nicht automatisch angewendet. ', 'Template "' + b.name + '" (' + Templates.similarity(b.score) + ' %) was not applied automatically. ') + b.reason) + '</p>' : '';
    const warn = pairWarning();
    const mine = Magnetic.fingerprint(ph);
    const similar = mine ? Templates.all().filter(t => t.phys).map(t => ({ t, d: Magnetic.distance(mine, t.phys) })).filter(x => x.d !== null && x.d <= 0.6)
      .sort((x, y) => x.d - y.d).filter((x, i, all) => all.findIndex(y => y.t.name === x.t.name) === i).slice(0, 3) : [];
    const similarHtml = similar.length ? '<p class="note">' + tx('Physikalisch ähnlich gelernt: ', 'Physically similar learned parts: ') + similar.map(x => '<strong>' + esc(x.t.name) + '</strong> (' + tx('Abstand ', 'distance ') + dec(x.d, 2) + ')').join(' · ') + '</p>' : '';
    const sign = v => v > 0 ? '+' : '−';
    const evidence = (ph.evidence || []).map(e => {
      const scores = Object.entries(e.scores || {}).filter(([, v]) => v).map(([c, v]) => '<span class="ev-score ' + (v > 0 ? 'pro' : 'con') + '">' + sign(v) + ' ' + esc(short(c)) + '</span>').join('');
      return '<li><span>' + esc(EN() ? e.en || e.text : e.text) + '</span>' + (scores ? '<span class="ev-scores">' + scores + '</span>' : '') + '</li>';
    }).join('');
    const ranked = (ph.verdict?.ranked || []).map(r => esc(short(r.category)) + ' ' + dec(r.score, 1)).join(' · ');
    const modes = (f.modes || []).length ? '<div class="table-scroll"><table class="ports-table physics-modes"><thead><tr><th scope="col">f</th><th scope="col">Sdd21</th><th scope="col">Scc21</th><th scope="col">Sdc21</th><th scope="col">Sdd11</th></tr></thead><tbody>' +
      f.modes.map(m => '<tr><td>' + esc(hz(m.f)) + '</td>' + ['sdd21', 'scc21', 'sdc21', 'sdd11'].map(k => '<td class="mono">' + (Number.isFinite(m[k]) ? dec(m[k], 1) : '–') + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div><p class="note">' + tx('dB, Leitungs-Lesart mit den gepunkteten Enden als Plus, Bezug wie in der App (Z_D = 2·Z₀, Z_C = Z₀/2).', 'dB, line reading with the dotted ends as plus, reference as in the app (Z_D = 2·Z₀, Z_C = Z₀/2).') + '</p>' : '';
    const reason = ph.reason ? (EN() ? ph.reasonEn || ph.reason : ph.reason) : '';
    const why = '<details class="physics-why"><summary>' + tx('Warum?', 'Why?') + '</summary>' +
      (reason ? '<p class="note">' + esc(reason) + '</p>' : '') +
      (evidence ? '<ul class="evidence-list">' + evidence + '</ul>' : '') +
      (ranked ? '<p class="note">' + tx('Merkmalspunkte: ', 'Feature points: ') + ranked + tx('. Eine Summe aus Merkmalspunkten, keine kalibrierte Wahrscheinlichkeit.', '. A sum of feature points, not a calibrated probability.') + '</p>' : '') +
      (f.kBand ? '<p class="note">' + esc(tx('k aus der komplexen Y-Matrix der beiden Wicklungen, ' + f.kPoints + ' Punkte zwischen ' + hz(f.kBand[0]) + ' und ' + hz(f.kBand.at(-1)) + ' (unter 0,2·f_res, Streureaktanz ≥ 1 Ω); Streuung ±' + dec(f.kSpread, 4) + '.',
        'k from the complex Y-matrix of both windings, ' + f.kPoints + ' points between ' + hz(f.kBand[0]) + ' and ' + hz(f.kBand.at(-1)) + ' (below 0.2·f_res, leakage reactance ≥ 1 Ω); spread ±' + dec(f.kSpread, 4) + '.')) + '</p>' : '') +
      modes + ((ph.warnings || []).length ? '<ul class="evidence-list warn">' + ph.warnings.map(w => '<li>' + esc(typeof w === 'string' ? w : EN() ? w.en : w.de) + '</li>').join('') + '</ul>' : '') +
      '<p class="note">' + esc(tx('Quelle: ', 'Source: ') + (ph.provenance === 'simulation' ? tx('Simulation eines SPICE-Modells', 'simulation of a SPICE model') : tx('Messdatei', 'measurement file')) + tx(' · Methode: komplexer Y-Matrix-Zweigfit und Topologieprüfung · Modul ', ' · method: complex Y-matrix branch fit and topology check · module ') + ph.version +
      (ph.quality ? ' · ' + ph.quality.points + tx(' Punkte, ', ' points, ') + hz(ph.quality.fMin) + ' – ' + hz(ph.quality.fMax) : '') +
      tx('. Herstellerangaben und Messphysik werden getrennt bewertet; nichts wird ohne deinen Klick übernommen.', '. Manufacturer data and measured physics are assessed separately; nothing is applied without your click.')) + '</p></details>';
    return '<section class="config-card physics-card"><div class="config-head"><h2>' + tx('Bauteil-Erkennung', 'Component recognition') + '</h2><p class="physics-verdict is-' + tone + '" id="physics-verdict">' + esc(headline) + '</p></div>' +
      '<div class="config-content">' + blocked + (warn ? '<p class="inline-notice">' + esc(warn) + '</p>' : '') + maker +
      (metrics ? '<div class="metric-grid">' + metrics + '</div>' : '') + (buttons ? '<div class="preset-row physics-actions">' + buttons + '</div>' : '') + similarHtml + why + '</div></section>';
  }

  function profileCard() {
    const p = state.profile;
    const label = {
      file: 'In der Datei gespeichert', template: 'Vorlage erkannt', local: 'Auf diesem Gerät gemerkt', carry: 'Von der vorherigen Datei übernommen', physics: 'Aus der Messung vorgeschlagen',
      builtin: 'Bekanntes Bauteil', default: 'Noch kein Profil'
    }[p.source];
    const status = label + (p.source === 'template' && p.score !== null ? ' · ' + Templates.similarity(p.score) + ' % Übereinstimmung' : '') +
      (p.source !== 'default' && p.key && p.key !== configKey() ? ' · geändert' : '');
    const chips = p.matches.map((match, i) => actionButton(match.tpl.name + ' · ' + Templates.similarity(match.score) + ' %', 'apply-template', i, 'button template-chip', '',
      ' title="' + esc(match.a.pairs.map(([a, b], k) => 'D' + (k + 1) + ' = ' + portName(a) + '/' + portName(b)).join(' · ')) + '"')).join('');
    const stored = Templates.groups().map(group => '<li><span><strong>' + esc(group.name) + '</strong> · ' + group.n + ' Ports · ' + group.pairs + ' Paare · ' +
      group.count + (group.count === 1 ? ' Beispiel' : ' Beispiele') + '</span>' + iconButton('Vorlage ' + group.name + ' löschen', 'delete-template', group.key, 'close') + '</li>').join('');
    return '<section class="config-card profile-card"><div class="config-head"><h2>Port-Profil</h2><p class="profile-status" id="profile-status">' + esc(status) + '</p></div>' +
      '<div class="config-content"><form id="profile-form" class="profile-form">' +
      textField('Bauteiltyp', 'name', p.name, 'z. B. CMC, LAN-Übertrager', 'profile-name') +
      '<button class="button primary" type="submit"' + disabled(state.dataset.demo) + '>' + icon('file') + (state.dataset.spice ? 'Für Modell speichern' : 'In Datei speichern') + '</button>' +
      actionButton('Als Vorlage lernen', 'learn-template', '', 'button', 'plus') +
      actionButton('Vorlagen prüfen', 'match-templates', '', 'button', 'reset', disabled(!Templates.size)) + actionButton('Pakete …', 'packs', '', 'button', 'grid', ' title="Fingerabdrücke und Kurvenwahl sichern, laden, teilen"') + '</form>' +
      (chips ? '<div class="preset-row"><span>Passende Vorlagen</span>' + chips + '</div>' : '') +
      '<p class="note">Paare, Abschlüsse, Bezugsimpedanzen und Kurvenauswahl stehen als lesbarer Kommentarblock in der Touchstone-Datei (TS 2.x: im Block [Begin Information]) und werden beim nächsten Öffnen übernommen. Eine gelernte Vorlage erkennt ähnliche Bauteile am Verhalten, auch bei anderer Portreihenfolge.</p>' +
      (stored ? '<details class="template-list"><summary>Gelernte Vorlagen</summary><ul>' + stored + '</ul></details>' : '') +
      '</div></section>';
  }

  // Settings are stored with the file entry, so a reload restores pairs, loads, markers, axes and the open view.
  let settingsTimer = null, settingsJob = null;
  let settingsKey = '';
  function persistSettings() {
    const item = sessionItem(session.current);
    if (!item?.entryId || !state.dataset || state.dataset.demo || item.dataset !== state.dataset) return;
    const settings = snapshotSettings(), entryId = item.entryId, sub = item.make ? item.name : null;
    // a pending write of another file goes out first; it must not be cancelled by the debounce of this one
    if (settingsJob && settingsKey !== entryId + '|' + sub) settingsJob();
    settingsKey = entryId + '|' + sub;
    settingsJob = () => {
      settingsJob = null;
      clearTimeout(settingsTimer);
      Store.updateEntry(entryId, sub ? record => ({ subs: { ...(record.subs || {}), [sub]: settings } }) : { settings }).catch(() => {});
    };
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => settingsJob?.(), 300);
  }
  const flushSettings = () => settingsJob?.();
  function rememberCurrent(item) {
    if (!item?.entryId) return;
    Store.setMeta('session', { entryId: item.entryId, sub: item.make ? item.name : null, updatedAt: Date.now() }).catch(() => {});
  }

  function applySettings(dataset, saved) {
    const n = dataset.n;
    const validPort = p => Number.isInteger(p) && p >= 0 && p < n;
    const config = saved.config;
    if (!config || !Array.isArray(config.loads) || config.loads.length !== n) return;
    if (!config.pairs.every(pair => validPort(pair.p) && validPort(pair.q) && pair.p !== pair.q)) return;
    if (!config.loads.some(load => load.type === 'active')) return;
    if (!config.loads.every(load => load.type !== 'join' || (validPort(load.to) && config.loads[load.to].type !== 'join'))) return;
    state.config = { loads: config.loads, pairs: config.pairs, ref: Number.isFinite(config.ref) && config.ref > 0 ? config.ref : null };
    if (Array.isArray(config.triples) && config.triples.length && config.triples.every(t => [t.a, t.b, t.c].every(validPort) && new Set([t.a, t.b, t.c]).size === 3)) {
      state.config.triples = config.triples.map((t, i) => ({ a: t.a, b: t.b, c: t.c, id: i + 1 }));
    }
    if (Object.hasOwn(TABS, saved.tab)) state.tab = saved.tab;
    if (['se', 'mm'].includes(saved.basis)) state.basis = saved.basis;
    if (S_FORMATS.some(([key]) => key === saved.sFormat)) state.sFormat = saved.sFormat;
    if (saved.sKeys) state.sKeys = { se: saved.sKeys.se ?? null, mm: saved.sKeys.mm ?? null };
    if (saved.z?.method) state.z = { ...state.z, ...saved.z };
    state.zFamily = saved.zFamily === 'cispr' || (saved.tab === 'cispr' && saved.zFamily !== 'z') ? 'cispr' : 'z';
    if (saved.cispr?.method) state.cispr = { ...state.cispr, ...saved.cispr };
    if (Array.isArray(saved.cmc?.band) && saved.cmc.band.every(Number.isFinite)) state.cmc = { ...state.cmc, ...saved.cmc };
    if (saved.esb?.model) state.esb = { ...state.esb, ...saved.esb };
    if (saved.time && typeof saved.time === 'object') {
      const t = saved.time, num = (v, lo, hi, d) => Number.isFinite(v) && v >= lo && v <= hi ? v : d;
      state.time = { ...tdBlank(), row: typeof t.row === 'string' ? t.row : '', col: typeof t.col === 'string' ? t.col : '', mode: ['step', 'impulse', 'tdr'].includes(t.mode) ? t.mode : 'step',
        window: ['rect', 'hann', 'kaiser'].includes(t.window) ? t.window : 'hann', rise: num(t.rise, 0, 1e-6, 0), tmax: num(t.tmax, 0, 1, 0), rate: num(t.rate, 1e3, 1e12, 1e9), amp: num(t.amp, 1e-3, 100, 0.5), order: [7, 9, 11].includes(t.order) ? t.order : 7 };
    }
    if (saved.connector?.custom && saved.connector.custom.id === saved.connector.profile && /^file:/.test(saved.connector.profile)) {
      try { if (!Connector.profile(saved.connector.profile)) Connector.register({ ...saved.connector.custom, status: 'file' }); } catch { /* invalid stored profile: ignored */ }
    }
    if (saved.connector?.profile) {
      const cp = Connector.profile(saved.connector.profile), nodes = cp ? new Set(Connector.nodesOf(cp)) : null;
      if (cp && Connector.portCount(cp) === n && Array.isArray(saved.connector.ports) && saved.connector.ports.length === n && saved.connector.ports.every(x => x === null || nodes.has(x))) {
        const mapping = Connector.emptyMapping(cp, n);
        mapping.ports = saved.connector.ports.slice(); mapping.source = Array.isArray(saved.connector.source) ? saved.connector.source.slice(0, n).map(String) : mapping.source;
        state.connector = { ...cnBlank(), profile: cp.id, configuration: saved.connector.configuration || cp.configurations.at(-1).id, mapping,
          channels: Array.isArray(saved.connector.channels) ? saved.connector.channels.filter(c => Number.isInteger(c.id)) : [], applied: saved.connector.applied || null };
      }
    }
    if (Number.isInteger(saved.pairIn)) state.pairIn = saved.pairIn;
    if (Number.isInteger(saved.pairOut)) state.pairOut = saved.pairOut;
    if (Array.isArray(saved.markers)) {
      state.markers = [0, 1, 2, 3].map(i => Number.isFinite(saved.markers[i]) ? Plot.nearest(dataset.freq, saved.markers[i], true) : (i || saved.markers.every(m => m === null) ? null : state.markers[0]));
    }
    if (saved.axes && typeof saved.axes === 'object') {
      const range = r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1] ? [r[0], r[1]] : null;
      for (const [tab, a] of Object.entries(saved.axes)) {
        if (!Object.hasOwn(TABS, tab) || !a || typeof a !== 'object') continue;
        state.axes[tab] = { ...defaultAxes(tab), ...(a.x === 'log' || a.x === 'linear' ? { x: a.x } : {}), ...(Y_SCALES.includes(a.y) ? { y: a.y } : {}), xRange: range(a.xRange), yRange: range(a.yRange) };
      }
    }
  }

  function loadDemo(n) {
    state.importJob++;
    flushSettings();
    session.current = null;
    state.profile = blankProfile();
    $('import-notice').classList.remove('neutral');
    if (mobile.matches) state.collapsed = true;
    initDataset(RF.demoNetwork(n));
    state.profile.key = configKey();
    renderSession();
    renderShelf();
  }

  // Start order: restore the saved session, then a file shared from Android or opened from the OS, otherwise the demo.
  async function receiveSharedFile() {
    const params = new URLSearchParams(location.search);
    if (!params.has('shared') || !('caches' in window)) return false;
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('s-parameter-analyzer:shared');
      const response = await cache.match('shared-file');
      if (!response) return false;
      await cache.delete('shared-file');
      const name = decodeURIComponent(response.headers.get('X-File-Name') || 'Geteilt.snp');
      await importFile(new File([await response.blob()], name));
      return true;
    } catch {
      return false;
    }
  }

  // Rebuilds the session list from the durable store. Files are read lazily, so 100 and more entries start quickly.
  async function restoreSession(open) {
    let entries;
    try { entries = await Store.entries('session'); } catch { return false; }
    if (!entries.length) return false;
    const known = new Set(session.items.map(item => item.entryId));
    const added = addItems(await expandModels(entries.filter(entry => !known.has(entry.id)).map(entry => entrySource(entry))));
    renderSession();
    renderStorageNotice();
    if (!open || !added.length) return true;
    let meta = null;
    try { meta = await Store.getMeta('session'); } catch { meta = null; }
    const target = added.find(item => item.entryId === meta?.entryId && (!meta.sub || item.name === meta.sub)) ?? added.find(item => item.entryId === meta?.entryId) ?? added[0];
    await openItem(target.id);
    return !!state.dataset && session.current === target.id;
  }

  async function boot() {
    let launched = false;
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async params => {
        if (!params.files?.length) return;
        launched = true;
        // With "focus-existing" further files opened from the system land in this window and join the list.
        const bag = newBag();
        for (const handle of params.files) {
          if (ZIP_NAME.test(handle.name)) await addZip(await handle.getFile(), bag);
          else bag.files.push(handleDesc(handle));
        }
        ingest(bag);
      });
    }
    await Store.init();
    let broken = [];
    try {
      const moved = await Store.migrate();
      if (moved.shelf) session.notices.push({ id: 'migrated-shelf', neutral: true, text: 'Die bisherige Bibliothek wurde in den neuen Speicher übernommen: ' + plural(moved.shelf, 'Datei', 'Dateien') + ', geprüft.' });
      await Store.recover();
      broken = await Store.interrupted();
    } catch { /* storage problems are shown by the notice and the storage dialog */ }
    for (const item of broken) {
      session.notices.push({ id: item.id, importId: item.id, text: 'Der Import „' + item.name + '“ wurde unterbrochen (' + (item.done || 0) + ' von ' + item.total + ' Dateien verarbeitet). Es wurde nichts davon übernommen; vorhandene Dateien sind unverändert. Bitte erneut importieren.' });
    }
    Store.sweep().catch(() => {});
    Store.trimImports().catch(() => {});
    renderStorageNotice();
    renderShelf();
    const shared = new URLSearchParams(location.search).has('shared');
    let restored = false;
    try { restored = await restoreSession(!shared && !launched); } catch { restored = false; }
    if (await receiveSharedFile()) return;
    if (launched || (restored && state.dataset)) return;
    if (!state.dataset) loadDemo(4);
  }

  function refsSummary(refs) {
    const unique = [...new Set(refs.map(num))];
    return unique.length === 1 ? unique[0] + ' Ω' : 'je Port';
  }

  function loadName(load) {
    if (load.type === 'join') return '= ' + portName(load.to);
    return LOADS.find(item => item[0] === load.type)?.[1] || '—';
  }

  function loadDescription(load, ref) {
    if (load.type === 'join') return 'Kurzgeschlossen mit ' + portName(load.to) + ' · gemeinsamer Knoten';
    if (load.type === 'match') return display(ref) + ' Ω · Z₀ Datei';
    if (load.type === 'open') return 'Γ = +1';
    if (load.type === 'short') return 'Γ = −1';
    if (load.type === 'resistor') return display(load.r) + ' Ω';
    if (load.type === 'complex') return complexText([load.r, load.x], 'Ω');
    if (load.type === 'series' || load.type === 'parallel') {
      const r = load.r ? display(load.r) + ' Ω' : '';
      const l = load.l ? display(load.l * 1e9) + ' nH' : '';
      const c = load.c ? display(load.c * 1e12) + ' pF' : '';
      return [r, l, c].filter(Boolean).join(' · ') || (load.type === 'parallel' ? 'Open' : 'Short');
    }
    return '';
  }

  function topoHtml(full = false) {
    const { dataset, config } = state;
    const paired = new Set(config.pairs.flatMap(p => [p.p, p.q]));
    const groups = config.pairs.map(p => ({
      title: 'D' + p.id + ' / C' + p.id, color: pairColor(p.id),
      ports: [[p.p, '+'], [p.q, '−']]
    }));
    const singles = RF.indices(dataset.n).filter(i => !paired.has(i));
    singles.sort((a, b) => Number(config.loads[b].type === 'active') - Number(config.loads[a].type === 'active') || a - b);
    groups.push(...singles.map(i => ({ title: '', ports: [[i, '']] })));
    const max = full ? groups.length : 8;
    const limited = groups.slice(0, max);
    const group = item => {
      const wires = item.ports.map(([i, sign]) => {
        const load = config.loads[i];
        const term = load.type !== 'active';
        const label = term ? loadName(load) : sign;
        const tooltip = portName(i) + (dataset.portNames[i] ? ' · ' + dataset.portNames[i] : '') +
          (term ? ' · ' + loadDescription(load, dataset.refs[i]) : '');
        return '<div class="net-wire' + (sign ? ' is-paired' : '') + (term ? ' is-load' : '') +
          '" title="' + esc(tooltip) + '"><span class="net-chip">' + portName(i) +
          (label ? '<em>' + esc(label) + '</em>' : '') + '</span></div>';
      }).join('');
      return '<div class="net-group' + (item.color ? ' is-pair' : '') + '"' + (item.color ? ' style="--pc:' + item.color + '"' : '') + '>' +
        (item.title ? '<span class="net-pair"><i class="pc-dot"></i>' + modeMarkup(esc(item.title)) + '</span>' : '') + wires + '</div>';
    };
    const left = limited.filter((_, i) => i % 2 === 0).map(group).join('');
    const right = limited.filter((_, i) => i % 2 === 1).map(group).join('');
    return '<div class="topology-board" aria-label="Portschema des DUT"><div class="net-side">' + left +
      '</div><div class="net-core">DUT</div><div class="net-side right">' + right + '</div></div>' +
      (groups.length > max ? '<p class="net-hidden">+' + (groups.length - max) + ' weitere Gruppen in Ports &amp; Lasten</p>' : '');
  }

  // On phones the sidebar is a drawer: the back button closes it first, the page behind does not scroll.
  let drawerSync = false;
  function syncDrawer() {
    const open = mobile.matches && !state.collapsed;
    document.body.classList.toggle('drawer-open', open);
    $('sidebar').inert = mobile.matches && state.collapsed;
    $('drawer-toggle').setAttribute('aria-expanded', String(open));
    if (!mobile.matches || drawerSync) return;
    if (open && !history.state?.spaDrawer) history.pushState({ spaDrawer: true }, '');
    else if (!open && history.state?.spaDrawer) { drawerSync = true; history.back(); }
  }
  function closeDrawer() {
    if (state.collapsed) return;
    state.collapsed = true;
    renderSidebar();
  }

  function renderSidebar() {
    $('app-layout').classList.toggle('sidebar-collapsed', state.collapsed);
    syncDrawer();
    const button = $('sidebar-button');
    button.setAttribute('aria-expanded', String(!state.collapsed));
    button.setAttribute('aria-label', state.collapsed ? 'Messnetzwerk ausklappen' : 'Messnetzwerk einklappen');
    button.title = button.getAttribute('aria-label');
    const d = state.dataset;
    if (!d) return;
    $('heading-file').textContent = d.name;
    $('file-chip-name').textContent = d.name;
    $('menu-file-name').textContent = d.name;
    $('file-chip').setAttribute('aria-expanded', String(!state.collapsed));
    $('dataset-summary').innerHTML =
      '<div class="file-title" title="' + esc(d.name) + '">' + icon('file') + '<strong>' + esc(d.name) + '</strong>' +
      (d.demo ? '<span class="demo-tag">Demo</span>' : '') + '</div>' +
      '<dl class="file-meta">' +
      '<div><dt>Frequenz</dt><dd class="mono">' + esc(hz(d.freq[0])) + ' – ' + esc(hz(d.freq.at(-1))) + '</dd></div>' +
      '<div><dt>Punkte</dt><dd class="mono">' + d.freq.length.toLocaleString(LOCALE) + '</dd></div>' +
      '<div><dt>Dateireferenz</dt><dd class="mono">' + esc(refsSummary(d.refs)) + '</dd></div>' +
      '<div><dt>Format</dt><dd class="mono">' + (d.spice ? 'SPICE · ' + d.spice.elements + ' R/L/C' : 'TS ' + esc(d.version) + ' · ' + esc(d.sourceKind + '/' + d.format)) + '</dd></div>' +
      (d.noiseCount ? '<div><dt>Rauschpunkte</dt><dd class="mono">' + d.noiseCount + '</dd></div>' : '') +
      '</dl>' + (d.spice ? '<form id="sweep-form" class="sweep-form"><span>AC-Sweep</span><input class="field-input" name="start" aria-label="Startfrequenz" value="' + esc(freqInput(d.freq[0])) +
        '"><input class="field-input" name="stop" aria-label="Stoppfrequenz" value="' + esc(freqInput(d.freq.at(-1))) + '"><button type="submit" class="quiet-button">Rechnen</button></form>' : '');
    $('topology').innerHTML = topoHtml();
    const active = state.layout?.active.length ?? d.n, loaded = d.n - active;
    $('network-summary').innerHTML = '<span class="badge active">' + active + ' aktiv</span>' +
      (state.config.pairs.length ? '<span class="badge">' + state.config.pairs.length + ' Paare</span>' : '') +
      (loaded ? '<span class="badge loaded">' + loaded + ' abgeschlossen</span>' : '') +
      ({ file: '<span class="badge profile-badge">Profil aus Datei</span>', template: '<span class="badge profile-badge">Vorlage ' + esc(state.profile.name) + '</span>' }[state.profile.source] ?? '');
  }

  function currentModes() {
    if (!state.layout) return [];
    return state.basis === 'mm' ? state.layout.mmModes : state.layout.seModes;
  }

  function getView(basis = state.basis) {
    const n = state.network;
    return basis === 'mm' ? { modes: n.layout.mmModes, samples: n.mm } : { modes: n.layout.seModes, samples: n.se };
  }

  function modeLabel(mode) {
    return mode.key + ' · ' + display(mode.ref) + ' Ω';
  }

  function modeOptions() {
    return currentModes().map(mode => [mode.key, modeLabel(mode)]);
  }

  function setTab(tab) {
    if (!Object.hasOwn(TABS, tab)) return;
    // The Z tab reopens the evaluation family that was used last (impedance or CISPR 17).
    if (tab === 'z' && state.zFamily === 'cispr') tab = 'cispr';
    state.tab = tab;
    if (tab === 'z' || tab === 'cispr') state.zFamily = tab;
    renderMain();
    const target = $('tab-' + tabButton(tab));
    const parent = target.parentElement;
    if (target.offsetLeft + target.offsetWidth > parent.scrollLeft + parent.clientWidth || target.offsetLeft < parent.scrollLeft) {
      const relative = target.getBoundingClientRect().left - parent.getBoundingClientRect().left;
      if (relative < 0 || relative + target.offsetWidth > parent.clientWidth) parent.scrollLeft += relative - 10;
    }
  }

  function setBasis(value) {
    if (value === 'mm' && !state.layout.hasMixed) return;
    state.basis = value;
    renderMain();
  }

  function pageInfo() {
    if (state.tab === 's') {
      const active = state.layout.active.length;
      return state.basis === 'mm'
        ? state.config.pairs.length + ' Paare · ' + (state.config.triples?.length ? state.config.triples.length + ' Dreileitergruppen · ' : '') + active + ' aktive Ports' +
          (state.dataset.profile ? ' · ' + state.dataset.profile.taps.map(tap =>
            portName(tap) + ' ' + loadName(state.config.loads[tap])).join(' / ') : '')
        : state.dataset.n + ' physische Ports · ' + active + ' aktiv';
    }
    return {
      ports: 'Portpaare, physische Abschlüsse und Bezugsimpedanzen',
      connector: 'Steckverbinder und Magnetics · Kontakte, Messports, Kanäle',
      time: 'Sprung- und Impulsantwort, TDR-Impedanz, Augendiagramm · aus den Frequenzdaten',
      smith: 'Komplexe Reflexion · normiert auf die gewählte Portreferenz',
      z: 'Eingangs-, Transfer- und Fixture-Impedanz',
      cispr: 'Indirekte Impedanzauswertung · CISPR 17:2011',
      cmc: 'Ersatzschaltbilder: CMC, Übertrager und Einzelbauteile'
    }[state.tab];
  }

  function renderStatus() {
    const text = state.error || (state.busy ? 'Netzwerk wird berechnet …' :
      (state.network?.gaps ? state.network.gaps.toLocaleString(LOCALE) + ' singuläre Punkte im reduzierten Netzwerk. Diese Frequenzen erscheinen als Lücken.' : ''));
    notice('global-status', text);
    $('global-status').classList.toggle('neutral', state.busy);
    const d = state.dataset;
    const scope = (d.demo ? 'Synthetische Beispieldaten' : d.name) + ' · ' + d.n + ' Ports';
    $('status-bar').innerHTML = '<span><span class="status-dot' + (state.error || state.busy ? ' warn' : '') + '"></span>' +
      esc(scope) + '</span><span>' + (state.network?.gaps ? esc((d.freq.length - state.network.gaps).toLocaleString(LOCALE)) + ' gültige Punkte' : 'Berechnung im Browser') + '</span>';
  }

  function chooseDefaults() {
    const modes = currentModes();
    const keys = modes.map(m => m.key);
    const valid = k => keys.includes(k);
    const pick = (k, alt) => valid(k) ? k : alt;
    const first = keys[0] || '', second = keys[1] || first;
    state.smith = pick(state.smith, first);
    for (const type of ['z', 'cispr', 'esb']) {
      const settings = state[type];
      settings.input = pick(settings.input, first);
      settings.output = pick(settings.output, second);
      const needsDistinct = type === 'z' ? settings.method.startsWith('tx') : type === 'esb' || ['series', 'shunt'].includes(settings.method);
      if (needsDistinct && settings.input === settings.output && keys.length > 1) {
        settings.output = keys.find(key => key !== settings.input);
      }
    }
    if (state.curveApply) {
      state.curveApply = false;
      const pref = Prefs.get(deviceType());
      if (pref) {
        for (const basis of ['mm', 'se']) if (pref[basis]) state.sKeys[basis] = pref[basis].slice();
        if (pref.hidden) { state.hiddenTraces.clear(); pref.hidden.forEach(key => state.hiddenTraces.add(key)); }
      }
    }
    const existing = state.sKeys[state.basis];
    if (!existing) state.sKeys[state.basis] = typeTraces(modes, false);
    else {
      const retained = existing.filter(key => key.split(':').every(valid));
      state.sKeys[state.basis] = existing.length && !retained.length ? typeTraces(modes, false) : retained;
    }
    const pairs = state.config.pairs.map(p => p.id);
    if (!pairs.includes(state.pairIn)) state.pairIn = pairs[0] ?? 1;
    if (!pairs.includes(state.pairOut) || state.pairOut === state.pairIn) {
      state.pairOut = pairs.find(id => id !== state.pairIn) ?? 2;
    }
  }

  const traceKey = (row, col) => row.key + ':' + col.key;

  function traceLabel(row, col, parameter = 'S') {
    if (row.type === 'P' && col.type === 'P') return parameter + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
    if (row.type === 'P' || col.type === 'P') return parameter + '(' + row.key + '←' + col.key + ')';
    if (parameter !== 'S') return parameter + '(' + row.key + '←' + col.key + ')';
    // 0/α/β modes of three-conductor groups: S0α·21 = response in the 0 mode of group 2 to the α mode of group 1
    if (MODAL_TYPES.has(row.type) || MODAL_TYPES.has(col.type)) return 'S' + MODAL_SYMBOL[row.type] + MODAL_SYMBOL[col.type] + '·' + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
    return 'S' + (row.type + col.type).toLowerCase() + row.id + (Math.max(row.id, col.id) > 9 ? ',' : '') + col.id;
  }

  // Device type for curve defaults: a name the user gave wins, otherwise the structure and physics decide.
  function deviceType() {
    const name = (state.profile?.name || '').toLowerCase();
    if (/\blan\b|lan-|übertrager|uebertrager|transformer|trafo|magnetics|ethernet|phy/.test(name)) return 'lan';
    if (/cmc|cmb|common|gleichtakt|drossel|choke|rfi/.test(name)) return 'cmc';
    if (state.config.pairs.length >= 2) {
      try { if (state.network) return detectModel().type === 'transformer' ? 'lan' : 'cmc'; } catch { /* fall through */ }
      return state.dataset.n >= 6 ? 'lan' : 'cmc';
    }
    return state.config.pairs.length ? 'pair' : 'se';
  }

  // Standard curves: CMC Sdd21 + Scc21 (extended + Sdc21); LAN transformer Sdd21, Scc21, Sdd11, Sdc21 (extended + Scc11, Sdd22).
  function typeTraces(modes, extended) {
    const diff = modes.filter(m => m.type === 'D'), common = modes.filter(m => m.type === 'C');
    const type = deviceType();
    if (diff.length >= 2 && common.length >= 2 && (type === 'cmc' || type === 'lan')) {
      const [d1, d2] = diff, [c1, c2] = common;
      const keys = type === 'cmc'
        ? [traceKey(d2, d1), traceKey(c2, c1)].concat(extended ? [traceKey(d2, c1)] : [])
        : [traceKey(d2, d1), traceKey(c2, c1), traceKey(d1, d1), traceKey(d2, c1)].concat(extended ? [traceKey(c1, c1), traceKey(d2, d2), traceKey(c2, d1)] : []);
      return keys;
    }
    return defaultTraces(modes);
  }

  const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));

  function rememberCurves() {
    if (!state.dataset || state.dataset.demo) return;
    const type = deviceType();
    Prefs.set(type, { ...(Prefs.get(type) || {}), [state.basis]: state.sKeys[state.basis].slice(), hidden: [...state.hiddenTraces].slice(0, 80) });
  }

  function defaultTraces(modes) {
    if (!modes.length) return [];
    const modal = type => modes.filter(m => m.type === type);
    if (modal('Z').length && !modes.some(m => m.type === 'D')) {
      const [z, a, b] = ['Z', 'A', 'B'].map(modal);
      return z.length >= 2 ? [traceKey(z[1], z[0]), traceKey(a[1], a[0]), traceKey(b[1], b[0]), traceKey(a[1], z[0])] : [traceKey(z[0], z[0]), traceKey(a[0], a[0]), traceKey(b[0], b[0])];
    }
    const diff = modes.filter(m => m.type === 'D'), common = modes.filter(m => m.type === 'C');
    if (diff.length > 1) return [
      traceKey(diff[1], diff[0]), traceKey(common[1], common[0]), traceKey(diff[0], diff[0]), traceKey(common[0], common[0])
    ];
    if (diff.length === 1) return [traceKey(diff[0], diff[0]), traceKey(common[0], common[0])];
    if (modes.length === 1) return [traceKey(modes[0], modes[0])];
    return [traceKey(modes[1], modes[0]), traceKey(modes[0], modes[0]), traceKey(modes[1], modes[1])];
  }

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

