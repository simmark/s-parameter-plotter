  // ---------- Time domain (phase 5) and eye diagram (phase 6) ----------
  const tdBlank = () => ({ row: '', col: '', mode: 'step', window: 'hann', rise: 0, tmax: 0, rate: 1e9, amp: 0.5, order: 7, eye: null, eyeKey: '' });
  const tdModes = () => currentModes();
  function tdSource() {
    const t = state.time, modes = tdModes(), net = state.network;
    if (!net || !modes.length) return null;
    const keys = state.sKeys[state.basis] || [];
    if (!modes.some(m => m.key === t.row) || !modes.some(m => m.key === t.col)) {
      const pick = keys.map(k => k.split(':')).find(([r, c]) => r !== c && modes.some(m => m.key === r) && modes.some(m => m.key === c)) || keys.map(k => k.split(':'))[0] || [modes[Math.min(1, modes.length - 1)].key, modes[0].key];
      [t.row, t.col] = pick;
    }
    const n = modes.length, i = modes.findIndex(m => m.key === t.row), j = modes.findIndex(m => m.key === t.col);
    const mats = state.basis === 'mm' ? net.mm : net.se;
    const values = mats.map(s => s ? [s[2 * (i * n + j)], s[2 * (i * n + j) + 1]] : null);
    return { values, row: modes[i], col: modes[j], ref: modes[i].ref ?? 50, label: traceLabel(modes[i], modes[j]) };
  }
  // Result of the current settings, cached by a key of everything it depends on.
  function tdCompute() {
    const t = state.time, src = tdSource();
    if (!src) return null;
    const key = [state.dataset.name, state.basis, t.row, t.col, t.window, t.rise, state.layout.mmModes.length, state.network.mm.length].join('|');
    if (t.cache?.key === key) return t.cache;
    const freq = state.dataset.freq, sampling = TD.sampling(freq);
    const grid = TD.resample(freq, src.values, { points: 4096 });
    const resp = TD.responses(grid, { window: t.window, rise: t.rise });
    const gd = TD.groupDelay(freq, src.values);
    t.cache = { key, src, sampling, grid, resp, gd, edge: TD.edge(resp.step, resp.dt, resp.t0) };
    t.eye = null;
    return t.cache;
  }
  const tdTime = v => Math.abs(v) >= 1e-6 ? (v * 1e6).toFixed(2) + ' µs' : Math.abs(v) >= 1e-9 ? (v * 1e9).toFixed(3) + ' ns' : (v * 1e12).toFixed(1) + ' ps';
  function tdQuality(c) {
    const { sampling: q, grid, gd } = c, notes = [];
    if (q.kind === 'log') notes.push('Logarithmische Abtastung: Zwischen den Punkten wird linear interpoliert. Feine Strukturen im Zeitbereich (Reflexionen, Resonanzen) können fehlen. Für TDR und Augen eine dichte, lineare Messung verwenden.');
    if (q.kind === 'other') notes.push('Ungleichmäßige Abtastung: Zwischen den Punkten wird linear interpoliert.');
    if (q.points < 201) notes.push('Nur ' + q.points + ' Frequenzpunkte: Das Ergebnis ist eine grobe Näherung.');
    if (gd.guided) notes.push('Phasenschritte über 90° zwischen Punkten: Die Phase wurde über die Laufzeit-Kontinuität entfaltet (Annahme einer glatten Laufzeit).');
    if (grid.dcResidual > 0.3) notes.push('Die zu f → 0 extrapolierte Phase liegt weit von 0° und 180°: Der Gleichanteil ist unsicher.');
    return notes;
  }
  function renderTime() {
    const box = $('time-panel');
    if (!box || state.tab !== 'time') return;
    state.time ??= tdBlank();
    const t = state.time, modes = tdModes();
    if (!state.network) { box.innerHTML = '<p class="inline-notice">Das Netzwerk wird berechnet …</p>'; return; }
    let c, failure = '';
    try { c = tdCompute(); } catch (error) { failure = error.message; }
    if (!c && !failure) { box.innerHTML = ''; return; }
    if (!c) c = { src: tdSource(), failed: true };
    const refl = t.row === t.col;
    if (t.mode === 'tdr' && !refl) t.mode = 'step';
    const opt = (list, value) => list.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    const modeOpts = modes.map(m => [m.key, m.key]);
    const q = c.sampling || TD.sampling(state.dataset.freq), notes = c.failed ? [] : tdQuality(c);
    let html = '<section class="config-card"><div class="config-head"><h2>Zeitbereich</h2><p>Aus den Frequenzdaten: Interpolation auf ein gleichmäßiges Raster, Gleichanteil aus dem tiefsten Punkt extrapoliert, Fenster, inverse FFT. Die Quelle ist ein idealer Sprung, auf Wunsch mit Gauß-Flanke. Kurven der aktuellen Portbasis (' + (state.basis === 'mm' ? 'Mixed Mode' : 'Single Ended') + ').</p></div><div class="config-content"><form id="td-form"><div class="preset-row">' +
      '<label class="control"><span>Antwort (Zeile)</span><select name="row" data-no-i18n>' + opt(modeOpts, t.row) + '</select></label>' +
      '<label class="control"><span>Anregung (Spalte)</span><select name="col" data-no-i18n>' + opt(modeOpts, t.col) + '</select></label>' +
      '<label class="control"><span>Darstellung</span><select name="mode">' + opt([['step', 'Sprungantwort'], ['impulse', 'Impulsantwort'], ...(refl ? [['tdr', 'TDR · Impedanz']] : [])], t.mode) + '</select></label>' +
      '<label class="control"><span>Fenster</span><select name="window">' + opt([['hann', 'Hann'], ['kaiser', 'Kaiser (β = 6)'], ['rect', 'Rechteck (ohne)']], t.window) + '</select></label>' +
      '<label class="control narrow"><span>Flanke 10–90 % [ps]</span><input class="field-input mono" name="rise" inputmode="decimal" value="' + (t.rise ? +(t.rise * 1e12).toPrecision(6) : '') + '" placeholder="keine"></label>' +
      '<label class="control narrow"><span>Zeit bis [ns]</span><input class="field-input mono" name="tmax" inputmode="decimal" value="' + (t.tmax ? +(t.tmax * 1e9).toPrecision(6) : '') + '" placeholder="auto"></label>' +
      '<button class="button primary" type="submit">Anwenden</button></div></form>' +
      (c.failed ? '<p class="inline-notice">' + esc(failure) + '</p></div></section>' : '<dl class="cn-facts"><dt>Kurve</dt><dd data-no-i18n>' + esc(c.src.label) + '</dd><dt>Abtastung</dt><dd data-no-i18n>' + esc(tx({ linear: 'linear', log: 'logarithmisch', other: 'ungleichmäßig' }[q.kind], { linear: 'linear', log: 'logarithmic', other: 'non-uniform' }[q.kind]) + ' · ' + q.points + tx(' Punkte · ', ' points · ') + hz(q.fmin) + ' … ' + hz(q.fmax)) + '</dd>' +
      '<dt>Zeitschritt</dt><dd data-no-i18n>' + esc(tdTime(c.resp.dt) + tx(' (Auflösung ≈ 1/(2·fmax) = ', ' (resolution ≈ 1/(2·fmax) = ') + tdTime(1 / (2 * q.fmax)) + ')') + '</dd><dt>Zeitfenster</dt><dd data-no-i18n>' + esc(tdTime(c.resp.span) + tx(' (periodisch, 1/Δf)', ' (periodic, 1/Δf)')) + '</dd>' +
      (refl ? '' : '<dt>Laufzeit (50 %)</dt><dd data-no-i18n>' + esc((Number.isFinite(c.edge.t50) ? tdTime(c.edge.t50) : '–') + tx(' · Anstieg 10–90 % ', ' · rise 10–90 % ') + (Number.isFinite(c.edge.rise) ? tdTime(c.edge.rise) : '–') + tx(' · Endwert ', ' · final value ') + c.edge.final.toFixed(4)) + '</dd>') + '</dl>' +
      (notes.length ? '<ul class="cn-issues">' + notes.map(x => '<li class="is-warn">' + esc(x) + '</li>').join('') + '</ul>' : '') + '</div></section>');
    if (c.failed) { insertHtml(box, html); return; }
    // chart
    const r = c.resp, half = r.step.length >> 1;
    let end = t.tmax || 0;
    if (!end) { let peak = 0; for (let k = 0; k < half; k++) peak = Math.max(peak, Math.abs(r.h[k])); let last = 0; for (let k = 0; k < half; k++) if (Math.abs(r.h[k]) > 2e-3 * peak) last = k; end = Math.max(r.t0 + (last + 1) * r.dt * 1.3, 20 * r.dt); }
    const xs = [], ys = [], scaleT = end > 2e-6 ? 1e6 : end > 2e-9 ? 1e9 : 1e12, unitT = { 1e6: 'µs', 1e9: 'ns', 1e12: 'ps' }[scaleT];
    const stride = Math.max(1, Math.ceil((end + 0.15 * end) / r.dt / 1500));
    const z = t.mode === 'tdr' ? TD.impedance(r.step, c.src.ref) : null;
    const begin = Math.max(r.t0, -0.15 * end), k0 = Math.max(0, Math.floor((begin - r.t0) / r.dt));
    for (let k = k0; k < half && r.t0 + k * r.dt <= end; k += stride) {
      xs.push((r.t0 + k * r.dt) * scaleT);
      ys.push(t.mode === 'tdr' ? (Number.isFinite(z[k]) ? Math.min(z[k], 1e4) : NaN) : t.mode === 'impulse' ? r.h[k] / r.dt / scaleT : r.step[k]);
    }
    const yLabel = t.mode === 'tdr' ? 'Ω' : t.mode === 'impulse' ? '1/' + unitT : 'V/V';
    const name = { step: lang() === 'en' ? 'Step response ' : 'Sprungantwort ', impulse: lang() === 'en' ? 'Impulse response ' : 'Impulsantwort ', tdr: 'TDR ' }[t.mode] + c.src.label;
    html += '<section class="config-card"><div class="config-head"><h2>Verlauf</h2><p>' + (t.mode === 'tdr' ? 'Impedanz Z = Z₀·(1+ρ)/(1−ρ) aus der Sprungantwort der Reflexion; Z₀ = Bezugsimpedanz der Mode. Ohne Flanke oder Fenster schwingt die Kurve an Sprüngen über (Gibbs).' : 'Sprung der Höhe 1 am Eingang ab t = 0; vor t = 0 liegt ein Achtel des Zeitfensters, damit ein bandbegrenzter Sprung nicht umklappt.') + '</p></div><div class="config-content">' +
      miniChart([{ name, color: '#c4622d', x: xs, y: ys }], { xFmt: v => +v.toPrecision(4) + ' ' + unitT, yFmt: v => +v.toPrecision(4) + '', yLabel, xLabel: (lang() === 'en' ? 'Time' : 'Zeit') + ' [' + unitT + ']', label: name }) + '</div></section>';
    // eye
    if (!refl) {
      const e = t.eye;
      html += '<section class="config-card"><div class="config-head"><h2>Augendiagramm</h2><p>NRZ mit ±Amplitude, periodisches PRBS-Muster, Signal als Überlagerung der Pulsantwort dieser Kurve (lineares, zeitinvariantes Netzwerk). Ohne Jitter, Rauschen, Entzerrung und ohne Maske: keine Normbewertung.</p></div><div class="config-content"><form id="eye-form"><div class="preset-row">' +
        '<label class="control narrow"><span>Bitrate [Gbit/s]</span><input class="field-input mono" name="rate" inputmode="decimal" value="' + +(t.rate / 1e9).toPrecision(6) + '"></label>' +
        '<label class="control narrow"><span>Amplitude ± [V]</span><input class="field-input mono" name="amp" inputmode="decimal" value="' + +t.amp.toPrecision(6) + '"></label>' +
        '<label class="control narrow"><span>Muster</span><select name="order">' + opt([[7, 'PRBS7'], [9, 'PRBS9'], [11, 'PRBS11']], t.order) + '</select></label>' +
        '<button class="button primary" type="submit">Auge berechnen</button></div></form>' +
        (q.fmax < 0.75 * t.rate ? '<p class="inline-notice">Die Messung endet bei ' + esc(hz(q.fmax)) + ', unter 1,5 × der Nyquist-Frequenz (' + esc(hz(t.rate / 2)) + '). Flanken und Auge hängen dann stark von Fenster und Flanke ab.</p>' : '') +
        (e ? '<img class="eye-img" src="' + e.img + '" alt="' + esc((lang() === 'en' ? 'Eye diagram ' : 'Augendiagramm ') + c.src.label) + '" width="760" height="340">' +
          '<dl class="cn-facts"><dt>Augenhöhe</dt><dd data-no-i18n>' + esc(e.height.toFixed(4) + tx(' V (innen, bester Abtastzeitpunkt, PRBS', ' V (inner, best sampling instant, PRBS') + e.order + ')') + '</dd><dt>Augenbreite</dt><dd data-no-i18n>' + esc(e.width.toFixed(2) + ' UI = ' + tdTime(e.width * e.ui)) + '</dd>' +
          '<dt>Schlechtester Fall</dt><dd data-no-i18n>' + esc(e.pda.toFixed(4) + tx(' V (Peak-Distortion: Hauptcursor ', ' V (peak distortion: main cursor ') + e.main.toFixed(4) + tx(' V, Summe |ISI| ', ' V, sum |ISI| ') + e.isi.toFixed(4) + ' V)') + '</dd><dt>Abtastzeitpunkt</dt><dd data-no-i18n>' + esc(tdTime(e.phase * e.ui / e.s) + tx(' gegenüber der Pulsmitte', ' relative to the pulse centre')) + '</dd></dl>' : '') + '</div></section>';
    }
    insertHtml(box, html);
  }
  // Eye picture: all 2-UI traces drawn with low alpha on a canvas (density), the decision phase as a line.
  async function tdEye() {
    const t = state.time, c = tdCompute();
    if (!c) return;
    const ui = 1 / t.rate, opts = { ui, amp: t.amp, order: t.order, s: 32 };
    const viaWorker = computeWorker() ? await computeCall({ type: 'eye', step: c.resp.step, dt: c.resp.dt, opts }).catch(error => { if (error.fallback) return null; throw error; }) : null;
    const e = viaWorker || TD.eye(c.resp.step, c.resp.dt, opts);
    const W = 760, H = 340, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), lim = t.amp * 1.4, sx = x => 30 + x / (2 * e.s) * (W - 40), sy = v => H / 2 - v / lim * (H / 2 - 16);
    g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e8e5dc'; g.lineWidth = 1;
    for (const v of [-t.amp, 0, t.amp]) { g.beginPath(); g.moveTo(30, sy(v)); g.lineTo(W - 10, sy(v)); g.stroke(); }
    for (const x of [0, e.s, 2 * e.s]) { g.beginPath(); g.moveTo(sx(x), 10); g.lineTo(sx(x), H - 10); g.stroke(); }
    g.strokeStyle = 'rgba(196,98,45,0.18)'; g.lineWidth = 1.2;
    const start = e.cursor - e.s;             // centre the eye: decision point of a bit in the middle of the 2-UI window
    for (let k = 0; k < e.L; k++) {
      g.beginPath();
      for (let x = 0; x <= 2 * e.s; x++) { const v = e.wave[(((k * e.s + start + x) % e.total) + e.total) % e.total]; x ? g.lineTo(sx(x), sy(v)) : g.moveTo(sx(x), sy(v)); }
      g.stroke();
    }
    g.strokeStyle = '#2b2a27'; g.setLineDash([4, 4]); const xd = sx(e.s + e.best.phase); g.beginPath(); g.moveTo(xd, 10); g.lineTo(xd, H - 10); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#6b6a64'; g.font = '11px monospace'; g.fillText('+' + t.amp + ' V', 2, sy(t.amp) - 3); g.fillText('−' + t.amp + ' V', 2, sy(-t.amp) + 12); g.fillText('0', 2, sy(0) - 3); g.fillText('2 UI', W - 40, H - 4);
    t.eye = { img: cv.toDataURL('image/png'), height: e.best.height, width: e.width, pda: e.pda, main: e.main, isi: e.isi, phase: e.best.phase, s: e.s, ui, order: t.order };
  }
  function tdApply(form) {
    const t = state.time, d = new FormData(form), num = v => { const x = Number(String(v || '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };
    t.row = String(d.get('row') || t.row); t.col = String(d.get('col') || t.col); t.mode = String(d.get('mode') || 'step'); t.window = String(d.get('window') || 'hann');
    const rise = num(d.get('rise')), tmax = num(d.get('tmax'));
    t.rise = rise > 0 ? rise * 1e-12 : 0; t.tmax = tmax > 0 ? tmax * 1e-9 : 0; t.cache = null; t.eye = null;
    persistSettings(); renderTime();
  }
  function tdEyeApply(form) {
    const t = state.time, d = new FormData(form), num = v => Number(String(v || '').replace(',', '.'));
    const rate = num(d.get('rate')) * 1e9, amp = num(d.get('amp')), order = Number(d.get('order'));
    if (!(rate > 0) || !(amp > 0)) { toast('Bitrate und Amplitude müssen positiv sein.'); return; }
    t.rate = rate; t.amp = amp; t.order = [7, 9, 11].includes(order) ? order : 7;
    form.querySelector('button[type=submit]')?.setAttribute('aria-busy', 'true');
    tdEye().catch(error => toast(error.message)).finally(() => { persistSettings(); if (state.tab === 'time') renderTime(); });
  }

  // Phase 2: crosstalk power sums, delay and skew per channel of the applied mapping.
  function cnCrosstalk() {
    const cn = state.connector, net = state.network, layout = state.layout;
    if (!net || !cn.channels.length) return '';
    const key = state.dataset.name + '|' + layout.mmModes.length + '|' + cn.channels.map(c => c.id + c.channel + c.end).join(',');
    if (cn.xtKey !== key || cn.xtNet !== net) {
      const sig = list => JSON.stringify((list || []).map(c => [c.id, c.channel, c.end, c.plus, c.minus]));
      if (net.xt && sig(net.xtChannels) === sig(cn.channels)) { cn.xt = net.xt; cn.xtKey = key; cn.xtNet = net; }
      else if (computeWorker() && cn.xtPending !== key + '|' + state.job) {
        // not part of the network job (channels applied later): computed in the worker, the card follows when it is done
        const job = state.job; cn.xtPending = key + '|' + job;
        computeCall({ type: 'crosstalk', args: { freq: state.dataset.freq, mm: net.mm, se: net.se, modes: layout.mmModes, active: layout.active, channels: cn.channels } })
          .then(result => { if (job !== state.job || state.network !== net) return; cn.xt = result; cn.xtKey = key; cn.xtNet = net; cn.xtPending = ''; if (state.tab === 'connector') renderConnector(); })
          .catch(() => { cn.xtPending = 'page'; if (state.tab === 'connector') renderConnector(); });
      }
      if (cn.xtKey !== key || cn.xtNet !== net) {
        if (cn.xtPending && cn.xtPending !== 'page') return '<section class="config-card"><div class="config-head"><h2>Übersprechen und Laufzeit</h2><p class="busy-note">Wird im Hintergrund berechnet …</p></div></section>';
        cn.xt = Connector.crosstalk({ freq: state.dataset.freq, mm: net.mm, se: net.se, modes: layout.mmModes, active: layout.active, channels: cn.channels }); cn.xtKey = key; cn.xtNet = net; cn.xtPending = '';
      }
    }
    const res = cn.xt, fs = state.dataset.freq;
    if (!res.length) return '';
    const ps = v => Number.isFinite(v) ? (v * 1e12).toFixed(2) + ' ps' : '–';
    const maxOf = a => { if (!a) return null; let i = -1; a.forEach((v, k) => { if (Number.isFinite(v) && (i < 0 || v > a[i])) i = k; }); return i < 0 ? null : { v: a[i], f: fs[i] }; };
    const cellMax = a => { const m = maxOf(a); return '<td class="mono">' + (m ? m.v.toFixed(1) + ' dB <small>@ ' + esc(hz(m.f)) + '</small>' : '–') + '</td>'; };
    const rows = res.map(r => '<tr><th scope="row">' + cnSpan(r.channel) + '</th><td class="mono">' + ps(r.delay) + '</td><td class="mono">' + ps(r.laneSkew) + '</td><td class="mono">' + ps(r.skew) + '</td>' +
      cellMax(r.psnext1) + cellMax(r.psnext2) + cellMax(r.psfext) + '<td><small>' + (r.worstNext ? cnSpan(r.worstNext.aggressor + ' · ' + r.worstNext.db.toFixed(1) + ' dB') : '–') + '</small></td></tr>').join('');
    const sel = res.find(r => r.channel === cn.xtChannel) || res[0];
    const x = Array.from(fs), series = [
      sel.il && { name: 'SDD21 (IL)', color: '#2b2a27', x, y: sel.il },
      sel.psnext1 && { name: lang() === 'en' ? 'PSNEXT end 1' : 'PSNEXT Ende 1', color: '#c62f4b', x, y: sel.psnext1 },
      sel.psnext2 && { name: lang() === 'en' ? 'PSNEXT end 2' : 'PSNEXT Ende 2', color: '#e07b0f', x, y: sel.psnext2, dash: true },
      sel.psfext && { name: 'PSFEXT', color: '#1f6fb2', x, y: sel.psfext },
      sel.scd && { name: lang() === 'en' ? 'SCD21 (conversion)' : 'SCD21 (Konversion)', color: '#7a4fc2', x, y: sel.scd, dash: true }
    ].filter(Boolean);
    const guided = res.some(r => r.guided > 0);
    return '<section class="config-card"><div class="config-head"><h2>Übersprechen und Laufzeit</h2><p>Leistungssummen über alle anderen Kanäle: PSNEXT am selben Ende, PSFEXT vom Ende 1 zum Ende 2. Laufzeit: Gruppenlaufzeit von SDD21 (Median, wo |SDD21| > −6 dB); Lane: Abweichung vom Mittel aller Kanäle; Skew: τ(+) − τ(−) innerhalb des Paars aus den Single-Ended-Pfaden. Keine Grenzwerte.</p></div><div class="config-content">' +
      (guided ? '<p class="inline-notice">Die Abtastung ist für die Phase zu grob: Mindestens ein Phasenschritt war größer als 90°. Die Phase wurde über die Laufzeit-Kontinuität entfaltet (Annahme einer glatten Laufzeit). Für verlässliche Laufzeiten dichter messen.</p>' : '') +
      '<div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Laufzeit</th><th scope="col">Lane</th><th scope="col">Skew im Paar</th><th scope="col">PSNEXT Ende 1 max.</th><th scope="col">PSNEXT Ende 2 max.</th><th scope="col">PSFEXT max.</th><th scope="col">stärkster Störer</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="preset-row"><label class="control"><span>Kanal im Diagramm</span><select id="cn-xt-channel">' + res.map(r => '<option value="' + esc(r.channel) + '"' + (r === sel ? ' selected' : '') + ' data-no-i18n>' + esc(r.channel) + '</option>').join('') + '</select></label></div>' +
      miniChart(series, { xLog: true, xFmt: v => hz(v), yFmt: v => v.toFixed(0), yLabel: 'dB', yRange: (() => { const all = series.flatMap(s => s.y).filter(Number.isFinite), hi = Math.max(...all), lo = Math.min(...all); return [Math.max(lo, hi - 140), hi + 5]; })(), xLabel: lang() === 'en' ? 'Frequency' : 'Frequenz', label: 'Crosstalk ' + sel.channel }) + '</div></section>';
  }

  function cnChannels() {
    const cn = state.connector, net = state.network, layout = state.layout;
    if (!net || !cn.channels.length) return '';
    const fs = state.dataset.freq, fi = state.markers[0] ?? Math.floor(fs.length / 2), s = net.mm[fi], n = layout.mmModes.length;
    const mode = key => layout.mmModes.findIndex(m => m.key === key);
    const val = (r, c) => { const i = mode(r), j = mode(c); if (!s || i < 0 || j < 0) return NaN; const k = 2 * (i * n + j); return 20 * Math.log10(Math.max(Math.hypot(s[k], s[k + 1]), 1e-12)); };
    const groups = new Map(); for (const c of cn.channels) { const k = c.channel ?? c.pair; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const rows = [...groups.values()].map(list => {
      const a = list.find(c => (c.end ?? c.side) === 1) || list[0], b = list.find(c => c !== a);
      const keys = b ? ['D' + b.id + ':D' + a.id, 'D' + a.id + ':D' + a.id, 'D' + b.id + ':D' + b.id, 'C' + b.id + ':D' + a.id] : ['D' + a.id + ':D' + a.id];
      const cell = v => '<td class="mono">' + (Number.isFinite(v) ? v.toFixed(2) + ' dB' : '–') + '</td>';
      const pa = cnProfile().pairs.find(x => x.id === a.pair), title = pa?.channel ? (lang() === 'en' ? 'Channel ' : 'Kanal ') + pa.channel + ' · ' + a.pair + (b ? ' → ' + b.pair : '') : cnT(pa, 'name') || a.pair;
      return '<tr><th scope="row">' + cnSpan(title) + '</th><td class="mono">D' + a.id + (b ? ' → D' + b.id : '') + '</td>' +
        (b ? cell(val('D' + b.id, 'D' + a.id)) + cell(val('D' + a.id, 'D' + a.id)) + cell(val('C' + b.id, 'D' + a.id)) : cell(NaN) + cell(val('D' + a.id, 'D' + a.id)) + cell(NaN)) +
        '<td>' + actionButton('Kurven', 'cn-curves', keys.join(','), 'quiet-button') + '</td></tr>';
    }).join('');
    return '<section class="config-card"><div class="config-head"><h2>Kanäle</h2><p>Werte bei ' + esc(hz(fs[fi])) + ' (Marker 1). SDD21: Einfügedämpfung durch den Connector, SDD11: Reflexion, SCD21: Umwandlung Differential → Gleichtakt. Keine Grenzwerte: Für eine Konformitätsaussage fehlen Normversion und Messbedingungen.</p></div>' +
      '<div class="config-content"><div class="table-scroll"><table class="ports-table"><thead><tr><th scope="col">Kanal</th><th scope="col">Moden</th><th scope="col">SDD21</th><th scope="col">SDD11</th><th scope="col">SCD21</th><th scope="col"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div></section>';
  }

  function renderConnector() {
    const box = $('connector-panel');
    if (!box || state.tab !== 'connector') return;
    cnEnsure();
    const cn = state.connector, n = state.dataset.n, p = cnProfile();
    if (!cn.templates) cnLoadTemplates();
    const options = cnAll().map(x => '<option value="' + x.id + '"' + (x.id === cn.profile ? ' selected' : '') + (Connector.portCount(x) !== n ? ' disabled' : '') + ' data-no-i18n>' +
      esc(cnT(x, 'name') + (Connector.portCount(x) !== n ? (lang() === 'en' ? ' – expects ' : ' – erwartet ') + Connector.portCount(x) + ' Ports' : '')) + '</option>').join('');
    let html = '<section class="config-card"><div class="config-head"><h2>Connector-Profil</h2><p>Wähle, was gemessen wurde. Ein Profil ist eine Interpretation der ' + n + ' Messports; die Software prüft, ob die Messdaten dazu passen. Die Originaldaten bleiben unverändert.</p></div>' +
      '<div class="config-content"><div class="preset-row"><label class="control"><span>Profil</span><select id="cn-profile"><option value="">– kein Profil –</option>' + options + '</select></label>' +
      (p ? '<label class="control"><span>Betriebsart</span><select id="cn-config">' + p.configurations.map(c => '<option value="' + c.id + '"' + (c.id === cn.configuration ? ' selected' : '') + ' data-no-i18n>' + esc(cnT(c, 'name')) + '</option>').join('') + '</select></label>' : '') + '</div>' +
      (!cnMatches().length ? '<p class="inline-notice">Kein Profil passt zu ' + n + ' Ports. Unterstützt: USB-C mit 48 Ports (24 Kontakte, zwei Seiten), RJ45 mit 16 Ports, LAN-Magnetics mit 4, 6 oder 12 Ports.</p>' : '') +
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
    const inspector = selContact ? '<div class="cn-inspector"><h3 data-no-i18n>' + esc(selContact.id + ' · ' + selContact.label) + '</h3><p><small>' + (selContact.normative !== selContact.label ? '<span>Normativ:</span> ' + cnSpan(cnT(selContact, 'normative')) + ' · ' : '') + '<span>' + esc(CN_ROLE[selContact.role] || selContact.role) + '</span>' + (selNode.side ? ' · ' + cnSpan(cnSide(p, selNode.side)) : '') + '</small></p>' +
      '<label class="control"><span>Messport</span><select id="cn-port">' + portOptions + '</select></label>' +
      (selPair ? '<div class="preset-row">' + (selNode.side ? actionButton('Polarität von ' + selPair.id + ' tauschen · nur ' + cnSide(p, selNode.side), 'cn-swap', selPair.id + '|' + selNode.side, 'button') +
        actionButton('… beide Seiten', 'cn-swap', selPair.id, 'button') : actionButton('Polarität von ' + selPair.id + ' tauschen', 'cn-swap', selPair.id, 'button')) +
        '<label class="control narrow"><span>Paar tauschen mit</span><select id="cn-move"><option value="">–</option>' + p.pairs.filter(x => x.id !== selPair.id).map(x => '<option value="' + x.id + '" data-no-i18n>' + esc(cnT(x, 'name')) + '</option>').join('') + '</select></label></div>' : '') + '</div>'
      : '<div class="cn-inspector"><p class="note">Kontakt anklicken (oder mit Tab und Enter wählen), dann den Messport zuweisen. ✓ Durchgang durch die Messung bestätigt · ? nicht bestätigt · ! doppelt belegt.</p></div>';
    const drawings = p.measurement.kind === 'thru' ? p.measurement.sides.map(s => cnDrawing(p, s, portOf, verdict)).join('') : cnDrawing(p, null, portOf, verdict);
    html += '<section class="config-card cn-view"><div class="config-head"><h2>Pinansicht</h2><p>' + cnSpan(cnT(p, 'view') + '.') + ' <span>Farben: Differentialpaare; grau: Masse; braun: Versorgung.</span></p></div><div class="config-content">' +
      '<div class="preset-row cn-zoombar">' + iconButton('Vergrößern', 'cn-zoom', 'in', 'plus') + actionButton('−', 'cn-zoom', 'out', 'icon-button', '', ' title="Verkleinern" aria-label="Verkleinern"') + actionButton('Ansicht zurücksetzen', 'cn-zoom', 'reset', 'quiet-button') + '</div>' +
      '<div class="cn-drawings">' + drawings + '</div>' + inspector + '</div></section>';
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
      '<fieldset class="cn-pairs"><legend><span>Paare</span>' + (conf.note ? ' · ' + cnSpan(cnT(conf, 'note')) : '') + '</legend>' + p.pairs.map(x => '<label class="cn-check"><input type="checkbox" name="pair-' + x.id + '"' + (conf.pairs.includes(x.id) && mapped.has(x.id) ? ' checked' : '') + (mapped.has(x.id) ? '' : ' disabled') + '> ' + cnSpan(cnT(x, 'name')) + (mapped.has(x.id) ? '' : ' <small>(nicht zugeordnet)</small>') + '</label>').join('') + '</fieldset>' +
      '<div class="preset-row"><label class="control"><span>Übrige Ports</span><select name="others"><option value="match"' + (applied.others === 'match' ? ' selected' : '') + '>angepasst abschließen (Bezugsimpedanz)</option><option value="open"' + (applied.others === 'open' ? ' selected' : '') + '>offen</option><option value="active"' + (applied.others === 'active' ? ' selected' : '') + '>aktiv lassen (Single Ended)</option></select></label>' +
      (p.contacts.some(c => c.role === 'tap') ? '<label class="control"><span>Mittelanzapfungen</span><select name="taps"><option value="open"' + (applied.taps === 'open' ? ' selected' : '') + '>offen</option><option value="match"' + (applied.taps === 'match' ? ' selected' : '') + '>angepasst abschließen</option><option value="active"' + (applied.taps === 'active' ? ' selected' : '') + '>aktiv lassen</option></select></label>' : '') +
      '<button class="button primary" type="submit">In Analyse übernehmen</button></div></form>' +
      '<div class="preset-row">' + actionButton('Als Vorlage speichern', 'cn-save', '', 'button') + actionButton('Zuordnung exportieren', 'cn-export', '', 'button') + actionButton('Zuordnung importieren', 'cn-import', '', 'button') +
      ((cn.templates || []).length ? '<label class="control"><span>Gespeicherte Vorlage</span><select id="cn-template"><option value="">–</option>' + cn.templates.map((t, i) => '<option value="' + i + '"' + (t.profile.id !== p.id || t.ports !== n ? ' disabled' : '') + '>' + esc(t.name + ' · ' + t.ports + ' Ports') + '</option>').join('') + '</select></label>' : '') + '</div></div></section>';
    html += cnChannels() + cnCrosstalk() + cnMatrix();
    insertHtml(box, html);
    cnFillIdle();
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

  function renderMain() {
    if (!state.dataset || !state.layout) return;
    chooseDefaults();
    persistSettings();
    tabs.forEach(tab => {
      const current = tab.dataset.value === tabButton(state.tab);
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
    });
    $('panel').setAttribute('aria-labelledby', 'tab-' + tabButton(state.tab));
    $('page-title').textContent = TABS[state.tab];
    $('page-context').textContent = pageInfo();
    const showBasis = ['s', 'smith', 'z'].includes(state.tab) || (state.tab === 'cispr' && state.cispr.method !== 'four') ||
      (state.tab === 'cmc' && ['series', 'shunt'].includes(esbModel()));
    $('basis-control').innerHTML = showBasis
      ? '<div class="segment basis-segment" aria-label="Portbasis">' +
        '<button type="button" data-action="basis" data-value="se"' + pressed(state.basis === 'se') + '><span class="basis-long">Single Ended</span><span class="basis-short">SE</span></button>' +
        '<button type="button" data-action="basis" data-value="mm"' + pressed(state.basis === 'mm') + disabled(!state.layout.hasMixed) +
          (!state.layout.hasMixed ? ' title="Lege zuerst ein Portpaar an"' : ' title="Differential (D), Gleichtakt (C) und Modenkonversion"') +
          '><span class="basis-long">Mixed Mode</span><span class="basis-short">MM</span><span class="mode-dots" aria-hidden="true"><i style="background:var(--mode-d)"></i><i style="background:var(--mode-c)"></i><i style="background:var(--mode-dc)"></i><i style="background:var(--mode-cd)"></i></span></button></div>'
      : '';
    const isConfig = state.tab === 'ports', isConnector = state.tab === 'connector', isTime = state.tab === 'time';
    $('config-panel').hidden = !isConfig;
    $('connector-panel').hidden = !isConnector;
    $('time-panel').hidden = !isTime;
    $('analysis-panel').hidden = isConfig || isConnector || isTime;
    renderStatus();
    if (isConfig || isConnector || isTime) {
      state.view = null;
      Plot.set(null);
      isConfig ? renderConfig() : isConnector ? renderConnector() : renderTime();
    } else {
      renderControls();
      renderAnalysis();
    }
  }

  function render() {
    renderSidebar();
    renderMain();
  }

  function controlsPairs() {
    const pairs = state.config.pairs;
    if (pairs.length < 2) return '';
    const pairOptions = pairs.map(p => [p.id, 'Paar ' + p.id + ' · ' + portName(p.p) + '/' + portName(p.q)]);
    return selectField('Eingang', 'pair-in', pairOptions, state.pairIn) +
      selectField('Ausgang', 'pair-out', pairOptions, state.pairOut);
  }

  function renderControls() {
    let html = '';
    if (state.tab === 's') {
      html = selectField('Darstellung', 's-format', S_FORMATS, state.sFormat) +
        actionButton('Ports zuordnen', 'tab', 'ports', 'button', 'network');
    } else if (state.tab === 'smith') {
      html = selectField('Reflexion an', 'smith-port', modeOptions(), state.smith);
    } else if (state.tab === 'z') {
      const settings = state.z;
      const matrixMethod = ['zmatrix', 'ymatrix'].includes(settings.method);
      const formats = settings.method === 'ymatrix' ? Z_FORMATS.slice(0, 4) : Z_FORMATS;
      html = selectField('Auswertung', 'z-eval', Z_EVALUATIONS, 'z:' + settings.method) +
        selectField(settings.method === 'reflection' ? 'Port / Mode' : matrixMethod ? 'Anregung' : 'Eingang', 'z-input', modeOptions(), settings.input) +
        (settings.method !== 'reflection' ? selectField(matrixMethod ? 'Antwort' : 'Ausgang', 'z-output', modeOptions(), settings.output) : '') +
        selectField('Darstellung', 'z-format', formats, settings.format);
    } else if (state.tab === 'cispr') {
      const settings = state.cispr;
      html = selectField('Auswertung', 'z-eval', Z_EVALUATIONS, 'cispr:' + settings.method) +
        (settings.method === 'four' ? controlsPairs() :
          selectField(settings.method === 'one' ? 'Port / Mode' : 'Eingang', 'cispr-input', modeOptions(), settings.input) +
          (settings.method === 'one' ? '' : selectField('Ausgang', 'cispr-output', modeOptions(), settings.output))) +
        selectField('Darstellung', 'cispr-format', Z_FORMATS, settings.format);
    } else if (state.tab === 'cmc') {
      const model = esbModel();
      const level = state.esb.model === 'auto' && ['series', 'shunt'].includes(model) ? detectModel().level : null;
      const autoLabel = 'Automatisch · ' + (model === 'transformer' ? 'Übertrager' : model === 'cmc' ? 'CMC' : model === 'shunt' ? 'kapazitiv' : 'induktiv') + (level ? ' · ' + LEVEL_NAME[level] : '');
      html = selectField('Modell', 'esb-model', ESB_MODELS.map(([key, label]) => [key, key === 'auto' ? autoLabel : label]), state.esb.model);
      if (model === 'transformer') {
        html += controlsPairs() + selectField('Darstellung', 'esb-tformat', TRANSFORMER_FORMATS, state.esb.tFormat) +
          '<form class="fit-fields" id="eval-form">' + textField('Auswertung bei', 'eval', freqInput(state.esb.evalFreq)) + '<button class="button" type="submit">Anwenden</button>' +
          actionButton('= Marker', 'eval-marker', '', 'button', '', ' title="Die Frequenz des aktiven Markers als Auswertefrequenz für OCL, n und k übernehmen"') + '</form>';
      } else if (model === 'series' || model === 'shunt') {
        const fixture = esbFixture(model);
        html += selectField('Fixture', 'esb-fixture', ESB_FIXTURES.map(([key, label]) => [key, key === 'auto' ? 'Automatisch · ' + FIXTURE_NAME[fixture] : label]), state.esb.fixture || 'auto') +
          selectField(fixture === 'reflection' ? 'Port / Mode' : 'Eingang', 'esb-input', modeOptions(), state.esb.input) +
          (fixture === 'reflection' ? '' : selectField('Ausgang', 'esb-output', modeOptions(), state.esb.output)) +
          selectField('Darstellung', 'esb-eformat', model === 'series' ? SERIES_FORMATS : SHUNT_FORMATS, state.esb.eFormat);
      } else {
        html += controlsPairs() + selectField('Darstellung', 'cmc-format', [['cap', 'Kapazitäten'], ['ind', 'Induktivitäten'], ['zesb', 'Impedanz · Ersatzschaltbild (Editor)'], ['zfit', 'Impedanz · je Mode bis 2. Resonanz']], state.cmc.format);
      }
      if (model === 'cmc' && state.config.pairs.length >= 2) {
        html += '<form class="fit-fields" id="fit-form">' + textField('Fit ab', 'start', freqInput(state.cmc.band[0])) +
          textField('Fit bis', 'stop', freqInput(state.cmc.band[1])) + '<button class="button" type="submit">Fit anwenden</button></form>';
      }
    }
    const compared = state.compare.ids.filter(id => id !== session.current && compareCache.get(id)?.ctx).length;
    if (compared) {
      html += '<div class="compare-chip"><span>Vergleich · ' + (compared + 1) + ' Dateien</span>' +
        actionButton('Δ zu ⟨A⟩', 'compare-delta', '', 'button', '', pressed(state.compare.delta) + ' title="Differenz zur geöffneten Datei anzeigen"') +
        iconButton('Vergleich beenden', 'compare-clear', '', 'close') + '</div>';
    }
    insertHtml($('view-controls'), html);
  }

  function cache(key, make) {
    if (state.memo.has(key)) return state.memo.get(key);
    const result = make();
    if (state.memo.size >= 35) state.memo.delete(state.memo.keys().next().value);
    state.memo.set(key, result);
    return result;
  }

  function createComplex(compute) {
    const f = state.dataset.freq;
    const values = new Float64Array(f.length * 2).fill(NaN);
    for (let i = 0; i < f.length; i++) {
      const value = compute(i, f[i]);
      if (!value) continue;
      values[2 * i] = value[0];
      values[2 * i + 1] = value[1];
    }
    return values;
  }

  function extractS(view, row, col, basis = state.basis) {
    return cache('s:' + basis + ':' + row + ':' + col, () =>
      createComplex(i => view.samples[i] && RF.get(view.samples[i], view.modes.length, row, col)));
  }

  function unwrap(raw) {
    const phase = new Float64Array(raw.length / 2).fill(NaN);
    let last = NaN, offset = 0;
    for (let i = 0; i < phase.length; i++) {
      const c = complexAt(raw, i);
      if (!c.every(Number.isFinite) || RF.abs(c) === 0) {
        last = NaN; offset = 0; continue;
      }
      const value = Math.atan2(c[1], c[0]);
      if (Number.isFinite(last)) {
        const d = value - last;
        if (d > Math.PI) offset -= RF.TAU;
        if (d < -Math.PI) offset += RF.TAU;
      }
      phase[i] = value + offset;
      last = value;
    }
    return phase;
  }

  function delay(raw) {
    const phase = unwrap(raw), f = state.dataset.freq;
    return Float64Array.from(phase, (p, i) => {
      if (!Number.isFinite(p) || RF.abs(complexAt(raw, i)) < 1e-14) return NaN;
      const h1 = f[i] - f[i - 1], h2 = f[i + 1] - f[i];
      const dp = (p - phase[i - 1]) / h1, dn = (phase[i + 1] - p) / h2;
      const pValid = Number.isFinite(dp) && RF.abs(complexAt(raw, i - 1)) >= 1e-14;
      const nValid = Number.isFinite(dn) && RF.abs(complexAt(raw, i + 1)) >= 1e-14;
      const slope = pValid && nValid ? (h2 * dp + h1 * dn) / (h1 + h2) : pValid ? dp : nValid ? dn : NaN;
      return -slope * 1e9 / RF.TAU;
    });
  }

  function scalarize(raw, format) {
    if (format === 'unwrap') return Float64Array.from(unwrap(raw), p => p / RF.RAD);
    if (format === 'delay') return delay(raw);
    const fs = state.dataset.freq;
    return Float64Array.from(fs, (f, i) => {
      const z = complexAt(raw, i);
      if (!z.every(Number.isFinite)) return NaN;
      const [re, x] = z;
      if (format === 'db') return 20 * Math.log10(RF.abs(z));
      if (format === 'mag') return RF.abs(z);
      if (format === 're') return re;
      if (format === 'im') return x;
      if (format === 'phase') return RF.abs(z) ? Math.atan2(x, re) / RF.RAD : NaN;
      if (format === 'q') return re > 0 ? Math.abs(x) / re : NaN;
      if (f <= 0) return NaN;
      // Equivalent values keep their sign: above a resonance an "inductance" turns negative (the part is capacitive there).
      // Hiding that would cut resonances out of the curve.
      if (format === 'ls') return x / omega(f);
      if (format === 'cs') return x ? -1 / (omega(f) * x) : NaN;
      const b = RF.div([1, 0], z)?.[1];
      if (!Number.isFinite(b)) return NaN;
      if (format === 'lp') return b ? -1 / (omega(f) * b) : NaN;
      return b / omega(f);
    });
  }

  function baseUnit(format, native = '') {
    return {
      db: 'dB', mag: native, re: native, im: native, phase: '°', unwrap: '°', delay: 'ns',
      ls: 'H', lp: 'H', cs: 'F', cp: 'F', q: ''
    }[format];
  }

  function axisLabel(format, unit, quantity = '') {
    const title = quantity || ({
      db: 'Betrag', mag: 'Betrag', re: 'Realteil', im: 'Imaginärteil', phase: 'Phase',
      unwrap: 'Phase', delay: 'Gruppenlaufzeit', ls: 'L Serie', cs: 'C Serie', lp: 'L Parallel', cp: 'C Parallel', q: 'Güte Q'
    }[format]);
    return title + (unit ? ' [' + unit + ']' : '');
  }

  function engineeringScale(traces, base) {
    if (!['F', 'H', 'S'].includes(base)) return [1, base];
    const sample = [];
    for (const trace of traces) {
      const skip = Math.max(1, Math.ceil(trace.values.length / 180));
      for (let i = 0; i < trace.values.length; i += skip) {
        const v = Math.abs(trace.values[i]);
        if (Number.isFinite(v) && v > 0) sample.push(v);
      }
    }
    sample.sort((a, b) => a - b);
    const fallback = base === 'F' ? 1e-12 : base === 'H' ? 1e-6 : 1e-3;
    const magnitude = sample[Math.floor(sample.length / 2)] || fallback;
    const scale = [[1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']]
      .find(([value]) => magnitude >= value * (1 - 1e-10)) || [1e-15, 'f'];
    return [scale[0], scale[1] + base];
  }

  function rawTrace(key, label, color, complex, format) {
    const values = scalarize(complex, format);
    return { key, label, color, complex, values, visible: !state.hiddenTraces.has(key) };
  }

  function withUnits(traces, format, native = '', label = '') {
    const [factor, unit] = engineeringScale(traces, baseUnit(format, native));
    if (factor !== 1) {
      traces.forEach(trace => { trace.values = Float64Array.from(trace.values, v => v / factor); });
    }
    return { traces, unit, yLabel: axisLabel(format, unit, label), zeroBaseline: format === 'mag', signed: ['ls', 'cs', 'lp', 'cp'].includes(format), positive: format === 'q' };
  }

  function sView() {
    const view = getView();
    const indexes = new Map(view.modes.map((mode, i) => [mode.key, i]));
    const used = {};
    const traces = state.sKeys[state.basis].map((key, i) => {
      const [row, col] = key.split(':').map(k => indexes.get(k));
      const data = extractS(view, row, col);
      const r = view.modes[row], c = view.modes[col];
      const family = traceFamily(r, c);
      const ramp = MODE_PALETTE[family];
      const color = ramp ? ramp[(used[family] = (used[family] ?? -1) + 1) % ramp.length] : COLORS[i];
      const trace = rawTrace('s:' + state.basis + ':' + key, traceLabel(r, c), color, data, state.sFormat);
      trace.family = family;
      trace.dash = row === col ? REFLECTION_DASH : null;
      return trace;
    });
    return {
      ...withUnits(traces, state.sFormat), title: 'Frequenzgang', caption: 'Zeile = Antwort · Spalte = Anregung',
      format: state.sFormat, floor: state.sFormat === 'db' ? -180 : null, native: '',
      hint: state.sFormat === 'db' ? 'Darstellungsgrenze −180 dB' : ''
    };
  }

  function smithView() {
    const view = getView(), i = view.modes.findIndex(m => m.key === state.smith);
    const mode = view.modes[i];
    const data = extractS(view, i, i);
    const trace = rawTrace('smith:' + mode.key, traceLabel(mode, mode), mode.type === 'C' ? MODE_PALETTE.cc[0] : mode.type === 'D' ? MODE_PALETTE.dd[0] : COLORS[0], data, 'mag');
    return {
      traces: [trace], title: 'Smith-Diagramm', caption: 'Normierung · ' + modeLabel(mode),
      format: 'mag', unit: '', native: '', smith: true, smithRef: mode.ref
    };
  }

  function zView() {
    const settings = state.z, view = getView();
    const a = view.modes.findIndex(m => m.key === settings.input), b = view.modes.findIndex(m => m.key === settings.output);
    const mode = view.modes[a];
    const key = ['z', state.basis, settings.method, a, b].join(':');
    const modePair = settings.method.startsWith('tx');
    if (modePair && (a === b || view.modes.length < 2)) return { empty: 'Für die Transmissionsimpedanz werden zwei verschiedene aktive Ports oder Moden benötigt.' };
    const native = settings.method === 'ymatrix' ? 'S' : 'Ω';
    const data = cache(key, () => createComplex(i => {
      const s = view.samples[i];
      if (!s) return null;
      if (settings.method === 'reflection') return RF.reflection(RF.get(s, view.modes.length, a, a), mode.ref);
      if (modePair) {
        const result = RF.twoPort(s, view.modes, a, b);
        return result.s && RF.transmission(RF.get(result.s, 2, 1, 0), result.ref, settings.method === 'txseries' ? 'series' : 'shunt');
      }
      const m = RF.toZY(s, view.modes.map(x => x.ref), settings.method === 'zmatrix' ? 'Z' : 'Y');
      return m && RF.get(m, view.modes.length, b, a);
    }));
    let label, caption, note;
    if (settings.method === 'reflection') {
      label = 'Zin ' + mode.key;
      caption = 'Reflexion an ' + modeLabel(mode);
      note = 'Übrige aktive Ports und Moden sind mit ihren jeweiligen Bezugsimpedanzen abgeschlossen.';
    } else if (modePair) {
      const r1 = mode.ref, r2 = view.modes[b].ref;
      const ref = r1 === r2 ? r1 : Math.sqrt(r1) * Math.sqrt(r2);
      label = settings.method === 'txseries' ? 'Z Serie' : 'Z Shunt';
      caption = mode.key + ' → ' + view.modes[b].key + ' · Z₀ ' + display(ref) + ' Ω';
      note = 'Diese Transmissionsformel gilt für die gewählte reine Serien- oder Shunt-Fixture. Übrige aktive Ports und Moden sind angepasst.';
      if (mode.type !== view.modes[b].type) note += ' Die beiden ausgewählten Kanäle haben unterschiedliche Moden.';
    } else {
      label = traceLabel(view.modes[b], mode, native === 'S' ? 'Y' : 'Z');
      caption = mode.key + ' → ' + view.modes[b].key;
      note = native === 'S'
        ? 'Die Y-Matrix gibt die Kurzschluss-Admittanzen des bereits mit den konfigurierten Lasten reduzierten Netzwerks an.'
        : 'Die Z-Matrix gibt die Leerlaufimpedanzen des bereits mit den konfigurierten Lasten reduzierten Netzwerks an.';
    }
    const trace = rawTrace(key, label, COLORS[0], data, settings.format);
    return {
      ...withUnits([trace], settings.format, native), native, title: native === 'S' ? 'Admittanz' : 'Impedanzverlauf',
      caption, format: settings.format, details: () => '<p class="note">' + esc(note) + ' ' + help + '</p>'
    };
  }

  function selectedPairs() {
    const pairs = state.config.pairs;
    const a = pairs.find(p => p.id === state.pairIn), b = pairs.find(p => p.id === state.pairOut);
    return a && b && a !== b ? [a, b] : null;
  }

  function modalCispr(pairs) {
    const [a, b] = pairs;
    const view = getView('mm');
    const lookup = new Map(view.modes.map((mode, index) => [mode.key, index]));
    const modes = ['C', 'D'].map(type => ({
      type, a: lookup.get(type + a.id), b: lookup.get(type + b.id)
    }));
    return cache('modal-cispr:' + a.id + ':' + b.id, () => {
      const blocks = modes.map(mode => Array.from(state.dataset.freq, (_, i) => {
        if (!view.samples[i]) return null;
        const two = RF.twoPort(view.samples[i], view.modes, mode.a, mode.b);
        return RF.cispr(two.s, two.ref);
      }));
      const conversion = i => {
        const s = view.samples[i];
        if (!s) return NaN;
        const c = [modes[0].a, modes[0].b], d = [modes[1].a, modes[1].b];
        let max = 0;
        for (const ic of c) {
          for (const id of d) {
            max = Math.max(max, RF.abs(RF.get(s, view.modes.length, ic, id)), RF.abs(RF.get(s, view.modes.length, id, ic)));
          }
        }
        return 20 * Math.log10(max);
      };
      return { blocks, conversion };
    });
  }

  function diagnosticsTable(items, conversion) {
    const f = state.dataset.freq[state.markers[state.activeMarker]];
    const rows = items.map(({ label, value, showCondition }) => '<tr><td>' + esc(label) + '</td><td>' +
      esc(valueWith(value?.ref, 'Ω')) + '</td><td>' + esc(value ? valueWith(20 * Math.log10(RF.abs(value.t)), 'dB') : '—') +
      '</td><td>' + esc(display(value?.reflectionDelta)) + '</td><td>' + esc(display(value?.transmissionDelta)) + '</td>' +
      (showCondition ? '<td>' + esc(display(value?.condition)) + '</td>' : '') + '</tr>').join('');
    return '<section class="detail-card"><div class="fit-summary"><h3>Symmetrie am Marker</h3><small>' + esc(hz(f)) +
      '</small></div><div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Auswertung</th>' +
      '<th scope="col">Z₀</th><th scope="col">|T|</th><th scope="col">|S₁₁ − S₂₂|</th><th scope="col">|S₂₁ − S₁₂|</th>' +
      (items[0].showCondition ? '<th scope="col">Fixture-Bedingung</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (conversion === undefined ? '' : '<p class="diagnostics">Max. CM↔DM-Konversion im gewählten Vierport · ' +
        esc(valueWith(conversion, 'dB')) + '</p>') + '</section>';
  }

  function cisprView() {
    const settings = state.cispr;
    let traces, caption, details;
    const fmt = settings.format;
    if (settings.method === 'four') {
      const pairs = selectedPairs();
      if (!pairs) return { empty: 'Definiere zwei Portpaare als Eingang und Ausgang für CM und DM.', needsPairs: true };
      const modal = modalCispr(pairs);
      const names = ['Z CM', 'Z DM'];
      traces = modal.blocks.map((block, i) => rawTrace('cispr:four:' + i, names[i], COLORS[1 - i],
        cache('cispr:data:' + pairs.map(p => p.id).join(':') + ':' + i, () => createComplex(j => block[j]?.z)), fmt));
      caption = '§ 6.3.1.4 · Paar ' + pairs[0].id + ' → Paar ' + pairs[1].id;
      details = () => {
        const i = state.markers[state.activeMarker];
        const items = modal.blocks.map((block, j) => ({ label: names[j], value: block[i] }));
        return diagnosticsTable(items, modal.conversion(i)) +
          '<p class="note">Die Vierportformel setzt eine hinreichend symmetrische Struktur und Messdaten an den DUT-Referenzebenen voraus. ' + help + '</p>';
      };
    } else {
      const view = getView();
      const a = view.modes.findIndex(m => m.key === settings.input);
      const b = view.modes.findIndex(m => m.key === settings.output);
      const first = view.modes[a];
      if (settings.method === 'one') {
        const key = 'cispr:one:' + state.basis + ':' + a;
        const data = cache(key, () => createComplex(i => view.samples[i] &&
          RF.reflection(RF.get(view.samples[i], view.modes.length, a, a), first.ref)));
        traces = [rawTrace(key, 'Z ' + first.key, COLORS[0], data, fmt)];
        caption = '§ 6.3.1.2 · ' + modeLabel(first);
        details = () => '<p class="note">Eintor-Auswertung aus Reflexion an der DUT-Referenzebene. ' + help + '</p>';
      } else {
        if (a === b || view.modes.length < 2) return { empty: 'Wähle zwei verschiedene aktive Ports oder Moden für den Zweitoraufbau.' };
        const key = ['cispr', state.basis, settings.method, a, b].join(':');
        const blocks = cache(key, () => Array.from(state.dataset.freq, (_, i) => {
          if (!view.samples[i]) return null;
          const result = RF.twoPort(view.samples[i], view.modes, a, b);
          return RF.cispr(result.s, result.ref, settings.method);
        }));
        const label = settings.method === 'series' ? 'Z Serie' : 'Z Shunt';
        traces = [rawTrace(key, label, COLORS[0], cache(key + ':data', () => createComplex(i => blocks[i]?.z)), fmt)];
        caption = '§ 6.3.1.3 · ' + first.key + ' → ' + view.modes[b].key;
        details = () => diagnosticsTable([{ label, value: blocks[state.markers[state.activeMarker]], showCondition: true }]) +
          '<p class="note">Bei geeigneter Fixture sollte die angezeigte Bedingungszahl deutlich kleiner als 1 sein. ' + help + '</p>';
      }
    }
    return { ...withUnits(traces, fmt, 'Ω'), native: 'Ω', format: fmt, title: 'Impedanz nach CISPR 17', caption, details };
  }

  function naturalData(pairs) {
    const view = getView('se');
    const active = state.layout.active;
    const map = pairs.flatMap(pair => [active.indexOf(pair.p), active.indexOf(pair.q)]);
    return cache('natural:' + map.join(':'), () => Array.from(state.dataset.freq, (f, i) =>
      view.samples[i] && RF.cmcNatural(RF.submatrix(view.samples[i], active.length, map), map.map(p => view.modes[p].ref), f)));
  }

  function metric(label, value, unit) {
    return '<div class="metric"><strong>' + esc(valueWith(value, unit)) + '</strong><span>' + esc(label) + '</span></div>';
  }

  // First crossing of Im(Y) from inductive (negative) to capacitive (positive), interpolated on a log axis.
  function selfResonance(natural, key) {
    const fs = state.dataset.freq;
    let prev = null;
    for (let i = 0; i < fs.length; i++) {
      const b = natural[i]?.[key]?.[1];
      if (!(fs[i] > 0) || !Number.isFinite(b)) { prev = null; continue; }
      if (prev && prev.b < 0 && b >= 0) {
        const t = -prev.b / (b - prev.b);
        return Math.exp(Math.log(prev.f) + t * (Math.log(fs[i]) - Math.log(prev.f)));
      }
      prev = { f: fs[i], b };
    }
    return NaN;
  }

  function fitDetails(fit, band, resonance = {}) {
    const unphysical = [fit.cw, fit.cg, fit.ctH, fit.ctD].some(value => Number.isFinite(value) && value < 0);
    const missing = ![fit.lcm, fit.ldm].every(Number.isFinite);
    return '<section class="detail-card"><div class="fit-summary"><h3>Ersatzschaltbild · Fit</h3><small>' +
      esc(hz(band[0]) + ' – ' + hz(band[1]) + ' · ' + fit.count + ' Punkte') + '</small></div>' +
      (fit.count < 3 ? '<p class="inline-notice">Im Fit-Band sind mindestens drei gültige positive Frequenzpunkte nötig.</p>' :
        '<div class="metric-grid">' + metric('Cw · Koppelkapazität je Seite', fit.cw * 1e12, 'pF') +
        metric('Ct · Wicklung (H-Mode)', fit.ctH * 1e12, 'pF') + metric('Cg · je Anschluss', fit.cg * 1e12, 'pF') +
        metric('L · je Wicklung', fit.l * 1e6, 'µH') + metric('M · Gegeninduktivität', fit.m * 1e6, 'µH') +
        metric('k · M/L', fit.k, '') +
        '<div class="metric"><strong>' + esc(Number.isFinite(resonance.cm) ? hz(resonance.cm) : '—') + '</strong><span>Eigenresonanz CM · H-Mode</span></div>' +
        '<div class="metric"><strong>' + esc(Number.isFinite(resonance.dm) ? hz(resonance.dm) : '—') + '</strong><span>Eigenresonanz DM · D-Mode</span></div>' +
        '</div><p class="diagnostics">' +
        esc('L+M ' + valueWith(fit.lcm * 1e6, 'µH') + ' · L−M ' + valueWith(fit.ldm * 1e6, 'µH') +
          ' · Ct aus D ' + valueWith(fit.ctD * 1e12, 'pF') + ' · Fitrest H/D ' +
          valueWith(100 * fit.hError, '%') + ' / ' + valueWith(100 * fit.dError, '%') +
          ' · Modenkopplung im Y-Modell ' + valueWith(100 * fit.coupling, '%')) + '</p>') +
      (fit.count >= 3 && (unphysical || missing) ?
        '<p class="inline-notice">Der Fit liefert für dieses Band negative Kapazitäten oder keine gültige Induktivität. Prüfe Portpolarität, DUT-Symmetrie und Fit-Band.</p>' : '') +
      '</section>';
  }

  const si = (value, unit) => {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0 ' + unit;
    const e = Math.max(-5, Math.min(4, Math.floor(Math.log10(Math.abs(value)) / 3)));
    return display(value / 10 ** (3 * e)) + ' ' + ['f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T'][e + 5] + unit;
  };
  const metricText = (label, text) => '<div class="metric"><strong>' + esc(text) + '</strong><span>' + esc(label) + '</span></div>';
