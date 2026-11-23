'use strict';

// Grafischer Schaltplan-Editor für den Simulator.
// Die Netzliste bleibt die einzige Quelle: load() liest sie in Blöcke, exportText() schreibt sie zurück.
// Der Editor kennt nur Knotennamen. Zwei Anschlüsse sind verbunden, wenn sie denselben Knotennamen tragen.
// Masse ist der Knoten „0“ und wird an jedem Anschluss als Massesymbol gezeichnet.

const SCH = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const GRID = 10;
  const LAYOUT_KEY = 'spe-sim:layouts';
  const KINDS = {
    R: { title: 'Widerstand', unit: 'Ω', w: 100, h: 44, color: '#6b6a64' },
    C: { title: 'Kondensator', unit: 'F', w: 100, h: 44, color: '#6b6a64' },
    L: { title: 'Spule', unit: 'H', w: 100, h: 44, color: '#6b6a64' },
    T: { title: 'Übertrager', unit: '', w: 120, h: 76, color: '#7a4fc2' },
    S: { title: 'Touchstone-Block', unit: '', w: 136, h: 48, color: '#c96442' },
    P: { title: 'Port', unit: 'Ω', w: 96, h: 56, color: '#1f5fd1' },
    K: { title: 'Kopplung', unit: '', w: 176, h: 44, color: '#6b6a64' }
  };
  const PIN_LABELS = { T: ['P+', 'P−', 'S+', 'S−'], P: ['+', '−'] };
  const PIN_SIDES = { R: ['l', 'r'], C: ['l', 'r'], L: ['l', 'r'], T: ['l', 'l', 'r', 'r'], P: ['r', 'b'] };
  const DEFAULT_VALUE = { R: '50', C: '100n', L: '10u', T: '1', P: '50', K: '0.99' };
  // Bedeutung der Anschlüsse der mitgelieferten Würth-Messdateien (siehe README)
  const HINTS = {
    '74930000.s7p': ['PHY-Wicklung, Ende +', 'PHY-Wicklung, Mittelanzapfung', 'PHY-Wicklung, Ende −', 'Leitungswicklung, Ende −', 'Leitungswicklung, Mitte', 'Leitungswicklung, Mitte', 'Leitungswicklung, Ende +'],
    '744235251.s4p': ['Wicklung 1, Anfang (Übertragerseite +)', 'Wicklung 1, Ende (Steckerseite +)', 'Wicklung 2, Anfang (Übertragerseite −)', 'Wicklung 2, Ende (Steckerseite −)']
  };

  let comps = [], items = [], pairs = [], selected = null, nextId = 1, zoom = 1;
  let svg, propsBox, netList, api = {};
  let drag = null;

  // ---------- Hilfen ----------
  const svgEl = (name, attrs, parent, text) => {
    const node = document.createElementNS(SVGNS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const isAutoNet = name => /^n\d+$/.test(name) || /^nc_/.test(name);
  const cleanNet = raw => {
    const name = String(raw || '').trim().toLowerCase();
    if (!name) return null;
    return name === 'gnd' ? '0' : name;
  };
  const snap = v => Math.max(10, Math.round(v / GRID) * GRID);
  const find = id => comps.find(c => c.id === id);

  function geom(c) {
    const kind = KINDS[c.kind];
    if (c.kind === 'K') return { w: kind.w, h: kind.h, pins: [] };
    let sides;
    if (c.kind === 'S') {
      const n = c.nets.length, left = Math.ceil(n / 2);
      sides = c.nets.map((_, i) => c.sides === 'alt' ? (i % 2 === 0 ? 'l' : 'r') : (i < left ? 'l' : 'r'));
    } else sides = PIN_SIDES[c.kind];
    if (c.flip) sides = sides.map(side => side === 'l' ? 'r' : side === 'r' ? 'l' : side);
    const count = { l: 0, r: 0, t: 0, b: 0 };
    sides.forEach(s => count[s]++);
    let h = kind.h;
    if (c.kind === 'S') h = Math.max(kind.h, Math.max(count.l, count.r) * 26 + 22);
    const seen = { l: 0, r: 0, t: 0, b: 0 };
    const pins = sides.map((side, i) => {
      const idx = seen[side]++, total = count[side];
      if (side === 'l' || side === 'r') return { i, side, x: side === 'l' ? 0 : kind.w, y: Math.round(h * (idx + 1) / (total + 1)), dx: side === 'l' ? -1 : 1, dy: 0 };
      return { i, side, x: Math.round(kind.w * (idx + 1) / (total + 1)), y: side === 'b' ? h : 0, dx: 0, dy: side === 'b' ? 1 : -1 };
    });
    return { w: kind.w, h, pins };
  }

  function freshNet() {
    const used = new Set();
    comps.forEach(c => c.nets.forEach(n => n && used.add(n)));
    let k = 1;
    while (used.has('n' + k)) k++;
    return 'n' + k;
  }
  function nextName(kind) {
    const used = new Set(comps.map(c => c.name.toLowerCase()));
    if (kind === 'P') {
      let k = 1;
      while (used.has('p' + k)) k++;
      return 'P' + k;
    }
    const prefix = kind === 'S' ? 'S' : kind;
    let k = 1;
    while (used.has((prefix + k).toLowerCase())) k++;
    return prefix + k;
  }

  // ---------- Netzliste lesen und schreiben ----------
  function load(text) {
    const newComps = [], newItems = [], newPairs = [];
    let id = 1;
    String(text).split(/\r?\n/).forEach((source, at) => {
      const body = source.replace(/[;!].*$/, '').trim();
      if (!body || /^[*#]/.test(body)) { newItems.push({ raw: source }); return; }
      const tokens = body.split(/\s+/);
      const head = tokens[0];
      if (head.startsWith('.')) {
        if (head.toLowerCase() === '.pair') newPairs.push([Number(tokens[1]), Number(tokens[2])]);
        else newItems.push({ raw: source });
        return;
      }
      const kind = head[0].toUpperCase();
      if (!KINDS[kind]) throw new Error('Zeile ' + (at + 1) + ': unbekanntes Bauteil ' + head);
      const plain = [], extra = [];
      let file = '', ref = '0';
      tokens.slice(1).forEach(token => {
        const eq = token.indexOf('=');
        if (eq > 0) {
          const key = token.slice(0, eq).toLowerCase();
          if (kind === 'S' && key === 'file') file = token.slice(eq + 1);
          else if (kind === 'S' && key === 'ref') ref = token.slice(eq + 1).toLowerCase();
          else extra.push(token);
        } else plain.push(token);
      });
      const c = { id: id++, kind, name: head, x: 0, y: 0, nets: [], value: '', extra: extra.join(' '), file, ref, a: '', b: '', sides: 'split', flip: false };
      if (kind === 'R' || kind === 'C' || kind === 'L') { c.nets = [cleanNet(plain[0]), cleanNet(plain[1])]; c.value = plain[2] || ''; }
      else if (kind === 'T') { c.nets = plain.slice(0, 4).map(cleanNet); while (c.nets.length < 4) c.nets.push(null); c.value = plain[4] || '1'; }
      else if (kind === 'S') { c.nets = plain.map(cleanNet); c.sides = c.nets.length === 4 ? 'alt' : 'split'; }
      else if (kind === 'P') { c.nets = [cleanNet(plain[0]), cleanNet(plain[1])]; c.value = plain[2] || '50'; }
      else if (kind === 'K') { c.a = plain[0] || ''; c.b = plain[1] || ''; c.value = plain[2] || '0.99'; }
      newComps.push(c);
      newItems.push({ comp: c });
    });
    comps = newComps; items = newItems; pairs = newPairs; nextId = id; selected = null;
    const saved = readLayouts()[signature()];
    if (saved && comps.every(c => saved[c.name.toLowerCase()])) {
      comps.forEach(c => {
        const p = saved[c.name.toLowerCase()];
        c.x = p[0]; c.y = p[1];
        if (p[2]) c.sides = p[2];
        c.flip = !!p[3];
      });
    } else autoLayout();
    render(true); renderProps();
  }

  function lineOf(c) {
    const nets = c.nets.map((n, i) => n || 'nc_' + c.name.toLowerCase() + '_' + (i + 1));
    const extra = c.extra ? ' ' + c.extra : '';
    switch (c.kind) {
      case 'R': return c.name + ' ' + nets.join(' ') + ' ' + c.value;
      case 'C': case 'L': return c.name + ' ' + nets.join(' ') + ' ' + c.value + extra;
      case 'T': return c.name + ' ' + nets.join(' ') + ' ' + c.value;
      case 'S': return c.name + ' ' + nets.join(' ') + ' ref=' + (c.ref || '0') + ' file=' + c.file + extra;
      case 'P': return c.name + ' ' + nets.join(' ') + ' ' + c.value + extra;
      default: return c.name + ' ' + c.a + ' ' + c.b + ' ' + c.value;
    }
  }
  function exportText() {
    const lines = items.map(item => item.raw !== undefined ? item.raw : lineOf(item.comp));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (pairs.length) lines.push('');
    pairs.forEach(pair => lines.push('.pair ' + pair[0] + ' ' + pair[1]));
    return lines.join('\n') + '\n';
  }

  // ---------- Anordnung ----------
  function signature() {
    const text = comps.map(c => c.name.toLowerCase() + ':' + c.nets.join(',') + c.a + c.b).sort().join('|');
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return String(hash);
  }
  function readLayouts() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { return {}; }
  }
  function saveLayout() {
    const store = readLayouts();
    const positions = {};
    comps.forEach(c => { positions[c.name.toLowerCase()] = [c.x, c.y, c.sides, c.flip ? 1 : 0]; });
    const key = signature();
    delete store[key];
    store[key] = positions;
    Object.keys(store).slice(0, -15).forEach(k => delete store[k]);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(store)); } catch { /* ohne Speicher weiter */ }
  }

  // Spalten nach Abstand zu den Ports. Ports links, danach Schicht für Schicht nach rechts.
  function autoLayout() {
    const members = new Map();
    comps.forEach(c => c.nets.forEach(n => {
      if (!n || n === '0') return;
      if (!members.has(n)) members.set(n, []);
      members.get(n).push(c);
    }));
    const depth = new Map();
    const queue = comps.filter(c => c.kind === 'P').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    queue.forEach(c => depth.set(c, 0));
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      for (const n of c.nets) {
        if (!n || n === '0') continue;
        for (const other of members.get(n) || []) {
          if (!depth.has(other) && other.kind !== 'K') { depth.set(other, depth.get(c) + 1); queue.push(other); }
        }
      }
    }
    let maxDepth = Math.max(0, ...depth.values());
    comps.filter(c => c.kind !== 'K' && !depth.has(c)).forEach(c => { depth.set(c, maxDepth + 1); });
    maxDepth = Math.max(0, ...depth.values());
    // Seiten so wählen, dass Leitungen möglichst nach vorn (zum Port) oder nach hinten führen
    comps.forEach(c => {
      if (c.kind === 'K' || c.kind === 'P') return;
      const modes = c.kind === 'S' && c.nets.length > 2 ? [['split', false], ['alt', false], ['split', true], ['alt', true]] : [[c.sides, false], [c.sides, true]];
      let best = null;
      for (const [sides, flip] of modes) {
        c.sides = sides; c.flip = flip;
        let score = 0;
        geom(c).pins.forEach(pin => {
          const net = c.nets[pin.i];
          if (!net || net === '0') return;
          const others = (members.get(net) || []).filter(o => o !== c && depth.has(o));
          if (!others.length) return;
          const lowest = Math.min(...others.map(o => depth.get(o)));
          const own = depth.get(c);
          if (lowest < own) score += pin.side === 'l' ? 1 : -1;
          else if (lowest > own) score += pin.side === 'r' ? 1 : -1;
        });
        if (!best || score > best.score) best = { sides, flip, score };
      }
      c.sides = best.sides; c.flip = best.flip;
    });
    const columns = [];
    comps.filter(c => c.kind !== 'K').sort((a, b) => depth.get(a) - depth.get(b) || comps.indexOf(a) - comps.indexOf(b))
      .forEach(c => { (columns[depth.get(c)] = columns[depth.get(c)] || []).push(c); });
    let x = 30, bottom = 20;
    columns.forEach(column => {
      if (!column) return;
      let y = 30, width = 0;
      column.forEach(c => { const g = geom(c); c.x = x; c.y = y; y += g.h + 40; width = Math.max(width, g.w); });
      bottom = Math.max(bottom, y);
      x += width + 80;
    });
    let kx = 30;
    comps.filter(c => c.kind === 'K').forEach(c => { c.x = kx; c.y = bottom; kx += geom(c).w + 20; });
  }

  // ---------- Zeichnen ----------
  function render(refit) {
    svg.textContent = '';
    const wires = svgEl('g', {}, svg), blocks = svgEl('g', {}, svg);
    drag && drag.overlay && svg.append(drag.overlay);
    const members = new Map();
    const names = new Set();
    comps.forEach(c => {
      c._g = geom(c);
      c._g.pins.forEach(p => {
        const net = c.nets[p.i];
        if (!net) return;
        names.add(net);
        if (!members.has(net)) members.set(net, []);
        members.get(net).push({ x: c.x + p.x, y: c.y + p.y, sx: c.x + p.x + p.dx * 14, sy: c.y + p.y + p.dy * 14, dx: p.dx, dy: p.dy });
      });
    });
    members.forEach((list, net) => {
      if (net === '0') {
        list.forEach(m => {
          svgEl('path', { d: `M${m.x} ${m.y} L${m.sx} ${m.sy} L${m.sx} ${m.sy + 8}`, class: 'sch-wire', 'data-net': net }, wires);
          const gx = m.sx, gy = m.sy + 8;
          svgEl('path', { d: `M${gx - 9} ${gy} h18 M${gx - 6} ${gy + 4} h12 M${gx - 3} ${gy + 8} h6`, class: 'sch-wire', 'data-net': net }, wires);
        });
        return;
      }
      if (list.length < 2) return;
      const sorted = list.slice().sort((a, b) => a.sx - b.sx || a.sy - b.sy);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1], mx = Math.round((a.sx + b.sx) / 2);
        svgEl('path', { d: `M${a.x} ${a.y} L${a.sx} ${a.sy} L${mx} ${a.sy} L${mx} ${b.sy} L${b.sx} ${b.sy} L${b.x} ${b.y}`, class: 'sch-wire', 'data-net': net }, wires);
      }
      if (!isAutoNet(net)) {
        const first = sorted[0];
        svgEl('text', { x: first.sx - 2, y: first.sy - 5, class: 'sch-net', 'text-anchor': first.dx < 0 ? 'end' : 'start' }, wires, net);
      }
    });

    comps.forEach(c => {
      const g = c._g, kind = KINDS[c.kind];
      const group = svgEl('g', { transform: `translate(${c.x} ${c.y})`, 'data-comp': c.id, class: 'sch-block' + (selected === c.id ? ' selected' : '') }, blocks);
      svgEl('rect', { width: g.w, height: g.h, rx: 6, fill: '#fff', stroke: kind.color, 'stroke-width': c.kind === 'S' ? 2 : 1.5, 'stroke-dasharray': c.kind === 'K' ? '5 3' : null }, group);
      svgEl('text', { x: g.w / 2, y: 17, class: 'sch-name', 'text-anchor': 'middle', fill: kind.color }, group, c.name);
      let sub = '';
      if (c.kind === 'S') sub = c.file.length > 20 ? c.file.slice(0, 19) + '…' : c.file;
      else if (c.kind === 'K') sub = c.a + ' ↔ ' + c.b + '   k = ' + c.value;
      else if (c.kind === 'T') sub = 'ü = ' + c.value;
      else sub = c.value + kind.unit;
      svgEl('text', { x: g.w / 2, y: c.kind === 'S' ? 34 : 33, class: 'sch-val', 'text-anchor': 'middle' }, group, sub);
      g.pins.forEach(p => {
        const connected = !!c.nets[p.i];
        const hint = (c.kind === 'S' && HINTS[c.file.toLowerCase()] || [])[p.i];
        const net = c.nets[p.i];
        const label = c.kind === 'S' ? String(p.i + 1) : (PIN_LABELS[c.kind] || [])[p.i];
        if (label) {
          const lx = p.side === 'l' ? p.x + 9 : p.side === 'r' ? p.x - 9 : p.x;
          const ly = p.side === 'b' ? p.y - 7 : p.y + 3.5;
          svgEl('text', { x: lx, y: ly, class: 'sch-pin-label', 'text-anchor': p.side === 'l' ? 'start' : p.side === 'r' ? 'end' : 'middle' }, group, label);
        }
        const pin = svgEl('g', { 'data-pin': p.i, 'data-comp': c.id, class: 'sch-pin' }, group);
        svgEl('circle', { cx: p.x, cy: p.y, r: 10, fill: 'transparent' }, pin);
        svgEl('circle', { cx: p.x, cy: p.y, r: 4.5, fill: connected ? kind.color : '#fff', stroke: kind.color, 'stroke-width': 1.5 }, pin);
        svgEl('title', {}, pin, (label ? 'Pin ' + label : 'Anschluss ' + (p.i + 1)) + (hint ? ' · ' + hint : '') + ' · Knoten: ' + (net || 'nicht verbunden') + '\nZiehen = verbinden · Doppelklick = Masse · Rechtsklick = trennen');
      });
    });

    netList.textContent = '';
    [...names].sort().forEach(n => netList.append(new Option(n)));
    if (refit !== false) fit();
  }

  function fit() {
    let maxX = 560, maxY = 260;
    comps.forEach(c => { const g = c._g || geom(c); maxX = Math.max(maxX, c.x + g.w + 60); maxY = Math.max(maxY, c.y + g.h + 70); });
    maxX += 80;
    svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);
    svg.style.width = Math.round(maxX * zoom) + 'px';
    svg.style.height = Math.round(maxY * zoom) + 'px';
    svg.dataset.vw = maxX; svg.dataset.vh = maxY;
  }

  // ---------- Eingabe mit Maus und Finger ----------
  const toSvg = event => {
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };
  const pinAt = event => {
    for (const node of document.elementsFromPoint(event.clientX, event.clientY)) {
      const pin = node.closest && node.closest('[data-pin]');
      if (pin && svg.contains(pin)) return { comp: Number(pin.dataset.comp), pin: Number(pin.dataset.pin) };
    }
    return null;
  };
  function pinPoint(c, i) { const p = geom(c).pins[i]; return { x: c.x + p.x, y: c.y + p.y }; }

  function onDown(event) {
    if (event.button !== 0) return;
    const pinNode = event.target.closest('[data-pin]');
    const blockNode = event.target.closest('[data-comp]');
    const point = toSvg(event);
    if (pinNode) {
      const c = find(Number(pinNode.dataset.comp)), i = Number(pinNode.dataset.pin);
      const start = pinPoint(c, i);
      const overlay = svgEl('line', { x1: start.x, y1: start.y, x2: start.x, y2: start.y, class: 'sch-rubber' });
      svg.append(overlay);
      drag = { type: 'wire', comp: c.id, pin: i, overlay, moved: false };
      svg.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else if (blockNode) {
      const c = find(Number(blockNode.dataset.comp));
      select(c.id);
      drag = { type: 'move', comp: c.id, dx: point.x - c.x, dy: point.y - c.y, moved: false };
      svg.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else select(null);
  }
  function onMove(event) {
    if (!drag) return;
    const point = toSvg(event);
    if (drag.type === 'move') {
      const c = find(drag.comp);
      const x = snap(point.x - drag.dx), y = snap(point.y - drag.dy);
      if (x !== c.x || y !== c.y) { c.x = x; c.y = y; drag.moved = true; render(false); }
    } else {
      drag.moved = true;
      drag.overlay.setAttribute('x2', point.x); drag.overlay.setAttribute('y2', point.y);
    }
  }
  function onUp(event) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.type === 'move') { if (d.moved) { saveLayout(); render(true); } return; }
    d.overlay.remove();
    const target = pinAt(event);
    if (target && !(target.comp === d.comp && target.pin === d.pin)) {
      connect(find(d.comp), d.pin, find(target.comp), target.pin);
      changed({ props: true });
    }
  }
  function onDouble(event) {
    const pinNode = event.target.closest('[data-pin]');
    if (!pinNode) return;
    const c = find(Number(pinNode.dataset.comp)), i = Number(pinNode.dataset.pin);
    c.nets[i] = c.nets[i] === '0' ? null : '0';
    changed({ props: true });
  }
  function onContext(event) {
    const pinNode = event.target.closest('[data-pin]');
    if (!pinNode) return;
    event.preventDefault();
    find(Number(pinNode.dataset.comp)).nets[Number(pinNode.dataset.pin)] = null;
    changed({ props: true });
  }
  function onKey(event) {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      remove(selected);
    }
  }

  function connect(a, i, b, j) {
    const na = a.nets[i], nb = b.nets[j];
    if (na && nb) {
      if (na === nb) return;
      const keep = nb === '0' ? nb : na, drop = keep === na ? nb : na;
      comps.forEach(c => { c.nets = c.nets.map(n => n === drop ? keep : n); });
    } else if (na) b.nets[j] = na;
    else if (nb) a.nets[i] = nb;
    else { const n = freshNet(); a.nets[i] = n; b.nets[j] = n; }
  }

  // ---------- Bearbeiten ----------
  function select(id) {
    selected = id;
    render(false);
    renderProps();
  }
  function changed(options) {
    render(true);
    saveLayout();
    if (options && options.props) renderProps();
    if (api.onChange) api.onChange(exportText());
  }
  function add(kind) {
    const c = { id: nextId++, kind, name: nextName(kind), x: 0, y: 0, nets: [], value: DEFAULT_VALUE[kind] || '', extra: '', file: '', ref: '0', a: '', b: '', sides: 'split', flip: false };
    if (kind === 'T') c.nets = [null, null, null, null];
    else if (kind === 'S') {
      const names = api.fileNames ? api.fileNames() : [];
      c.file = names[0] || 'datei.s2p';
      const info = api.fileInfo && api.fileInfo(c.file);
      c.nets = new Array(info ? info.n : 2).fill(null);
      if (c.nets.length === 4) c.sides = 'alt';
      if (!info && api.ensureFile) api.ensureFile(c.file).then(() => applyFile(c, c.file)).catch(() => {});
    } else if (kind === 'K') {
      const coils = comps.filter(x => x.kind === 'L');
      c.a = coils[0] ? coils[0].name : ''; c.b = coils[1] ? coils[1].name : '';
    } else c.nets = [null, null];
    // freien Platz suchen
    outer: for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 6; col++) {
        const x = 30 + col * 190, y = 30 + row * 100;
        if (!comps.some(o => Math.abs(o.x - x) < 150 && Math.abs(o.y - y) < 80)) { c.x = x; c.y = y; break outer; }
      }
    }
    comps.push(c);
    items.push({ comp: c });
    selected = c.id;
    changed({ props: true });
  }
  function remove(id) {
    const c = find(id);
    if (!c) return;
    comps = comps.filter(x => x !== c);
    items = items.filter(item => item.comp !== c);
    if (c.kind === 'P') {
      const number = Number(c.name.slice(1));
      comps.filter(x => x.kind === 'P').forEach(x => {
        const k = Number(x.name.slice(1));
        if (k > number) x.name = 'P' + (k - 1);
      });
      pairs = pairs.filter(pair => !pair.includes(number)).map(pair => pair.map(k => k > number ? k - 1 : k));
    }
    selected = null;
    changed({ props: true });
  }
  function applyFile(c, name) {
    const info = api.fileInfo && api.fileInfo(name);
    c.file = name;
    if (info) {
      while (c.nets.length < info.n) c.nets.push(null);
      c.nets.length = info.n;
      c.sides = info.n === 4 ? 'alt' : 'split';
    }
    changed({ props: true });
  }

  // ---------- Eigenschaften ----------
  function field(parent, label, control) {
    const wrap = document.createElement('label');
    wrap.className = 'sch-field';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(span, control);
    parent.append(wrap);
    return control;
  }
  function textInput(value, onChange, placeholder, listId) {
    const input = document.createElement('input');
    input.type = 'text'; input.value = value || ''; input.spellcheck = false; input.autocomplete = 'off';
    if (placeholder) input.placeholder = placeholder;
    if (listId) input.setAttribute('list', listId);
    input.addEventListener('change', () => onChange(input.value, input));
    return input;
  }

  function renderProps() {
    propsBox.textContent = '';
    const c = find(selected);
    if (!c) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Baustein anklicken, um Werte und Anschlüsse zu bearbeiten. Bausteine oben einfügen und ihre Anschlüsse (Kreise) per Ziehen verbinden.';
      propsBox.append(p);
      return;
    }
    const title = document.createElement('h3');
    title.textContent = KINDS[c.kind].title;
    propsBox.append(title);

    field(propsBox, 'Name', textInput(c.name, (value, input) => {
      const name = value.trim();
      const clash = comps.some(o => o !== c && o.name.toLowerCase() === name.toLowerCase());
      const okPrefix = c.kind === 'P' ? /^P\d+$/i.test(name) : name[0] && name[0].toUpperCase() === c.kind;
      if (!/^[\w.+\-]+$/.test(name) || clash || !okPrefix) { input.value = c.name; return; }
      comps.forEach(o => { if (o.kind === 'K') { if (o.a.toLowerCase() === c.name.toLowerCase()) o.a = name; if (o.b.toLowerCase() === c.name.toLowerCase()) o.b = name; } });
      c.name = name;
      changed();
    }));
    if (c.kind === 'S') {
      const select = document.createElement('select');
      const names = new Set(api.fileNames ? api.fileNames() : []);
      names.add(c.file);
      [...names].forEach(n => select.add(new Option(n, n)));
      select.value = c.file;
      select.addEventListener('change', () => {
        const name = select.value;
        if (api.fileInfo && api.fileInfo(name)) applyFile(c, name);
        else if (api.ensureFile) api.ensureFile(name).then(() => applyFile(c, name)).catch(() => { c.file = name; changed({ props: true }); });
      });
      field(propsBox, 'Touchstone-Datei', select);
      field(propsBox, 'Bezugsknoten (ref)', textInput(c.ref, value => { c.ref = cleanNet(value) || '0'; changed(); }));
      if (c.nets.length > 2) {
        const sides = document.createElement('select');
        sides.add(new Option('Hälfte links, Hälfte rechts', 'split'));
        sides.add(new Option('ungerade links, gerade rechts', 'alt'));
        sides.value = c.sides;
        sides.addEventListener('change', () => { c.sides = sides.value; changed({ props: true }); });
        field(propsBox, 'Anordnung der Pins', sides);
      }
    } else if (c.kind === 'K') {
      const coils = comps.filter(x => x.kind === 'L').map(x => x.name);
      for (const key of ['a', 'b']) {
        const select = document.createElement('select');
        select.add(new Option('—', ''));
        coils.forEach(n => select.add(new Option(n, n)));
        select.value = c[key];
        select.addEventListener('change', () => { c[key] = select.value; changed(); });
        field(propsBox, key === 'a' ? 'Spule 1' : 'Spule 2', select);
      }
      field(propsBox, 'Koppelfaktor k', textInput(c.value, value => { c.value = value.trim(); changed(); }));
    }
    if (c.kind !== 'S' && c.kind !== 'K') {
      const label = { R: 'Widerstand', C: 'Kapazität', L: 'Induktivität', T: 'Übersetzung ü = Up/Us', P: 'Bezugsimpedanz Z0' }[c.kind];
      field(propsBox, label, textInput(c.value, value => { c.value = value.trim(); changed(); }, 'z. B. 100n, 4.7u, 1k'));
    }
    if (c.kind !== 'K' && c.kind !== 'P') {
      const flip = document.createElement('input');
      flip.type = 'checkbox'; flip.checked = c.flip;
      flip.addEventListener('change', () => { c.flip = flip.checked; changed({ props: true }); });
      const wrap = document.createElement('label');
      wrap.className = 'sch-field';
      wrap.style.cssText = 'display:flex;gap:8px;align-items:center';
      flip.style.width = 'auto';
      wrap.append(flip, document.createTextNode('Seiten spiegeln'));
      propsBox.append(wrap);
    }
    if (c.kind === 'C') field(propsBox, 'Zusatz', textInput(c.extra, value => { c.extra = value.trim(); changed(); }, 'esr=0.02 esl=1n'));
    if (c.kind === 'L') field(propsBox, 'Zusatz', textInput(c.extra, value => { c.extra = value.trim(); changed(); }, 'rs=0.1 cp=2p rp=10k'));
    if (c.kind === 'P') {
      const number = Number(c.name.slice(1));
      const select = document.createElement('select');
      select.add(new Option('kein Paar', ''));
      comps.filter(x => x.kind === 'P' && x !== c).forEach(x => select.add(new Option(x.name, x.name.slice(1))));
      const mine = pairs.find(pair => pair.includes(number));
      select.value = mine ? String(mine[0] === number ? mine[1] : mine[0]) : '';
      select.addEventListener('change', () => {
        const partner = Number(select.value);
        pairs = pairs.filter(pair => !pair.includes(number) && !(partner && pair.includes(partner)));
        if (partner) pairs.push([Math.min(number, partner), Math.max(number, partner)]);
        pairs.sort((x, y) => x[0] - y[0]);
        changed({ props: true });
      });
      field(propsBox, 'Mixed-Mode-Paar mit', select);
    }

    if (c.nets.length) {
      const heading = document.createElement('h4');
      heading.textContent = 'Anschlüsse (Knotennamen)';
      propsBox.append(heading);
      const hints = c.kind === 'S' ? HINTS[c.file.toLowerCase()] || [] : [];
      c.nets.forEach((net, i) => {
        const label = c.kind === 'S' ? 'Pin ' + (i + 1) : (PIN_LABELS[c.kind] || [])[i] || 'Pin ' + (i + 1);
        const input = textInput(net, (value, el) => {
          const clean = cleanNet(value);
          if (clean && !/^[\w.+\-]+$/.test(clean)) { el.value = c.nets[i] || ''; return; }
          c.nets[i] = clean;
          changed({ props: true });
        }, 'nicht verbunden', 'sch-nets');
        field(propsBox, label, input);
        if (hints[i]) { const h = document.createElement('div'); h.className = 'sch-hint'; h.textContent = hints[i]; propsBox.lastChild.append(h); }
      });
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Gleicher Name verbindet Anschlüsse. 0 ist Masse.';
      propsBox.append(note);
    }
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn'; del.textContent = 'Baustein löschen';
    del.addEventListener('click', () => remove(c.id));
    propsBox.append(del);
  }

  // ---------- Einbau ----------
  function mount(options) {
    svg = options.svg; propsBox = options.props; netList = options.netList; api = options.api || {};
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', () => { if (drag && drag.overlay) drag.overlay.remove(); drag = null; });
    svg.addEventListener('dblclick', onDouble);
    svg.addEventListener('contextmenu', onContext);
    svg.addEventListener('pointerover', event => {
      const pin = event.target.closest && event.target.closest('[data-pin]');
      svg.querySelectorAll('.sch-wire.hot').forEach(w => w.classList.remove('hot'));
      if (!pin) return;
      const c = find(Number(pin.dataset.comp));
      const net = c && c.nets[Number(pin.dataset.pin)];
      if (net) svg.querySelectorAll('.sch-wire').forEach(w => { if (w.dataset.net === net) w.classList.add('hot'); });
    });
    document.addEventListener('keydown', onKey);
    (options.palette || []).forEach(() => {});
  }
  function setZoom(delta) {
    zoom = Math.min(2, Math.max(0.4, zoom + delta));
    fit();
  }
  function relayout() { autoLayout(); saveLayout(); render(true); }

  return { mount, load, exportText, add, setZoom, relayout, refreshProps: renderProps, kinds: KINDS, _debug: () => ({ comps, pairs }) };
})();

if (typeof module === 'object' && module.exports) module.exports = SCH;
