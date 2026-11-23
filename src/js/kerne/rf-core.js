'use strict';

const RF = (() => {
  const MAX_PORTS = 64;
  const MAX_CELLS = 4_000_000;
  const MAX_POINTS = 150_000;
  const TAU = 2 * Math.PI;
  const RAD = Math.PI / 180;
  const ROOT_HALF = Math.SQRT1_2;
  const FREQ_UNITS = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 };
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;
  const abs = ([re, im]) => Math.hypot(re, im);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const scale = (a, k) => [a[0] * k, a[1] * k];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const one = [1, 0];

  function div(a, b) {
    const peak = Math.max(Math.abs(b[0]), Math.abs(b[1]));
    if (!(peak > 0 && Number.isFinite(peak))) return null;
    const ar = a[0] / peak, ai = a[1] / peak, br = b[0] / peak, bi = b[1] / peak;
    const norm = br * br + bi * bi;
    const out = [(ar * br + ai * bi) / norm, (ai * br - ar * bi) / norm];
    return out.every(Number.isFinite) ? out : null;
  }

  const get = (matrix, n, row, col) => {
    const i = 2 * (row * n + col);
    return [matrix[i], matrix[i + 1]];
  };
  function put(matrix, n, row, col, v) {
    const i = 2 * (row * n + col);
    matrix[i] = v[0];
    matrix[i + 1] = v[1];
  }
  const matrix = n => new Float64Array(2 * n * n);
  const indices = n => Array.from({ length: n }, (_, i) => i);

  function solve(left, right, n, columns = n) {
    const a = left.slice();
    const b = right.slice();
    // Scaled pivot selection keeps small but well-scaled rows usable.
    const rowScale = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const at = 2 * (i * n + j);
        rowScale[i] = Math.max(rowScale[i], Math.hypot(a[at], a[at + 1]));
      }
      if (!rowScale[i] || !Number.isFinite(rowScale[i])) return null;
    }
    const tolerance = 16 * Number.EPSILON * n;
    for (let p = 0; p < n; p++) {
      let pivot = p;
      let score = 0;
      for (let i = p; i < n; i++) {
        const at = 2 * (i * n + p);
        const candidate = Math.hypot(a[at], a[at + 1]) / rowScale[i];
        if (candidate > score) { pivot = i; score = candidate; }
      }
      if (!(score > tolerance)) return null;
      if (pivot !== p) {
        for (let j = 2 * p; j < 2 * n; j++) {
          const top = 2 * p * n + j, bottom = 2 * pivot * n + j;
          const tmp = a[top]; a[top] = a[bottom]; a[bottom] = tmp;
        }
        for (let j = 0; j < 2 * columns; j++) {
          const top = 2 * p * columns + j, bottom = 2 * pivot * columns + j;
          const tmp = b[top]; b[top] = b[bottom]; b[bottom] = tmp;
        }
        const tmp = rowScale[p]; rowScale[p] = rowScale[pivot]; rowScale[pivot] = tmp;
      }
      const diagonal = get(a, n, p, p);
      for (let i = p + 1; i < n; i++) {
        const below = get(a, n, i, p);
        if (below[0] === 0 && below[1] === 0) continue;
        const factor = div(below, diagonal);
        if (!factor) return null;
        const [fr, fi] = factor;
        for (let j = p + 1; j < n; j++) {
          const dest = 2 * (i * n + j), src = 2 * (p * n + j);
          a[dest] -= fr * a[src] - fi * a[src + 1];
          a[dest + 1] -= fr * a[src + 1] + fi * a[src];
        }
        for (let j = 0; j < columns; j++) {
          const dest = 2 * (i * columns + j), src = 2 * (p * columns + j);
          b[dest] -= fr * b[src] - fi * b[src + 1];
          b[dest + 1] -= fr * b[src + 1] + fi * b[src];
        }
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      const diagonal = get(a, n, i, i);
      for (let col = 0; col < columns; col++) {
        const target = 2 * (i * columns + col);
        let re = b[target], im = b[target + 1];
        for (let j = i + 1; j < n; j++) {
          const k = 2 * (i * n + j), v = 2 * (j * columns + col);
          re -= a[k] * b[v] - a[k + 1] * b[v + 1];
          im -= a[k] * b[v + 1] + a[k + 1] * b[v];
        }
        const value = div([re, im], diagonal);
        if (!value) return null;
        b[target] = value[0];
        b[target + 1] = value[1];
      }
    }
    return b;
  }

  function transpose(a, n) {
    const out = matrix(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) put(out, n, j, i, get(a, n, i, j));
    }
    return out;
  }

  function submatrix(a, n, ports) {
    const m = ports.length;
    const out = matrix(m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) put(out, m, i, j, get(a, n, ports[i], ports[j]));
    }
    return out;
  }

  function changeRef(s, before, after) {
    const n = before.length;
    if (before.every((value, i) => value === after[i])) return s;
    const numerator = matrix(n), denominator = matrix(n);
    for (let i = 0; i < n; i++) {
      const ratio = Math.sqrt(before[i]) / Math.sqrt(after[i]);
      const e = (ratio + 1 / ratio) / 2, f = (ratio - 1 / ratio) / 2;
      for (let j = 0; j < n; j++) {
        const at = 2 * (i * n + j);
        numerator[at] = e * s[at] + (i === j ? f : 0);
        numerator[at + 1] = e * s[at + 1];
        denominator[at] = f * s[at] + (i === j ? e : 0);
        denominator[at + 1] = f * s[at + 1];
      }
    }
    // Right division uses ordinary transposition. There is no conjugation.
    const result = solve(transpose(denominator, n), transpose(numerator, n), n);
    return result && transpose(result, n);
  }

  function toZY(s, refs, kind) {
    const n = refs.length;
    const left = matrix(n), right = matrix(n);
    const sign = kind === 'Z' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const at = 2 * (i * n + j), identity = Number(i === j);
        left[at] = identity - sign * s[at]; left[at + 1] = -sign * s[at + 1];
        right[at] = identity + sign * s[at]; right[at + 1] = sign * s[at + 1];
      }
    }
    const out = solve(left, right, n);
    if (!out) return null;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const at = 2 * (i * n + j);
        const roots = Math.sqrt(refs[i]) * Math.sqrt(refs[j]);
        const factor = kind === 'Z' ? roots : 1 / roots;
        out[at] *= factor; out[at + 1] *= factor;
      }
    }
    return out;
  }

  function fromZY(data, refs, kind) {
    const n = refs.length;
    const left = matrix(n), right = matrix(n);
    const sign = kind === 'Z' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const at = 2 * (i * n + j);
        const roots = Math.sqrt(refs[i]) * Math.sqrt(refs[j]);
        const factor = kind === 'Z' ? 1 / roots : roots;
        const re = data[at] * factor, im = data[at + 1] * factor;
        const identity = Number(i === j);
        left[at] = identity + re; left[at + 1] = im;
        right[at] = sign * (re - identity); right[at + 1] = sign * im;
      }
    }
    return solve(left, right, n);
  }

  function fromHybrid(data, refs, kind) {
    const q11 = get(data, 2, 0, 0), q12 = get(data, 2, 0, 1);
    const q21 = get(data, 2, 1, 0), q22 = get(data, 2, 1, 1);
    const zero = [0, 0];
    const direct = [one, scale(q12, -1), zero, scale(q22, -1)];
    const cross = [scale(q11, -1), zero, scale(q21, -1), one];
    const voltage = kind === 'H' ? direct : cross;
    const current = kind === 'H' ? cross : direct;
    const left = matrix(2), right = matrix(2);
    for (let i = 0; i < 4; i++) {
      const root = Math.sqrt(refs[i % 2]);
      const v = scale(voltage[i], root), c = scale(current[i], 1 / root);
      left.set(sub(v, c), 2 * i);
      right.set(scale(add(v, c), -1), 2 * i);
    }
    return solve(left, right, 2);
  }

  function project(a, n, rows) {
    const size = rows.length;
    const out = matrix(size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        let re = 0, im = 0;
        for (const [pi, ci] of rows[i]) {
          for (const [pj, cj] of rows[j]) {
            const at = 2 * (pi * n + pj), weight = ci * cj;
            re += weight * a[at];
            im += weight * a[at + 1];
          }
        }
        const at = 2 * (i * size + j);
        out[at] = re; out[at + 1] = im;
      }
    }
    return out;
  }

  function parseNum(text) {
    if (/^-inf(?:inity)?$/i.test(text)) return -Infinity;
    return NUMBER.test(text) ? Number(text.replace(/[dD]/, 'e')) : NaN;
  }

  function readModeOrder(text, n, refs) {
    const order = text.toUpperCase().replace(/\s*,\s*/g, ',').trim().split(/\s+/);
    if (order.length !== n) throw new Error('[Mixed-Mode Order] passt nicht zur Portzahl.');
    const used = new Set(), pairs = [], common = new Set(), rows = [], modeRefs = [];
    const key = (p, q) => [Math.min(p, q), Math.max(p, q)].join(',');
    for (const entry of order) {
      const parts = entry.match(/^([DCS])(\d+)(?:,(\d+))?$/);
      if (!parts) throw new Error('Ungültiger Mixed-Mode-Eintrag: ' + entry);
      const type = parts[1], p = Number(parts[2]) - 1;
      const q = parts[3] ? Number(parts[3]) - 1 : null;
      if (p < 0 || p >= n || (type === 'S' ? q !== null : q === null || q < 0 || q >= n || q === p)) {
        throw new Error('Ungültige Portnummer in ' + entry + '.');
      }
      if (type === 'D' || type === 'S') {
        if (used.has(p) || (q !== null && used.has(q))) throw new Error('Überlappende Mixed-Mode-Paare.');
        used.add(p);
        if (q !== null) used.add(q);
      }
      if (type === 'S') {
        rows.push([[p, 1]]);
        modeRefs.push(refs[p]);
      } else {
        if (refs[p] !== refs[q]) throw new Error('Mixed-Mode-Dateien brauchen gleiche Referenzen innerhalb eines Paares.');
        rows.push([[p, ROOT_HALF], [q, type === 'D' ? -ROOT_HALF : ROOT_HALF]]);
        modeRefs.push(refs[p] * (type === 'D' ? 2 : 0.5));
        if (type === 'D') pairs.push({ p, q });
        else {
          const label = key(p, q);
          if (common.has(label)) throw new Error('Doppelte Common-Mode-Zeile.');
          common.add(label);
        }
      }
    }
    if (used.size !== n || common.size !== pairs.length || pairs.some(({ p, q }) => !common.has(key(p, q)))) {
      throw new Error('Jedes Mixed-Mode-Paar braucht genau einen D- und C-Eintrag.');
    }
    const inverse = Array.from({ length: n }, () => []);
    rows.forEach((row, i) => row.forEach(([port, weight]) => inverse[port].push([i, weight])));
    return { pairs, inverse, refs: modeRefs };
  }

  // Converts a fresh file-basis matrix into the analyzer's physical S-parameter basis.
  function sourceToSingleEnded(data, n, kind, version, optionRef, waveRefs, inverse) {
    if (kind !== 'S') {
      if (version.startsWith('1.')) {
        if (kind === 'Z' || kind === 'Y') {
          const factor = kind === 'Z' ? optionRef : 1 / optionRef;
          for (let j = 0; j < data.length; j++) data[j] *= factor;
        } else {
          const factor = kind === 'H' ? optionRef : 1 / optionRef;
          data[0] *= factor; data[1] *= factor; data[6] /= factor; data[7] /= factor;
        }
      }
      data = ['H', 'G'].includes(kind) ? fromHybrid(data, waveRefs, kind) : fromZY(data, waveRefs, kind);
    }
    return data && inverse ? project(data, n, inverse) : data;
  }

  function parseTouchstone(text, name, source = null) {
    const suffix = name.match(/\.s(\d+)p$/i);
    const portNames = new Map(), warnings = [];
    const packagePins = new Map(), sketchRows = new Map();
    let lanPart = false;
    let vendor = null;
    const freq = [], samples = [];
    const options = { unit: 'GHZ', kind: 'S', format: 'MA', refs: [50] };
    const header = {};
    let state = 'header', pending = '', optionFound = false, sawNetwork = false;
    let version = '1.0', n = 0, refs, fileModes, positions, buffer, fill = 0;
    const deferredVendorRefs = [];
    let expected = null, noiseCount = 0, noiseLast = -Infinity, vendorRefsDiffer = false;
    let unknownVendorRefs = false;
    let lineNumber = 0, spa = null, spaOpen = false;
    const fail = (message, column, length) => {
      if (source) source.diagnostic = { line: lineNumber, column, length };
      throw new Error('Zeile ' + lineNumber + ' · ' + message);
    };

    function readOptions(line) {
      if (optionFound) fail('Mehr als eine Optionszeile.');
      optionFound = true;
      const tokens = line.slice(1).trim().toUpperCase().split(/\s+/).filter(Boolean);
      while (tokens.length) {
        const token = tokens.shift();
        if (Object.hasOwn(FREQ_UNITS, token)) options.unit = token;
        else if (['S', 'Z', 'Y', 'H', 'G'].includes(token)) options.kind = token;
        else if (['RI', 'MA', 'DB'].includes(token)) options.format = token;
        else if (token === 'R') {
          const values = [];
          while (tokens.length && NUMBER.test(tokens[0])) values.push(parseNum(tokens.shift()));
          if (!values.length) fail('Nach R fehlt die Bezugsimpedanz.');
          options.refs = values;
        } else fail('Unbekannte Option ' + token + '.');
      }
    }

    function startNetwork() {
      if (sawNetwork) fail('Mehrere Netzwerkblöcke.');
      sawNetwork = true;
      n = Number(header['number of ports'] ?? suffix?.[1]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PORTS) fail('Unterstützt werden 1–' + MAX_PORTS + ' Ports (.sNp oder [Number of Ports]).');
      if (suffix && Number(suffix[1]) !== n) fail('Portzahl in Dateiendung und Header widerspricht sich.');
      const modern = version.startsWith('2.');
      if (!modern && options.refs.length > 1 && version === '1.0') version = '1.1';
      const specified = header.reference?.trim().split(/\s+/).map(parseNum);
      const values = specified || options.refs;
      if (specified ? values.length !== n : values.length !== 1 && values.length !== n) fail('Die Zahl der Referenzwerte passt nicht zu den Ports.');
      if (!values.every(v => Number.isFinite(v) && v > 0)) fail('Referenzimpedanzen müssen reell und positiv sein.');
      refs = values.length === 1 ? Array(n).fill(values[0]) : values;
      deferredVendorRefs.forEach(checkVendorRefs);
      if (!modern && options.kind !== 'S' && options.refs.length > 1) fail('Für Y, Z, H und G in Touchstone 1.x wird eine gemeinsame Referenz benötigt.');
      if (n !== 2 && ['H', 'G'].includes(options.kind)) fail('H- und G-Parameter sind nur für zwei Ports definiert.');
      const matrixFormat = (header['matrix format'] || 'Full').toLowerCase();
      if (!['full', 'lower', 'upper'].includes(matrixFormat)) fail('Unbekanntes Matrixformat.');
      if (modern && n === 2 && matrixFormat === 'full' && !Object.hasOwn(header, 'two-port data order')) {
        warnings.push('[Two-Port Data Order] fehlt. Die Matrix wird in der Reihenfolge 11, 21, 12, 22 gelesen.');
      }
      const order = header['two-port data order'] || '21_12';
      if (!['12_21', '21_12'].includes(order)) fail('Unbekannte Zweitor-Reihenfolge.');
      positions = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if ((matrixFormat === 'lower' && j > i) || (matrixFormat === 'upper' && i > j)) continue;
          positions.push([i, j]);
        }
      }
      if (n === 2 && matrixFormat === 'full' && order === '21_12') {
        positions = [[0, 0], [1, 0], [0, 1], [1, 1]];
      }
      if (Object.hasOwn(header, 'mixed-mode order')) {
        if (!modern || !['S', 'Y', 'Z'].includes(options.kind)) fail('Mixed-Mode-Import erfordert Touchstone 2.x mit S, Y oder Z.');
        fileModes = readModeOrder(header['mixed-mode order'], n, refs);
      }
      if (source) Object.assign(source, { positions, labels: header['mixed-mode order']?.toUpperCase().replace(/\s*,\s*/g, ',').trim().split(/\s+/),
        refs: fileModes?.refs || refs, unit: options.unit, format: options.format, kind: options.kind,
        version, optionRef: options.refs[0], inverse: fileModes?.inverse });
      buffer = new Float64Array(1 + 2 * positions.length);
      if (Object.hasOwn(header, 'number of frequencies')) {
        expected = Number(header['number of frequencies']);
        if (!Number.isInteger(expected) || expected < 1) fail('Ungültige [Number of Frequencies].');
        if (expected > MAX_POINTS) fail('Datei überschreitet das Limit von 150.000 Frequenzpunkten.');
        if (expected * n * n > MAX_CELLS) fail('Datei überschreitet das Limit von 4 Mio. komplexen Matrixwerten.');
      }
      state = 'network';
    }

    function finishPoint() {
      const f = buffer[0] * FREQ_UNITS[options.unit];
      if (!Number.isFinite(f) || f < 0 || (freq.length && f <= freq.at(-1))) {
        fail('Die Frequenzen müssen endlich, nichtnegativ und streng aufsteigend sein.');
      }
      if ((freq.length + 1) * n * n > MAX_CELLS) fail('Datei überschreitet das Limit von 4 Mio. komplexen Matrixwerten.');
      if (freq.length >= MAX_POINTS) fail('Datei überschreitet das Limit von 150.000 Frequenzpunkten.');
      if (expected !== null && freq.length >= expected) fail('Mehr Frequenzpunkte als im Header angegeben.');
      let data = matrix(n);
      positions.forEach(([row, col], p) => {
        const a = buffer[2 * p + 1], b = buffer[2 * p + 2];
        if (!Number.isFinite(b) || !(Number.isFinite(a) || (options.format === 'DB' && a === -Infinity))) fail('Ungültiges Wertepaar.');
        if (options.format === 'MA' && a < 0) fail('Negativer Betrag im MA-Format.');
        const magnitude = options.format === 'DB' ? 10 ** (a / 20) : a;
        const value = options.format === 'RI' ? [a, b] : [magnitude * Math.cos(b * RAD), magnitude * Math.sin(b * RAD)];
        if (!value.every(Number.isFinite)) fail('Werte außerhalb des Zahlenbereichs.');
        put(data, n, row, col, value);
        if (positions.length !== n * n && row !== col) put(data, n, col, row, value);
      });
      data = sourceToSingleEnded(data, n, options.kind, version, options.refs[0], fileModes?.refs || refs, fileModes?.inverse);
      if (!data) fail('Die Umrechnung nach S ist bei ' + f + ' Hz singulär.');
      freq.push(f);
      samples.push(data);
      fill = 0;
    }

    function readNoise(tokens) {
      const f = parseNum(tokens[0]);
      if (tokens.length !== 5 || !tokens.every(t => Number.isFinite(parseNum(t))) || f < 0 || f <= noiseLast) {
        fail('Ungültiger Zweitor-Rauschdatenblock.');
      }
      noiseLast = f;
      noiseCount++;
    }

    function checkVendorRefs(raw) {
      const values = raw.trim().split(/\s+/).map(parseNum);
      if (values.length === 2 * n) {
        vendorRefsDiffer ||= refs.some((r, i) => (
          !Number.isFinite(values[2 * i]) || !Number.isFinite(values[2 * i + 1]) ||
          Math.abs(values[2 * i] - r) > 1e-6 * r || Math.abs(values[2 * i + 1]) > 1e-6 * r
        ));
      } else unknownVendorRefs = true;
    }

    function readComment(comment) {
      const note = comment.trim();
      if (/^\[SPA-Port-Profile\]/i.test(note)) {
        spa = { name: '', pairs: [], loads: [], ref: null, view: {}, traces: {}, markers: [] };
        spaOpen = true;
        return;
      }
      if (/^\[End SPA-Port-Profile\]/i.test(note)) { spaOpen = false; return; }
      if (spaOpen) { readProfileLine(spa, note); return; }
      const port = comment.match(/^\s*Port\s*\[\s*(\d+)\s*\]\s*=\s*(.+?)\s*$/i);
      if (port) portNames.set(Number(port[1]) - 1, port[2].slice(0, 80));
      lanPart ||= /\bP\/N\s*:\s*7490220115\b/i.test(comment);
      const part = !vendor && comment.match(/Match\s*Code\s*:\s*((?:WE|WCAP|MID|WL)-[A-Za-z0-9+_ -]*?)\s+P\/N\s*:\s*([A-Za-z0-9-]{4,24})/i);
      if (part) vendor = { family: part[1].trim().slice(0, 30), part: part[2] };
      for (const [, vna, pin] of comment.matchAll(/\bPort\s+(\d+)\s*--->\s*\|(\d+)\|/gi)) {
        packagePins.set(Number(vna), Number(pin));
      }
      for (const [, pin, vna] of comment.matchAll(/\|(\d+)\|\s*--->\s*Port\s+(\d+)\b/gi)) {
        packagePins.set(Number(vna), Number(pin));
      }
      // one line of the sketch joins the two VNA ports drawn opposite each other ("Port 1 --->|1|--@||@--|12|---> Port 6")
      const row = comment.match(/\bPort\s+(\d+)\s*--->\s*\|\d+\|.*\|\d+\|\s*--->\s*Port\s+(\d+)\b/i);
      if (row) { sketchRows.set(Number(row[1]), Number(row[2])); sketchRows.set(Number(row[2]), Number(row[1])); }
      const impedance = comment.match(/^\s*Port Impedance\s+(.+)$/i);
      if (impedance && refs) checkVendorRefs(impedance[1]);
      else if (impedance) deferredVendorRefs.push(impedance[1]);
    }

    for (const fullLine of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
      lineNumber++;
      const bang = fullLine.indexOf('!');
      const line = (bang === -1 ? fullLine : fullLine.slice(0, bang)).trim();
      if (bang !== -1) readComment(fullLine.slice(bang + 1));
      if (!line) continue;
      if (state === 'info' && !/^\[end information\]/i.test(line)) continue;
      if (state === 'end') fail('Daten nach [End].');
      if (line.startsWith('#')) {
        if (sawNetwork) fail('Optionszeile nach Netzwerkdaten.');
        if (source) source.optionLine = lineNumber;
        readOptions(line);
        continue;
      }
      if (line.startsWith('[')) {
        const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (!match) fail('Ungültiges Touchstone-Schlüsselwort.');
        const key = match[1].toLowerCase(), value = match[2];
        if (fill !== 0) fail('Unvollständiger Netzwerkpunkt vor [' + match[1] + '].');
        pending = '';
        if (key === 'version') {
          if (sawNetwork || !['1.0', '1.1', '2.0', '2.1'].includes(value)) fail('Nicht unterstützte Touchstone-Version: ' + value);
          version = value;
        } else if (key === 'begin information') state = 'info';
        else if (key === 'end information') state = sawNetwork ? 'network' : 'header';
        else if (key === 'network data') startNetwork();
        else if (key === 'noise data') {
          if (!sawNetwork || n !== 2) fail('[Noise Data] erfordert einen Zweitor-Netzwerkblock.');
          state = 'noise';
        } else if (key === 'end') state = 'end';
        else if (['number of ports', 'number of frequencies', 'number of noise frequencies', 'reference', 'matrix format', 'two-port data order', 'mixed-mode order'].includes(key)) {
          if (sawNetwork || Object.hasOwn(header, key)) fail('Unerwartetes oder doppeltes Schlüsselwort [' + match[1] + '].');
          header[key] = value;
          if (key === 'reference' || key === 'mixed-mode order') pending = key;
        } else fail('Nicht unterstütztes Schlüsselwort [' + match[1] + '].');
        continue;
      }
      if (pending && !sawNetwork) {
        header[pending] += ' ' + line;
        continue;
      }
      if (!sawNetwork) {
        if (version.startsWith('2.')) fail('[Network Data] fehlt.');
        startNetwork();
      }
      const tokens = line.split(/\s+/);
      if (state === 'noise' || (version.startsWith('1.') && n === 2 && fill === 0 && freq.length && tokens.length === 5 && parseNum(tokens[0]) * FREQ_UNITS[options.unit] <= freq.at(-1))) {
        state = 'noise';
        readNoise(tokens);
      } else {
        if (source) source.rows.push([lineNumber, freq.length * buffer.length + fill, tokens.length]);
        let offset = 0;
        for (const token of tokens) {
          const value = parseNum(token);
          if (Number.isNaN(value)) fail('Ungültige Zahl: ' + token.slice(0, 40), fullLine.indexOf(token, offset), token.length);
          if (source) offset = fullLine.indexOf(token, offset) + token.length;
          buffer[fill++] = value;
          if (fill === buffer.length) finishPoint();
        }
      }
    }
    if (fill) fail('Der letzte Netzwerkpunkt ist unvollständig.');
    if (!freq.length) throw new Error('Die Datei enthält keine Netzwerkpunkte.');
    if (expected !== null && expected !== freq.length) throw new Error('Die Punktzahl weicht von [Number of Frequencies] ab.');
    if (Object.hasOwn(header, 'number of noise frequencies') && Number(header['number of noise frequencies']) !== noiseCount) {
      throw new Error('Die Anzahl der Rauschpunkte passt nicht zum Header.');
    }
    if (vendorRefsDiffer && options.kind === 'S') {
      throw new Error('Die Datei enthält abweichende proprietäre Portimpedanzen. Bitte mit reeller, konstanter Referenz exportieren, z. B. 50 Ω in HFSS.');
    }
    if (version.startsWith('2.') && state !== 'end') {
      warnings.push('[End] fehlt. Prüfe, ob der Sweep vollständig ist.');
    }
    if (unknownVendorRefs && options.kind === 'S') {
      warnings.push('Proprietärer Port-Impedanz-Kommentar. Bitte prüfe die Wellenreferenzen der Datei. Die Berechnung verwendet die reellen Touchstone-Referenzen.');
    }
    if (!optionFound) warnings.push('Optionszeile fehlt. Standardwerte für Format und Frequenzeinheit wurden verwendet.');
    // LAN transformers with centre taps (WE-LAN, 6 ports): ports 1–3 and 4–6 each sit on three consecutive pins of one side,
    // the middle one is the tap (left open). 7490220115 keeps its established assignment. Any other part: primary P1 (+) / P3 (−);
    // the secondary + is the port drawn on the same sketch line as port 1 (the sketch draws the windings straight across, so the
    // dotted ends share the top line, as in the data sheets). The measurement checks this: the editor shows the polarity it finds.
    const pins = indices(n).map(i => packagePins.get(i + 1));
    const runOf = list => list.every(Number.isFinite) && [1, -1].some(step => list.every((pin, k) => !k || pin === list[k - 1] + step));
    const lanFamily = lanPart || /^WE-LAN\b/i.test(vendor?.family ?? '');
    const pinout0115 = [1, 2, 3, 22, 23, 24];
    let profile = null;
    if (n === 6 && options.kind === 'S' && !fileModes && lanFamily && runOf(pins.slice(0, 3)) && runOf(pins.slice(3))) {
      const fixedPart = lanPart && pinout0115.every((pin, i) => pins[i] === pin);
      const plus = fixedPart ? 3 : sketchRows.get(1) === 6 ? 5 : 3, minus = plus === 5 ? 3 : 5;
      profile = { part: fixedPart ? '7490220115' : vendor?.part ?? 'WE-LAN', pairs: [{ p: 0, q: 2 }, { p: plus, q: minus }], taps: [1, 4], pins };
      const labels = fixedPart ? ['D1+', 'CD1', 'D1−', 'X1+', 'CX1', 'X1−'] : ['1+', 'CT1', '1−', ...(plus === 3 ? ['2+', 'CT2', '2−'] : ['2−', 'CT2', '2+'])];
      labels.forEach((label, i) => { if (!portNames.has(i)) portNames.set(i, label + ' · Pin ' + pins[i]); });
    }
    return {
      name, n, refs, freq: Float64Array.from(freq), samples, version, format: options.format, sourceKind: options.kind,
      portNames: indices(n).map(i => portNames.get(i) || ''), sourcePairs: fileModes?.pairs || [],
      profile, embedded: spa, vendor, warnings: [...new Set(warnings)], noiseCount, demo: false
    };
  }

  // Index the original tokens through exactly the same matrix order and block boundaries as import.
  function inspectSource(text, name) {
    const source = { rows: [] };
    try {
      const d = parseTouchstone(text, name, source);
      return { ...source, freq: d.freq, n: d.n, warnings: d.warnings,
        physicalRefs: d.refs, sourcePairs: d.sourcePairs, embedded: d.embedded };
    } catch (error) {
      return { error: error.message, diagnostic: source.diagnostic, rows: [] };
    }
  }

  function loadGamma(load, ref, f) {
    if (load.type === 'join') return [1, 0];
    if (load.type === 'open') return [1, 0];
    if (load.type === 'short') return [-1, 0];
    if (load.type === 'match') return [0, 0];
    if (load.type === 'resistor' || load.type === 'complex') {
      const x = load.type === 'complex' ? load.x : 0;
      return div([load.r - ref, x], [load.r + ref, x]);
    }
    const omega = TAU * f;
    if (load.type === 'series') {
      if (load.c && omega === 0) return [1, 0];
      const x = omega * load.l - (load.c ? 1 / (omega * load.c) : 0);
      if (!Number.isFinite(x)) return [1, 0];
      return div([load.r - ref, x], [load.r + ref, x]);
    }
    // An RLC branch with value zero is absent in the parallel circuit.
    if (load.l && omega === 0) return [-1, 0];
    const g = load.r ? ref / load.r : 0;
    const b = ref * (omega * load.c - (load.l ? 1 / (omega * load.l) : 0));
    if (!Number.isFinite(g) || !Number.isFinite(b)) return [-1, 0];
    return div([1 - g, -b], [1 + g, b]);
  }

  function terminate(s, n, keep, term, gamma) {
    const k = keep.length, t = term.length;
    if (k === n) return s;
    const out = submatrix(s, n, keep);
    if (!t) return out;
    const left = matrix(t), right = new Float64Array(2 * t * k);
    for (let i = 0; i < t; i++) {
      for (let j = 0; j < t; j++) {
        const coeff = mul(get(s, n, term[i], term[j]), gamma[j]);
        put(left, t, i, j, sub([Number(i === j), 0], coeff));
      }
      for (let j = 0; j < k; j++) put(right, k, i, j, get(s, n, term[i], keep[j]));
    }
    const b = solve(left, right, t, k);
    if (!b) return null;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        let value = get(out, k, i, j);
        for (let m = 0; m < t; m++) {
          value = add(value, mul(get(s, n, keep[i], term[m]), mul(gamma[m], get(b, k, m, j))));
        }
        put(out, k, i, j, value);
      }
    }
    return out;
  }

  // ---- Ports tied together form one node. Solved with sources behind the reference impedance, so ideal throughs stay well-posed. ----
  function joinInfo(loads, n) {
    if (!loads.some(load => load.type === 'join')) return null;
    const rep = indices(n).map(i => {
      let at = i;
      for (let hop = 0; loads[at].type === 'join'; hop++) {
        at = loads[at].to;
        if (!Number.isInteger(at) || at < 0 || at >= n || hop > n) throw new Error('Verbundene Ports müssen auf einen vorhandenen Port zeigen und dürfen keine Schleife bilden.');
      }
      return at;
    });
    const nodes = [...new Set(rep)].sort((a, b) => a - b);
    return { rep, nodes, node: rep.map(r => nodes.indexOf(r)) };
  }

  function joinPorts(s, n, join, refs, retry = true) {
    const m = join.nodes.length, size = n + m;
    const left = matrix(size), right = new Float64Array(2 * size * m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const sij = get(s, n, i, j), d = Number(i === j), root = Math.sqrt(refs[j]);
        put(left, size, i, j, [(d + sij[0]) * root, sij[1] * root]);
        const at = n + join.node[j], old = get(left, size, i, at);
        put(left, size, i, at, [old[0] - (d - sij[0]) / root, old[1] + sij[1] / root]);
      }
    }
    for (let g = 0; g < m; g++) {
      const z = refs[join.nodes[g]];
      put(left, size, n + g, n + g, [1, 0]);
      for (let j = 0; j < n; j++) if (join.node[j] === g) put(left, size, n + g, j, [z, 0]);
      put(right, m, n + g, g, [2 * Math.sqrt(z), 0]);
    }
    const x = solve(left, right, size, m);
    // A lossless loop (ideal through tied to itself) leaves the circulating current undetermined: retry with a trace of loss.
    if (!x) return retry ? joinPorts(s.map(value => value * (1 - 1e-9)), n, join, refs, false) : null;
    const out = matrix(n);
    // Absorbed ports stay as isolated, matched placeholders and drop out in the termination step.
    for (let g = 0; g < m; g++) {
      const root = Math.sqrt(refs[join.nodes[g]]);
      for (let k = 0; k < m; k++) {
        const v = get(x, m, n + g, k);
        put(out, n, join.nodes[g], join.nodes[k], [v[0] / root - Number(g === k), v[1] / root]);
      }
    }
    return out;
  }

  // ---- Equivalent circuit up to the second resonance: Z = R0 + (L1 ∥ C1 ∥ R1) + (L2 ∥ C2 ∥ R2). ----
  function tankImpedance(model, f) {
    const w = TAU * f;
    let re = model.r0, im = 0;
    for (const tank of model.tanks) {
      const g = Number.isFinite(tank.r) && tank.r > 0 ? 1 / tank.r : 0, b = w * (tank.c || 0) - 1 / (w * tank.l);
      const d = g * g + b * b;
      re += g / d; im -= b / d;
    }
    return [re, im];
  }

  function nelderMead(cost, start, steps) {
    const n = start.length, point = x => ({ x, f: cost(x) });
    let simplex = [start, ...start.map((_, i) => start.map((v, j) => v + (i === j ? 0.2 : 0)))].map(point);
    for (let it = 0; it < steps; it++) {
      simplex.sort((a, b) => a.f - b.f);
      const worst = simplex[n];
      const centroid = start.map((_, j) => { let sum = 0; for (let i = 0; i < n; i++) sum += simplex[i].x[j]; return sum / n; });
      const along = t => centroid.map((c, j) => c + t * (worst.x[j] - c));
      const reflected = point(along(-1));
      if (reflected.f < simplex[0].f) {
        const expanded = point(along(-2));
        simplex[n] = expanded.f < reflected.f ? expanded : reflected;
      } else if (reflected.f < simplex[n - 1].f) simplex[n] = reflected;
      else {
        const contracted = point(along(reflected.f < worst.f ? -0.5 : 0.5));
        if (contracted.f < Math.min(worst.f, reflected.f)) simplex[n] = contracted;
        else simplex = simplex.map((p, i) => i ? point(p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j]))) : p);
      }
    }
    simplex.sort((a, b) => a.f - b.f);
    return simplex[0];
  }

  // Levenberg–Marquardt on a vector of residual rows r(x), cost = Σ r². The Jacobian comes from forward differences (step h
  // in the units of x); the damping λ scales the diagonal of JᵀJ (Marquardt), so parameters of very different sensitivity are
  // stepped evenly. `lo`/`hi` clamp every step. Returns { x, f } like nelderMead, plus the count of model evaluations.
  function levenbergMarquardt(rows, start, { iterations = 80, h = 1e-4, lo = null, hi = null } = {}) {
    const n = start.length, sum2 = r => { if (!r) return Infinity; let s = 0; for (const v of r) { if (!Number.isFinite(v)) return Infinity; s += v * v; } return s; };
    const clamp = (v, k) => Math.min(hi ? hi[k] : Infinity, Math.max(lo ? lo[k] : -Infinity, v));
    let x = start.map(clamp), r = rows(x), f = sum2(r), lambda = 1e-3, evaluations = 1;
    if (!Number.isFinite(f)) return { x, f, evaluations };
    for (let it = 0; it < iterations; it++) {
      const J = [];
      for (let k = 0; k < n; k++) {
        const step = x[k] + h <= (hi ? hi[k] : Infinity) ? h : -h, xk = x.slice(); xk[k] += step;
        const rk = rows(xk); evaluations++;
        if (!rk || rk.length !== r.length) return { x, f, evaluations };
        J.push(rk.map((v, j) => Number.isFinite(v) ? (v - r[j]) / step : 0));
      }
      const A = J.map(a => J.map(b => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; }));
      const g = J.map(a => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * r[j]; return s; });
      let better = false;
      for (let tries = 0; tries < 14 && !better; tries++) {
        const damped = A.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-12 * (1 + v) : v));
        const inverse = invertSymmetric(damped);
        if (!inverse) { lambda *= 10; continue; }
        const next = x.map((v, k) => clamp(v - inverse[k].reduce((s, c, b) => s + c * g[b], 0), k));
        const rn = rows(next), fn = sum2(rn); evaluations++;
        if (fn < f) {
          const gain = (f - fn) / f;
          x = next; r = rn; f = fn; lambda = Math.max(1e-10, lambda / 3); better = true;
          if (gain < 1e-9) return { x, f, evaluations };
        } else lambda *= 4;
      }
      if (!better) break;
    }
    return { x, f, evaluations };
  }

  function fitResonant(freq, z) {
    const idx = [];
    for (let i = 0; i < freq.length; i++) if (z[i] && freq[i] > 0 && Number.isFinite(z[i][0]) && Number.isFinite(z[i][1]) && (z[i][0] || z[i][1])) idx.push(i);
    if (idx.length < 12) return null;
    const lm = idx.map(i => Math.log(Math.hypot(z[i][0], z[i][1])));
    const extrema = sign => {
      const out = [];
      for (let k = 3; k < idx.length - 3; k++) {
        let top = true;
        for (let d = 1; d <= 3 && top; d++) if (sign * lm[k] < sign * lm[k - d] || sign * lm[k] <= sign * lm[k + d]) top = false;
        if (!top) continue;
        let left = sign * lm[k], right = left;
        for (let j = 0; j < idx.length; j++) {
          const ratio = freq[idx[j]] / freq[idx[k]];
          if (ratio > 0.5 && ratio < 1) left = Math.min(left, sign * lm[j]);
          if (ratio > 1 && ratio < 2) right = Math.min(right, sign * lm[j]);
        }
        if (sign * lm[k] - Math.max(left, right) > 0.05) out.push(k);
      }
      return out;
    };
    const peaks = extrema(1), dips = extrema(-1);
    const re = Float64Array.from(freq, (_, i) => z[i]?.[0] ?? NaN), im = Float64Array.from(freq, (_, i) => z[i]?.[1] ?? NaN);
    const low = lowMedian(freq, re);
    const r0 = Number.isFinite(low) && low > 1e-4 ? low : 1e-3;
    const p1 = peaks[0], f1 = p1 === undefined ? NaN : freq[idx[p1]];
    let l1 = lcFit(freq, im, Number.isFinite(f1) ? f1 / 2 : freq.at(-1)).l;
    if (!(l1 > 0)) l1 = median(idx.slice(0, Math.max(6, idx.length >> 3)).map(i => im[i] / (TAU * freq[i])).filter(v => v > 0));
    if (!(l1 > 0)) return null;
    const tanks = [];
    let second = null, f2 = NaN, fMax = freq[idx.at(-1)];
    if (p1 === undefined) tanks.push({ l: l1, c: 0, r: Infinity });
    else {
      const w1 = TAU * f1;
      tanks.push({ l: l1, c: 1 / (w1 * w1 * l1), r: Math.max(re[idx[p1]], 1) });
      const p2 = peaks[1], dip = dips.find(k => k > p1 && (p2 === undefined || k < p2));
      const x1 = k => tankImpedance({ r0: 0, tanks: [tanks[0]] }, freq[idx[k]])[1];
      if (p2 !== undefined) {
        const w2 = TAU * freq[idx[p2]];
        let l2 = l1 / 50;
        if (dip !== undefined) {
          const ws = TAU * freq[idx[dip]], guess = -x1(dip) * (1 - (ws / w2) ** 2) / ws;
          if (guess > 0) l2 = guess;
        }
        tanks.push({ l: l2, c: 1 / (w2 * w2 * l2), r: Math.max(re[idx[p2]], 1) });
        second = 'parallel'; f2 = freq[idx[p2]]; fMax = Math.min(fMax, 1.3 * f2);
      } else if (dip !== undefined && -x1(dip) > 0) {
        tanks.push({ l: -x1(dip) / (TAU * freq[idx[dip]]), c: 0, r: Infinity });
        second = 'series'; f2 = freq[idx[dip]]; fMax = Math.min(fMax, 2.5 * f2);
      } else fMax = Math.min(fMax, 5 * f1);
    }
    const used = idx.filter(i => freq[i] <= fMax), stride = Math.max(1, Math.floor(used.length / 160));
    const sample = used.filter((_, k) => k % stride === 0);
    const slots = [];
    tanks.forEach((tank, t) => { for (const key of ['l', 'c', 'r']) if (Number.isFinite(tank[key]) && tank[key] > 0) slots.push([t, key]); });
    const start = [Math.log(r0), ...slots.map(([t, key]) => Math.log(tanks[t][key]))];
    // Parameters stay within a factor of about 4 of the analytic start values, so a resonance cannot drift out of the band.
    const bounded = (x, s) => start[s] + Math.max(-1.4, Math.min(1.4, x[s] - start[s]));
    const build = x => ({ r0: Math.exp(start[0] + Math.max(-4, Math.min(4, x[0] - start[0]))), tanks: tanks.map((tank, t) => { const next = { ...tank }; slots.forEach(([tt, key], s) => { if (tt === t) next[key] = Math.exp(bounded(x, s + 1)); }); return next; }) });
    const cost = x => {
      const model = build(x);
      let sum = 0;
      for (const i of sample) {
        const zm = tankImpedance(model, freq[i]);
        const dm = Math.log(Math.hypot(zm[0], zm[1]) / Math.hypot(re[i], im[i]));
        let dp = Math.atan2(zm[1], zm[0]) - Math.atan2(im[i], re[i]);
        dp -= TAU * Math.round(dp / TAU);
        sum += dm * dm + 0.5 * dp * dp;
      }
      return Number.isFinite(sum) ? sum / sample.length : Infinity;
    };
    const best = sample.length > slots.length + 2 ? nelderMead(cost, start, 220 * start.length) : { x: start };
    const model = build(Number.isFinite(best.f) && best.f <= cost(start) ? best.x : start);
    let sq = 0;
    for (const i of sample) {
      const zm = tankImpedance(model, freq[i]);
      sq += (20 * Math.log10(Math.hypot(zm[0], zm[1]) / Math.hypot(re[i], im[i]))) ** 2;
    }
    const resonance = tank => tank.c > 0 ? 1 / (TAU * Math.sqrt(tank.l * tank.c)) : NaN;
    return {
      ...model, second, fMax, err: Math.sqrt(sq / sample.length), points: sample.length,
      f1: p1 === undefined ? NaN : resonance(model.tanks[0]), f2: second === 'parallel' ? resonance(model.tanks[1]) : f2
    };
  }

  function resonantNetlist(model, name) {
    const v = value => value.toExponential(5);
    const lines = ['* S-Parameter Analyzer - equivalent circuit up to the second resonance', '.subckt ' + name + ' 1 2', 'R0 1 n1 ' + v(model.r0)];
    model.tanks.forEach((tank, i) => {
      const a = 'n' + (i + 1), b = i === model.tanks.length - 1 ? '2' : 'n' + (i + 2), k = i + 1;
      lines.push('L' + k + ' ' + a + ' ' + b + ' ' + v(tank.l));
      if (tank.c > 0) lines.push('C' + k + ' ' + a + ' ' + b + ' ' + v(tank.c));
      if (Number.isFinite(tank.r)) lines.push('R' + k + ' ' + a + ' ' + b + ' ' + v(tank.r));
    });
    lines.push('.ends ' + name);
    return lines.join('\n') + '\n';
  }

  function prepareNetwork(dataset, config) {
    const join = joinInfo(config.loads, dataset.n);
    const active = indices(dataset.n).filter(i => config.loads[i].type === 'active');
    const reducedLoads = indices(dataset.n).filter(i => !['active', 'match'].includes(config.loads[i].type));
    const nativeRefs = active.map(i => dataset.refs[i]);
    const seRefs = nativeRefs.map(r => config.ref || r);
    const notices = [];
    const pairPortSet = new Set();
    for (const pair of config.pairs) {
      const p = active.indexOf(pair.p), q = active.indexOf(pair.q);
      if (p < 0 || q < 0 || p === q || pairPortSet.has(pair.p) || pairPortSet.has(pair.q)) {
        throw new Error('Mixed-Mode-Paare müssen aus verschiedenen aktiven Ports bestehen.');
      }
      pairPortSet.add(pair.p); pairPortSet.add(pair.q);
      if (seRefs[p] !== seRefs[q]) {
        const commonRef = Math.sqrt(seRefs[p]) * Math.sqrt(seRefs[q]);
        seRefs[p] = commonRef; seRefs[q] = commonRef;
        notices.push({ id: pair.id, ref: commonRef });
      }
    }
    // Three-conductor groups (0/α/β, power-invariant Clarke transform): V0 = (V1+V2+V3)/√3, Vα = (2V1−V2−V3)/√6, Vβ = (V2−V3)/√2.
    // The transform is orthonormal, so it acts on the waves directly and every mode keeps the single-ended reference impedance;
    // the three ports need the same reference, otherwise they are renormalised to the geometric mean first (as for pairs).
    const triples = config.triples || [];
    for (const t of triples) {
      const idx = [t.a, t.b, t.c].map(port => active.indexOf(port));
      if (idx.some(i => i < 0) || new Set([t.a, t.b, t.c]).size !== 3 || [t.a, t.b, t.c].some(port => pairPortSet.has(port))) {
        throw new Error('Dreileitergruppen müssen aus drei verschiedenen aktiven Ports bestehen, die in keinem Paar und keiner anderen Gruppe sind.');
      }
      [t.a, t.b, t.c].forEach(port => pairPortSet.add(port));
      const refs3 = idx.map(i => seRefs[i]);
      if (refs3.some(r => r !== refs3[0])) {
        const common = Math.cbrt(refs3[0] * refs3[1] * refs3[2]);
        idx.forEach(i => { seRefs[i] = common; });
        notices.push({ id: 'T' + t.id, ref: common });
      }
    }
    const seModes = active.map((port, i) => ({ key: 'P' + (port + 1), type: 'P', id: port + 1, port, ref: seRefs[i] }));
    const mmModes = [], rows = [];
    const custom = value => Number.isFinite(value) && value > 0 ? value : null;
    for (const type of ['D', 'C']) {
      for (const pair of config.pairs) {
        const p = active.indexOf(pair.p), q = active.indexOf(pair.q);
        const natRef = seRefs[p] * (type === 'D' ? 2 : 0.5);
        // Optional per-pair mode impedance, e.g. 0.1 Ω / 100 Ω systems for line filters.
        const ref = custom(type === 'D' ? pair.zd : pair.zc) ?? natRef;
        mmModes.push({ key: type + pair.id, type, id: pair.id, pair, ref, natRef });
        rows.push([[p, ROOT_HALF], [q, type === 'D' ? -ROOT_HALF : ROOT_HALF]]);
      }
    }
    const R3 = 1 / Math.sqrt(3), R6 = 1 / Math.sqrt(6);
    const MODAL = { Z: [R3, R3, R3], A: [2 * R6, -R6, -R6], B: [0, ROOT_HALF, -ROOT_HALF] };
    for (const type of ['Z', 'A', 'B']) {
      for (const t of triples) {
        const idx = [t.a, t.b, t.c].map(port => active.indexOf(port)), ref = seRefs[idx[0]];
        mmModes.push({ key: type + t.id, type, id: t.id, triple: t, ref, natRef: ref });
        rows.push(idx.map((i, k) => [i, MODAL[type][k]]).filter(([, w]) => w !== 0));
      }
    }
    seModes.forEach((mode, i) => {
      if (!pairPortSet.has(mode.port)) {
        mmModes.push({ ...mode, natRef: mode.ref });
        rows.push([[i, 1]]);
      }
    });
    const mmNatRefs = mmModes.map(mode => mode.natRef), mmRefs = mmModes.map(mode => mode.ref);
    const mmRenorm = mmRefs.some((ref, i) => ref !== mmNatRefs[i]);
    return { active, reducedLoads, nativeRefs, seRefs, seModes, mmModes, rows, notices, mmNatRefs, mmRefs, mmRenorm, join, hasMixed: !!(config.pairs.length || triples.length), hasModal: !!triples.length };
  }

  function processPoint(dataset, config, layout, index) {
    const { active, reducedLoads, nativeRefs, seRefs, rows, hasMixed } = layout;
    const gamma = reducedLoads.map(i => loadGamma(config.loads[i], dataset.refs[i], dataset.freq[index]));
    if (gamma.some(v => !v)) return [null, null];
    const source = layout.join ? joinPorts(dataset.samples[index], dataset.n, layout.join, dataset.refs) : dataset.samples[index];
    if (!source) return [null, null];
    const raw = terminate(source, dataset.n, active, reducedLoads, gamma);
    const se = raw && changeRef(raw, nativeRefs, seRefs);
    let mm = hasMixed && se ? project(se, active.length, rows) : se;
    if (hasMixed && mm && layout.mmRenorm) mm = changeRef(mm, layout.mmNatRefs, layout.mmRefs);
    return [se, mm];
  }

  function reflection(gamma, ref) {
    const denominator = sub(one, gamma);
    if (abs(denominator) < 1e-14) return null;
    return div(scale(add(one, gamma), ref), denominator);
  }

  function twoPort(s, modes, a, b) {
    const r1 = modes[a].ref, r2 = modes[b].ref;
    const ref = r1 === r2 ? r1 : Math.sqrt(r1) * Math.sqrt(r2);
    return { ref, s: changeRef(submatrix(s, modes.length, [a, b]), [r1, r2], [ref, ref]) };
  }

  function transmission(t, ref, fixture) {
    if (fixture === 'series') {
      if (abs(t) < 1e-14) return null;
      const inverse = div(one, t);
      return inverse && scale(sub(inverse, one), 2 * ref);
    }
    const denominator = sub(one, t);
    if (abs(denominator) < 1e-14) return null;
    return div(scale(t, ref / 2), denominator);
  }

  function cispr(s, ref, fixture = 'series') {
    if (!s) return null;
    const s11 = get(s, 2, 0, 0), s22 = get(s, 2, 1, 1);
    const s12 = get(s, 2, 0, 1), s21 = get(s, 2, 1, 0);
    const r = scale(add(s11, s22), 0.5);
    const t = scale(add(s12, s21), 0.5);
    const rr = fixture === 'series' ? add(one, r) : sub(one, r);
    const diff = mul(sub(rr, t), add(rr, t));
    const twoT = scale(t, 2);
    const denominator = fixture === 'series' ? twoT : diff;
    const z = abs(denominator) >= 1e-14
      ? div(scale(fixture === 'series' ? diff : twoT, ref), denominator) : null;
    const lhs = sub(one, t);
    const condition = abs(mul(sub(lhs, r), add(lhs, r))) / abs(twoT);
    return { z, ref, r, t, condition, reflectionDelta: abs(sub(s11, s22)), transmissionDelta: abs(sub(s21, s12)) };
  }

  // Order of the four terminals: IN+, IN−, OUT+, OUT−.
  const NATURAL_MODES = [
    [[0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5]],
    [[0, 0.5], [1, -0.5], [2, 0.5], [3, -0.5]],
    [[0, 0.5], [1, 0.5], [2, -0.5], [3, -0.5]],
    [[0, 0.5], [1, -0.5], [2, -0.5], [3, 0.5]]
  ];

  function cmcNatural(s, refs, f) {
    if (!s || f <= 0) return null;
    const y = toZY(s, refs, 'Y');
    if (!y) return null;
    const modal = project(y, 4, NATURAL_MODES);
    const omega = TAU * f;
    const diag = indices(4).map(i => get(modal, 4, i, i));
    let crossEnergy = 0, diagonalEnergy = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const energy = abs(get(modal, 4, i, j)) ** 2;
        if (i === j) diagonalEnergy += energy;
        else crossEnergy += energy;
      }
    }
    return {
      cw: (diag[1][1] - diag[0][1]) / (2 * omega), cg: diag[0][1] / omega,
      h: diag[2], d: diag[3], coupling: Math.sqrt(crossEnergy / diagonalEnergy), y: diag
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function fitMode(points, center, key) {
    let xx = 0, xy = 0, yy = 0, xb = 0, yb = 0, bb = 0;
    for (const { f, value } of points) {
      const x = f / center, y = 1 / x, b = value[key][1];
      xx += x * x; xy += x * y; yy += y * y;
      xb += x * b; yb += y * b; bb += b * b;
    }
    const det = xx * yy - xy * xy;
    if (!(det > 1e-10 * xx * yy)) return null;
    const a = (yy * xb - xy * yb) / det;
    const b = (xx * yb - xy * xb) / det;
    let error = 0;
    for (const { f, value } of points) {
      const x = f / center;
      error += (value[key][1] - a * x - b / x) ** 2;
    }
    const omega = TAU * center;
    return { cap: a / omega, inductance: b < 0 ? -2 / (b * omega) : NaN, error: Math.sqrt(error / bb) };
  }

  function fitCMC(freq, data, lo, hi) {
    const points = [];
    for (let i = 0; i < freq.length; i++) {
      if (freq[i] >= lo && freq[i] <= hi && data[i]) points.push({ f: freq[i], value: data[i] });
    }
    const count = points.length;
    if (count < 3) return { count };
    const center = Math.sqrt(points[0].f) * Math.sqrt(points.at(-1).f);
    const h = fitMode(points, center, 'h'), d = fitMode(points, center, 'd');
    const cw = median(points.map(p => p.value.cw)), cg = median(points.map(p => p.value.cg));
    const ctH = h ? (h.cap - cg) / 2 : NaN;
    const ctD = d ? (d.cap - cg - 2 * cw) / 2 : NaN;
    const lcm = h?.inductance, ldm = d?.inductance;
    const l = (lcm + ldm) / 2, m = (lcm - ldm) / 2;
    return {
      count, cw, cg, ctH, ctD, lcm, ldm, l, m, k: m / l, hError: h?.error, dError: d?.error,
      coupling: median(points.map(p => p.value.coupling))
    };
  }

  function demoBlock(f, { lcm, ldm, cw, cg, ct, rcm, rdm }) {
    const omega = TAU * f;
    const diagonal = matrix(4);
    put(diagonal, 4, 0, 0, [0, omega * cg]);
    put(diagonal, 4, 1, 1, [0, omega * (2 * cw + cg)]);
    put(diagonal, 4, 2, 2, [2 / rcm, omega * (2 * ct + cg) - 2 / (omega * lcm)]);
    put(diagonal, 4, 3, 3, [2 / rdm, omega * (2 * ct + 2 * cw + cg) - 2 / (omega * ldm)]);
    return project(diagonal, 4, NATURAL_MODES);
  }

  function demoNetwork(n = 4) {
    const order = [0, 2, 1, 3];
    const refs = Array(n).fill(50);
    const freq = Float64Array.from(indices(601), i => 10 ** (4 + 5 * i / 600));
    const nominal = { lcm: 210e-6, ldm: 2.4e-6, cw: 1.8e-12, cg: 0.32e-12, ct: 2.8e-12, rcm: 5600, rdm: 820 };
    const auxiliary = { lcm: 39e-6, ldm: 6e-6, cw: 2.5e-12, cg: 0.55e-12, ct: 3.6e-12, rcm: 2300, rdm: 490 };
    const samples = Array.from(freq, f => {
      const y = matrix(n);
      function insert(block, offset) {
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) put(y, n, order[i] + offset, order[j] + offset, get(block, 4, i, j));
        }
      }
      function bridge(a, b, capacitance) {
        const v = TAU * f * capacitance;
        y[2 * (a * n + a) + 1] += v;
        y[2 * (b * n + b) + 1] += v;
        y[2 * (a * n + b) + 1] -= v;
        y[2 * (b * n + a) + 1] -= v;
      }
      insert(demoBlock(f, nominal), 0);
      if (n === 8) {
        insert(demoBlock(f, auxiliary), 4);
        bridge(1, 4, 1.5e-12);
        bridge(3, 6, 0.9e-12);
        bridge(0, 7, 0.35e-12);
      }
      return fromZY(y, refs, 'Y');
    });
    return {
      n, name: n === 4 ? 'CMC-Beispiel.s4p' : 'CMC-Mehrport-Beispiel.s8p',
      refs, freq, samples, format: 'RI', sourceKind: 'S', version: '1.0', noiseCount: 0, warnings: [],
      portNames: ['Eingang +', 'Ausgang +', 'Eingang −', 'Ausgang −', 'Aux A +', 'Aux B +', 'Aux A −', 'Aux B −'].slice(0, n),
      sourcePairs: [{ p: 0, q: 2 }, { p: 1, q: 3 }], demo: true, nominal
    };
  }

  // ---------- Equivalent-circuit (ESB) extraction ----------
  // Plateau search after Touchstone Studio: the longest window whose spread around its median stays below tol.
  function plateau(freq, values, fLo, fHi, tol = 0.15) {
    const idx = [];
    for (let i = 0; i < freq.length; i++) {
      if (freq[i] >= fLo && freq[i] <= fHi && Number.isFinite(values[i]) && values[i] > 0) idx.push(i);
    }
    if (idx.length < 3) return { value: NaN, conf: 0, stable: false, band: null };
    const sub = idx.map(i => values[i]);
    let best = { value: median(sub), conf: 0, stable: false, band: [freq[idx[0]], freq[idx.at(-1)]] };
    for (let ws = sub.length; ws >= Math.max(3, Math.floor(sub.length / 6)); ws = Math.floor(ws * 0.8)) {
      for (let start = 0; start + ws <= sub.length; start += Math.max(1, Math.floor(ws / 8))) {
        const win = sub.slice(start, start + ws);
        const m = median(win);
        const spread = Math.max(...win.map(v => Math.abs(v - m))) / m;
        if (spread < tol) {
          const conf = ws / sub.length * (1 - spread / tol);
          if (conf > best.conf) best = { value: m, conf, stable: true, band: [freq[idx[start]], freq[idx[start + ws - 1]]] };
        }
      }
      if (best.stable) break;
    }
    return best;
  }

  // Frequency where y changes sign in the given direction (+1: − → +), log-interpolated.
  function crossing(freq, y, direction = 1, from = 0) {
    let prev = null;
    for (let i = from; i < freq.length; i++) {
      const v = y[i];
      if (!(freq[i] > 0) || !Number.isFinite(v)) { prev = null; continue; }
      if (prev && Math.sign(prev.v) === -direction && Math.sign(v) !== -direction) {
        const t = prev.v / (prev.v - v);
        return Math.exp(Math.log(prev.f) + t * (Math.log(freq[i]) - Math.log(prev.f)));
      }
      prev = { f: freq[i], v };
    }
    return NaN;
  }

  // Resonance as the maximum of |Z| with a parabola through log f / log |Z| (a pole is not a zero crossing).
  function peakFreq(freq, values, fLo = 0, fHi = Infinity) {
    let best = -1;
    for (let i = 0; i < freq.length; i++) {
      if (freq[i] > 0 && freq[i] >= fLo && freq[i] <= fHi && Number.isFinite(values[i]) && values[i] > 0 && (best < 0 || values[i] > values[best])) best = i;
    }
    if (best <= 0 || best >= freq.length - 1) return NaN;
    const [a, b, c] = [best - 1, best, best + 1];
    if (![values[a], values[c]].every(v => Number.isFinite(v) && v > 0)) return freq[best];
    const x = [a, b, c].map(i => Math.log(freq[i])), y = [a, b, c].map(i => Math.log(values[i]));
    const den = (x[0] - x[1]) * (x[0] - x[2]) * (x[1] - x[2]);
    const A = (x[2] * (y[1] - y[0]) + x[1] * (y[0] - y[2]) + x[0] * (y[2] - y[1])) / den;
    const B = (x[2] ** 2 * (y[0] - y[1]) + x[1] ** 2 * (y[2] - y[0]) + x[0] ** 2 * (y[1] - y[2])) / den;
    return A < 0 ? Math.exp(-B / (2 * A)) : freq[best];
  }

  // Below a parallel resonance X = ωL/(1 − ω²LC), so ω/X = 1/L − ω²C is linear in ω².
  function lcFit(freq, x, fHi) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < freq.length; i++) {
      const w = TAU * freq[i];
      if (!(freq[i] > 0) || freq[i] > fHi || !(x[i] > 0)) continue;
      const u = w * w, v = w / x[i];
      n++; sx += u; sy += v; sxx += u * u; sxy += u * v;
    }
    if (n < 5) return { l: NaN, c: NaN, n };
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intercept = (sy - slope * sx) / n;
    return { l: intercept > 0 ? 1 / intercept : NaN, c: -slope, n };
  }

  function lowMedian(freq, values, count = 5) {
    const picked = [];
    for (let i = 0; i < freq.length && picked.length < count; i++) {
      if (freq[i] > 0 && Number.isFinite(values[i])) picked.push(values[i]);
    }
    return picked.length ? median(picked) : NaN;
  }

  function nearestIndex(freq, target) {
    let best = 0;
    for (let i = 1; i < freq.length; i++) if (Math.abs(Math.log(freq[i] / target)) < Math.abs(Math.log(freq[best] / target))) best = i;
    return best;
  }

  // Per frequency: transformer quantities from the DD block (Z) and the CC block (Y) of two pairs.
  function transformerPoint(dd, ddRefs, cc, ccRefs, f) {
    const w = TAU * f;
    const z = dd && toZY(dd, ddRefs, 'Z');
    const y = cc && toZY(cc, ccRefs, 'Y');
    const out = { l11: NaN, l22: NaN, m: NaN, lsc: NaN, rsc: NaN, x11: NaN, z11: NaN, cww: NaN, c1g: NaN, c2g: NaN };
    if (z && w > 0) {
      const z11 = get(z, 2, 0, 0), z22 = get(z, 2, 1, 1), z12 = get(z, 2, 0, 1), z21 = get(z, 2, 1, 0);
      out.x11 = z11[1]; out.z11 = abs(z11);
      out.l11 = z11[1] / w; out.l22 = z22[1] / w;
      out.m = (z12[1] + z21[1]) / 2 / w;
      // Primary with the secondary shorted: Zsc = Z11 − Z12·Z21/Z22 (datasheet leakage method).
      const ratio = div(mul(z12, z21), z22);
      if (ratio) {
        const zsc = sub(z11, ratio);
        out.lsc = zsc[1] / w; out.rsc = zsc[0];
      }
    }
    if (y && w > 0) {
      const y11 = get(y, 2, 0, 0), y22 = get(y, 2, 1, 1), y12 = get(y, 2, 0, 1), y21 = get(y, 2, 1, 0);
      out.cww = -(y12[1] + y21[1]) / 2 / w;
      out.couplingZ = div(one, scale(add(y12, y21), -0.5));
      out.c1g = (y11[1] + y12[1]) / w;
      out.c2g = (y22[1] + y21[1]) / w;
    }
    return out;
  }

  function analyzeTransformer(freq, points, evalFreq = 100e3) {
    const series = key => Float64Array.from(points, p => p ? p[key] : NaN);
    const l11 = series('l11'), l22 = series('l22'), m = series('m'), lsc = series('lsc'), rsc = series('rsc');
    const x11 = series('x11'), z11 = series('z11'), cww = series('cww');
    const fres = peakFreq(freq, z11);
    const fEnd = Number.isFinite(fres) ? fres / 3 : freq.at(-1);
    const iEval = nearestIndex(freq, Math.min(Math.max(evalFreq, freq.find(f => f > 0) ?? evalFreq), fEnd));
    const ocl = l11[iEval], ls = l22[iEval], mm = m[iEval];
    const k = mm / Math.sqrt(ocl * ls);
    const leak = plateau(freq, lsc, freq.find(f => f > 0) ?? 0, Number.isFinite(fres) ? fres / 2 : freq.at(-1), 0.15);
    const cap = plateau(freq, cww, 0, Number.isFinite(fres) ? fres : freq.at(-1), 0.2);
    const fit = lcFit(freq, x11, Number.isFinite(fres) ? fres / 2 : freq.at(-1));
    // Thomson: the main inductance and the open-circuit resonance give the winding capacitance; C(f) checks it over frequency.
    const lRef = fit.l > 0 ? fit.l : ocl;
    const cres = Number.isFinite(fres) && lRef > 0 ? 1 / ((TAU * fres) ** 2 * lRef) : NaN;
    const cparCurve = Float64Array.from(freq, (f, i) => f > 0 && lRef > 0 && x11[i] ? 1 / ((TAU * f) ** 2 * lRef) - 1 / (TAU * f * x11[i]) : NaN);
    return {
      cres, fEval: freq[iEval], ocl, ocl0: fit.l, l22: ls, m: mm, k, n: Math.sqrt(ls / ocl),
      leak: leak.value, leakConf: leak.conf, leakBand: leak.band,
      rdc: lowMedian(freq, rsc), cww: cap.value, cwwConf: cap.conf, cwwBand: cap.band,
      fres, cpar: fit.c > 0 ? fit.c : NaN,
      series: { l11, l22, m, lsc, rsc, cww, z11, cpar: cparCurve }
    };
  }

  // Two-terminal component from Z(f): 'series' (inductor, ferrite) or 'shunt' (capacitor).
  function analyzeElement(freq, z, kind) {
    const re = Float64Array.from(freq, (_, i) => z[i]?.[0] ?? NaN);
    const im = Float64Array.from(freq, (_, i) => z[i]?.[1] ?? NaN);
    const w = f => TAU * f;
    const first = freq.find(f => f > 0) ?? 0;
    if (kind === 'series') {
      const mag = Float64Array.from(freq, (_, i) => Math.hypot(re[i], im[i]));
      const fsrf = peakFreq(freq, mag);
      const lCurve = Float64Array.from(freq, (f, i) => f > 0 && Number.isFinite(im[i]) ? im[i] / w(f) : NaN);
      const fit = lcFit(freq, im, Number.isFinite(fsrf) ? fsrf / 2 : freq.at(-1));
      const flat = plateau(freq, lCurve, first, Number.isFinite(fsrf) ? fsrf / 3 : freq.at(-1), 0.12);
      const l = Number.isFinite(fit.l) ? { value: fit.l, conf: flat.conf, band: flat.band } : flat;
      let rPeak = NaN;
      if (Number.isFinite(fsrf)) {
        for (let i = 0; i < freq.length; i++) {
          if (freq[i] > fsrf / 2 && freq[i] < fsrf * 2 && Number.isFinite(re[i])) rPeak = Number.isFinite(rPeak) ? Math.max(rPeak, re[i]) : re[i];
        }
      }
      return {
        kind, l: l.value, lConf: l.conf, lBand: l.band, rdc: lowMedian(freq, re), fsrf,
        cp: Number.isFinite(fsrf) && l.value > 0 ? 1 / ((TAU * fsrf) ** 2 * l.value) : NaN, rp: rPeak, lFlat: flat.value, model: fitResonant(freq, z),
        series: { l: lCurve, r: re, c: Float64Array.from(freq, (f, i) => f > 0 && l.value > 0 && im[i] ? 1 / (w(f) ** 2 * l.value) - 1 / (w(f) * im[i]) : NaN) }
      };
    }
    const fsrf = crossing(freq, im, 1);
    const cCurve = Float64Array.from(freq, (f, i) => f > 0 && im[i] < 0 ? -1 / (w(f) * im[i]) : NaN);
    const lCurve = Float64Array.from(freq, (f, i) => f > 0 && im[i] > 0 ? im[i] / w(f) : NaN);
    const c = plateau(freq, cCurve, first, Number.isFinite(fsrf) ? fsrf / 3 : freq.at(-1), 0.12);
    const esl = Number.isFinite(fsrf) ? plateau(freq, lCurve, fsrf * 2, freq.at(-1), 0.2) : { value: NaN, conf: 0 };
    let esr = NaN;
    if (Number.isFinite(fsrf)) esr = re[nearestIndex(freq, fsrf)];
    // The extraction above uses the one-signed parts only; the curves for display keep the sign, so the change of
    // character at the self-resonance stays visible instead of leaving a gap.
    return {
      kind, c: c.value, cConf: c.conf, cBand: c.band, fsrf, esl: esl.value, eslConf: esl.conf, esr,
      series: {
        c: Float64Array.from(freq, (f, i) => f > 0 && im[i] ? -1 / (w(f) * im[i]) : NaN),
        l: Float64Array.from(freq, (f, i) => f > 0 && Number.isFinite(im[i]) ? im[i] / w(f) : NaN), r: re
      }
    };
  }

  // A CMC conducts common mode galvanically at low frequency, a transformer isolates it.
  function classify4(freq, sccLow, sddLow) {
    if (!Number.isFinite(sccLow)) return { type: 'unknown', confidence: 0 };
    if (sccLow > 0.5) return { type: 'cmc', confidence: Math.min(1, (sccLow - 0.5) / 0.4 + 0.5) };
    if (sccLow < 0.2) return { type: 'transformer', confidence: Math.min(1, (0.2 - sccLow) / 0.18 + 0.5) };
    return { type: sddLow > sccLow ? 'transformer' : 'cmc', confidence: 0.3 };
  }

  // ---- Port profile: a machine-readable comment block that travels inside the Touchstone file. ----
  function keyValues(tokens) {
    const out = {};
    for (const token of tokens) {
      const match = token.match(/^(\w+)=(.+)$/);
      if (match) out[match[1].toLowerCase()] = match[2];
    }
    return out;
  }

  function readProfileLine(spa, text) {
    const match = text.match(/^SPA\s+(\w+)(?:\s+([^:]*?))?\s*:\s*(.*)$/i);
    if (!match) return;
    const key = match[1].toLowerCase(), arg = (match[2] || '').trim(), value = match[3].trim();
    const tokens = value.split(/\s+/).filter(Boolean);
    if (key === 'name') spa.name = value.slice(0, 60);
    else if (key === 'pair') {
      const kv = keyValues(tokens);
      spa.pairs.push({ id: Number(arg), p: Number(tokens[0]) - 1, q: Number(tokens[1]) - 1, zd: parseNum(kv.zd ?? ''), zc: parseNum(kv.zc ?? '') });
    } else if (key === 'load') {
      const kv = keyValues(tokens), load = { type: (tokens[0] || '').toLowerCase() };
      for (const k of ['r', 'x', 'l', 'c']) if (k in kv) load[k] = parseNum(kv[k]);
      if ('to' in kv) load.to = Number(kv.to) - 1;
      spa.loads.push({ port: Number(arg) - 1, load });
    } else if (key === 'ref') spa.ref = parseNum(value);
    else if (key === 'view') spa.view = keyValues(tokens);
    else if (key === 'traces') spa.traces[arg.toLowerCase()] = tokens.slice(0, 16);
    else if (key === 'markers') spa.markers = tokens.map(parseNum).filter(Number.isFinite).slice(0, 4);
  }

  function profileLines(profile) {
    const n = value => String(+Number(value).toPrecision(9));
    const lines = ['[SPA-Port-Profile] 1', 'SPA app: S-Parameter Analyzer port profile, machine-readable, ports are 1-based'];
    if (profile.name) lines.push('SPA name: ' + profile.name.replace(/[\r\n!]/g, ' ').slice(0, 60));
    for (const pair of profile.pairs) {
      lines.push('SPA pair ' + pair.id + ': ' + (pair.p + 1) + ' ' + (pair.q + 1) +
        (pair.zd > 0 ? ' zd=' + n(pair.zd) : '') + (pair.zc > 0 ? ' zc=' + n(pair.zc) : ''));
    }
    profile.loads.forEach((load, port) => {
      if (load.type === 'active') return;
      lines.push('SPA load ' + (port + 1) + ': ' + load.type +
        (load.type === 'join' ? ' to=' + (load.to + 1) : '') +
        ['r', 'x', 'l', 'c'].filter(k => Number.isFinite(load[k]) && load[k] !== 0).map(k => ' ' + k + '=' + n(load[k])).join(''));
    });
    if (profile.ref > 0) lines.push('SPA ref: ' + n(profile.ref));
    lines.push('SPA view: tab=' + profile.tab + ' basis=' + profile.basis + ' format=' + profile.sFormat);
    for (const basis of ['mm', 'se']) {
      if (profile.sKeys?.[basis]?.length) lines.push('SPA traces ' + basis + ': ' + profile.sKeys[basis].join(' '));
    }
    if (profile.markers?.length) lines.push('SPA markers: ' + profile.markers.map(n).join(' '));
    lines.push('[End SPA-Port-Profile]');
    return lines;
  }

  // Touchstone 1.x: comment block at the top. Touchstone 2.x: inside [Begin Information] … [End Information].
  function annotate(text, lines) {
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const out = [];
    let skip = false;
    for (const line of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
      const comment = /^\s*!/.test(line), body = line.replace(/^\s*!\s*/, '');
      if (comment && /^\[SPA-Port-Profile\]/i.test(body)) { skip = true; continue; }
      if (skip && comment) {
        if (/^\[End SPA-Port-Profile\]/i.test(body)) skip = false;
        continue;
      }
      skip = false;
      out.push(line);
    }
    const block = lines.map(line => '! ' + line);
    if (out.some(line => /^\s*\[version\]\s*2/i.test(line))) {
      const begin = out.findIndex(line => /^\s*\[begin information\]/i.test(line));
      const network = out.findIndex(line => /^\s*\[network data\]/i.test(line));
      if (begin >= 0) out.splice(begin + 1, 0, ...block);
      else if (network >= 0) out.splice(network, 0, '[Begin Information]', ...block, '[End Information]');
      else out.unshift(...block);
    } else out.unshift(...block);
    return out.join(eol);
  }

  function exportTouchstone(dataset, network, basis) {
    const layout = network.layout, active = layout.active;
    const mixed = basis === 'mm' && layout.hasMixed;
    if (mixed && layout.hasModal) throw new Error('Touchstone kennt keine 0/α/β-Moden. Exportiere die Single-Ended-Daten oder entferne die Dreileitergruppen.');
    let samples = mixed ? network.mm : network.se;
    // Touchstone mixed-mode data refer to 2R / R/2; custom pair impedances are undone for the file.
    if (mixed && layout.mmRenorm) samples = samples.map(s => s && changeRef(s, layout.mmRefs, layout.mmNatRefs));
    const count = samples.filter(Boolean).length, n = active.length;
    if (!count) throw new Error('Es sind keine gültigen Matrixpunkte vorhanden.');
    const num = value => Number(value.toPrecision(13)).toString();
    const comment = text => text.replace(/−/g, '-').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ');
    const lines = [
      '! S-Parameter Analyzer',
      '! Quelle: ' + comment(dataset.name),
      '! Aktive Originalports: ' + active.map(i => 'P' + (i + 1)).join(', '),
      '[Version] 2.1',
      '# Hz S RI R 50',
      '[Number of Ports] ' + n
    ];
    active.forEach((port, i) => {
      const name = dataset.portNames[port];
      lines.push('! Port[' + (i + 1) + '] = P' + (port + 1) + (name ? ' ' + comment(name) : ''));
    });
    if (samples.length !== count) lines.push('! Ausgelassene singuläre Frequenzpunkte: ' + (samples.length - count));
    if (n === 2) lines.push('[Two-Port Data Order] 12_21');
    lines.push('[Number of Frequencies] ' + count, '[Reference] ' + layout.seRefs.join(' '), '[Matrix Format] Full');
    if (mixed) {
      const id = p => active.indexOf(p) + 1;
      const order = layout.mmModes.map(mode => mode.type === 'P'
        ? 'S' + id(mode.port)
        : mode.type + id(mode.pair.p) + ',' + id(mode.pair.q));
      lines.push('[Mixed-Mode Order] ' + order.join(' '));
    }
    lines.push('[Network Data]');
    samples.forEach((s, i) => {
      if (s) lines.push(dataset.freq[i] + ' ' + Array.from(s, num).join(' '));
    });
    lines.push('[End]', '');
    return lines.join('\n');
  }

  // ---- Editable two-pole models: named parameters the interface can show, change, fix and re-optimise. ----
  // 'tanks': R0 in series with up to two parallel tanks (inductor, ferrite, bead) – the model of fitResonant.
  // 'rlc':   ESR + ESL + C in series, optionally a leakage resistance Rp across C (capacitor).
  // All parameters are positive by construction (the optimiser works on their logarithms), so no fit can return
  // a negative inductance, capacitance or resistance.
  function modelImpedance(model, f) {
    if (model.type !== 'rlc') return tankImpedance(model, f);
    const w = TAU * f, g = model.rp > 0 && Number.isFinite(model.rp) ? 1 / model.rp : 0, b = w * model.c, d = g * g + b * b;
    return [model.esr + g / d, w * (model.esl || 0) - b / d];
  }
  function modelParams(model) {
    const ok = v => Number.isFinite(v) && v > 0;
    if (model.type === 'cmc' || model.type === 'trafo') return MULTI_KEYS[model.type].filter(key => ok(model[key])).map(key => ({ key, value: model[key] }));
    if (model.type === 'rlc') return [['c', model.c], ['esr', model.esr], ...(ok(model.esl) ? [['esl', model.esl]] : []), ...(ok(model.rp) ? [['rp', model.rp]] : [])].map(([key, value]) => ({ key, value }));
    const out = [{ key: 'r0', value: model.r0 }];
    model.tanks.forEach((tank, t) => { for (const key of ['l', 'c', 'r']) if (ok(tank[key])) out.push({ key: key + (t + 1), value: tank[key] }); });
    return out;
  }
  function modelWith(model, values) {
    const ok = v => Number.isFinite(v) && v > 0, next = { ...model };
    if (model.type === 'cmc' || model.type === 'trafo') {
      for (const key of MULTI_KEYS[model.type]) if (ok(values?.[key]) && ok(model[key])) next[key] = values[key];
      return next;
    }
    if (model.type === 'rlc') {
      for (const key of ['c', 'esr', 'esl', 'rp']) if (ok(values?.[key])) next[key] = values[key];
      return next;
    }
    if (ok(values?.r0)) next.r0 = values.r0;
    next.tanks = model.tanks.map((tank, t) => { const copy = { ...tank }; for (const key of ['l', 'c', 'r']) if (ok(values?.[key + (t + 1)]) && ok(tank[key])) copy[key] = values[key + (t + 1)]; return copy; });
    const resonance = tank => tank && tank.c > 0 ? 1 / (TAU * Math.sqrt(tank.l * tank.c)) : NaN;
    if (Number.isFinite(model.f1)) next.f1 = resonance(next.tanks[0]);
    if (model.second === 'parallel') next.f2 = resonance(next.tanks[1]);
    return next;
  }
  function modelPoints(freq, z, band) {
    const idx = [];
    for (let i = 0; i < freq.length; i++) {
      if (!z[i] || !(freq[i] > 0) || !Number.isFinite(z[i][0]) || !Number.isFinite(z[i][1]) || !(z[i][0] || z[i][1])) continue;
      if (band && (freq[i] < band[0] || freq[i] > band[1])) continue;
      idx.push(i);
    }
    return idx;
  }
  // Deviation of a model from the measurement inside a band: magnitude in dB RMS, phase in degrees RMS.
  function modelQuality(freq, z, model, band = null) {
    const idx = modelPoints(freq, z, band);
    if (!idx.length) return { err: NaN, phase: NaN, points: 0, band: band ?? [NaN, NaN] };
    let sq = 0, ph = 0;
    for (const i of idx) {
      const zm = modelImpedance(model, freq[i]);
      sq += (20 * Math.log10(Math.hypot(zm[0], zm[1]) / Math.hypot(z[i][0], z[i][1]))) ** 2;
      let dp = Math.atan2(zm[1], zm[0]) - Math.atan2(z[i][1], z[i][0]);
      dp -= TAU * Math.round(dp / TAU);
      ph += dp * dp;
    }
    return { err: Math.sqrt(sq / idx.length), phase: Math.sqrt(ph / idx.length) / RAD, points: idx.length, band: [freq[idx[0]], freq[idx.at(-1)]] };
  }
  // Re-optimises the free parameters of a model on the complex impedance (magnitude and phase) inside a band.
  // Fixed parameters keep their value. Returns null when the band holds too few points for the free parameters.
  function fitModel(freq, z, model, { fixed = [], band = null } = {}) {
    const hold = new Set(fixed), free = modelParams(model).filter(p => !hold.has(p.key));
    const idx = modelPoints(freq, z, band);
    if (idx.length < Math.max(8, free.length + 3)) return null;
    const stride = Math.max(1, Math.floor(idx.length / 200)), sample = idx.filter((_, k) => k % stride === 0);
    if (!free.length) return { model, ...modelQuality(freq, z, model, band), free: 0 };
    const start = free.map(p => Math.log(p.value));
    const build = x => modelWith(model, Object.fromEntries(free.map((p, k) => [p.key, Math.exp(start[k] + Math.max(-7, Math.min(7, x[k] - start[k])))])));
    const cost = x => {
      const m = build(x);
      let sum = 0;
      for (const i of sample) {
        const zm = modelImpedance(m, freq[i]);
        const dm = Math.log(Math.hypot(zm[0], zm[1]) / Math.hypot(z[i][0], z[i][1]));
        let dp = Math.atan2(zm[1], zm[0]) - Math.atan2(z[i][1], z[i][0]);
        dp -= TAU * Math.round(dp / TAU);
        sum += dm * dm + 0.5 * dp * dp;
      }
      return Number.isFinite(sum) ? sum / sample.length : Infinity;
    };
    // Two passes: the simplex is restarted around its first result, which gets it out of a collapsed simplex.
    let best = nelderMead(cost, start, 260 * start.length);
    const again = nelderMead(cost, best.x, 160 * start.length);
    if (again.f < best.f) best = again;
    const fitted = Number.isFinite(best.f) && best.f <= cost(start) ? build(best.x) : model;
    return { model: fitted, ...modelQuality(freq, z, fitted, band), free: free.length };
  }
  // Capacitor: start values from the plateau analysis (C below the self-resonance, ESL above it, ESR at it), then a complex fit.
  function fitCapacitor(freq, z) {
    const r = analyzeElement(freq, z, 'shunt');
    if (!(r.c > 0)) return null;
    const idx = modelPoints(freq, z, null);
    if (idx.length < 12) return null;
    const re = idx.map(i => z[i][0]).filter(v => v > 0).sort((a, b) => a - b);
    const esr = r.esr > 0 ? r.esr : re.length ? re[0] : 1e-3;
    const esl = r.esl > 0 ? r.esl : Number.isFinite(r.fsrf) ? 1 / ((TAU * r.fsrf) ** 2 * r.c) : NaN;
    const start = { type: 'rlc', c: r.c, esr, esl: esl > 0 ? esl : 0, rp: Infinity, fsrf: r.fsrf };
    const fit = fitModel(freq, z, start, {});
    const model = fit ? fit.model : start;
    return { ...model, fsrf: model.esl > 0 ? 1 / (TAU * Math.sqrt(model.esl * model.c)) : NaN, fMax: freq[idx.at(-1)] };
  }
  function modelNetlist(model, name) {
    if (model.type === 'cmc' || model.type === 'trafo') return multiNetlist(model, name);
    if (model.type !== 'rlc') return resonantNetlist(model, name);
    const v = value => value.toExponential(5), coil = model.esl > 0;
    const lines = ['* S-Parameter Analyzer - capacitor equivalent circuit: ESR + ESL + C', '.subckt ' + name + ' 1 2', 'R1 1 n1 ' + v(model.esr)];
    if (coil) lines.push('L1 n1 n2 ' + v(model.esl));
    lines.push('C1 ' + (coil ? 'n2' : 'n1') + ' 2 ' + v(model.c));
    if (model.rp > 0 && Number.isFinite(model.rp)) lines.push('R2 ' + (coil ? 'n2' : 'n1') + ' 2 ' + v(model.rp));
    lines.push('.ends ' + name);
    return lines.join('\n') + '\n';
  }

  // ---- Editable four-terminal models (CMC, transformer). Same idea as the two-pole models: named, positive
  // parameters that the interface shows, changes, fixes and re-optimises; the netlist is the same circuit. ----
  const fin = v => Number.isFinite(v) && v > 0;
  const par = (a, b) => div(mul(a, b), add(a, b));
  // CMC, terminals IN+, IN−, OUT+, OUT−. Per winding: R_w + Lσ in series with the coupled part (M, k = 1, R_Fe across it);
  // C_t across each winding, C_w between the windings on each side, C_x diagonally (IN+ to OUT−, IN− to OUT+), C_g from every
  // terminal to ground. These four are the complete capacitance network of a symmetric four-terminal part: one value per natural mode.
  // Without C_x the three others have to explain four modal capacitances, and a real choke then yields a negative C_t.
  // In the natural modes the coupled part is 2M (common mode) or zero (differential mode).
  // R_σ across Lσ: the loss of the leakage path (leakage flux through the ferrite, proximity losses). Real chokes show it as a
  // differential-mode resistance that rises roughly as (ωLσ)²/R_σ; without it a constant R_w has to explain that loss.
  // The core may consist of up to three sections M_k ∥ R_Fe,k in series. One section has a constant inductance and loss;
  // several sections with staggered corner frequencies R_k/(2π·2M_k) follow a ferrite whose permeability falls and whose loss
  // rises with frequency (as the manufacturer models do with longer L ∥ R ladders).
  const CORE_KEYS = [['m', 'rfe'], ['m2', 'rfe2'], ['m3', 'rfe3']];
  const coreSections = model => CORE_KEYS.filter(([m]) => fin(model[m])).map(([m, r]) => [model[m], model[r]]);
  function cmcModal(model, f) {
    const w = TAU * f;
    let core = [0, 0];
    for (const [m, r] of coreSections(model)) core = add(core, fin(r) ? par([0, 2 * w * m], [r, 0]) : [0, 2 * w * m]);
    const zdm = fin(model.rls) ? add([model.rw, 0], par([0, w * model.ls], [model.rls, 0])) : [model.rw, w * model.ls], zcm = add(zdm, core), cx = fin(model.cx) ? model.cx : 0;
    return [[0, w * model.cg], [0, w * (2 * model.cw + 2 * cx + model.cg)],
      add(scale(div(one, zcm), 2), [0, w * (2 * model.ct + 2 * cx + model.cg)]), add(scale(div(one, zdm), 2), [0, w * (2 * model.ct + 2 * model.cw + model.cg)])];
  }
  function cmcModelY(model, f) {
    const diagonal = matrix(4);
    cmcModal(model, f).forEach((y, i) => put(diagonal, 4, i, i, y));
    return project(diagonal, 4, NATURAL_MODES);
  }
  const symmetric2 = (a, b) => { const y = matrix(2); put(y, 2, 0, 0, a); put(y, 2, 1, 1, a); put(y, 2, 0, 1, b); put(y, 2, 1, 0, b); return y; };
  // Z CM and Z DM exactly as the measurement obtains them (CISPR 17, series formula on the mixed-mode two-ports), so the
  // capacitances to ground load the model in the same way as the device under test.
  function cmcModelZ(model, f, refCm = 25, refDm = 100) {
    const [y0, y1, y2, y3] = cmcModal(model, f);
    const cm = fromZY(symmetric2(add(y0, y2), sub(y0, y2)), [refCm, refCm], 'Y');
    const dm = fromZY(symmetric2(scale(add(y1, y3), 0.25), scale(sub(y1, y3), 0.25)), [refDm, refDm], 'Y');
    return { cm: cispr(cm, refCm)?.z ?? null, dm: cispr(dm, refDm)?.z ?? null };
  }
  // Transformer, differential two-port primary → secondary: C_p across the primary terminals, R₁ + Lσ/2, (L_m ∥ R_Fe),
  // ideal 1 : n, n²·Lσ/2 + R₂. The total leakage Lσ is split in halves because the terminals only fix its sum.
  // The capacitance between the windings has two parts, because where it sits changes the differential behaviour:
  // C_wa between like terminals (+ to +, − to −; two capacitors of C_wa/2) and C_wx between unlike terminals (+ to −; two of C_wx/2).
  // Common mode sees their sum C_ww = C_wa + C_wx. Differentially each winding is loaded with C_ww/4 and (C_wx − C_wa)/4 couples across.
  function inverse2(m) {
    const a = get(m, 2, 0, 0), b = get(m, 2, 0, 1), c = get(m, 2, 1, 0), d = get(m, 2, 1, 1), det = sub(mul(a, d), mul(b, c));
    if (abs(det) < 1e-300) return null;
    const out = matrix(2);
    put(out, 2, 0, 0, div(d, det)); put(out, 2, 1, 1, div(a, det)); put(out, 2, 0, 1, scale(div(b, det), -1)); put(out, 2, 1, 0, scale(div(c, det), -1));
    return out;
  }
  // Leakage with eddy currents (optional): Lσ = Lσ_∞ + (Lσ_e ∥ R_e). At low frequency the whole leakage Lσ_∞ + Lσ_e acts; at
  // high frequency R_e bridges Lσ_e (currents crowd to the conductor surface and the field inside the winding is pushed out),
  // so the leakage inductance falls and its resistance rises towards R_e – one rung of the eddy-current ladder.
  const leakZ = (model, w) => fin(model.lse) && fin(model.rse) ? add([0, w * model.lst], par([0, w * model.lse], [model.rse, 0])) : [0, w * model.lst];
  function trafoModelZ(model, f) {
    const w = TAU * f, n = model.n, zm = fin(model.rfe) ? par([0, w * model.lm], [model.rfe, 0]) : [0, w * model.lm], half = scale(leakZ(model, w), 0.5);
    const z = matrix(2), cross = scale(zm, model.flip ? -n : n);
    put(z, 2, 0, 0, add(add([model.rpri, 0], half), zm)); put(z, 2, 1, 1, add(add([model.rsec, 0], scale(half, n * n)), scale(zm, n * n))); put(z, 2, 0, 1, cross); put(z, 2, 1, 0, cross);
    const cwa = fin(model.cwa) ? model.cwa : 0, cwx = fin(model.cwx) ? model.cwx : 0, own = (cwa + cwx) / 4, across = (cwx - cwa) / 4;
    const cp = (fin(model.cp) ? model.cp : 0) + own, cs = (fin(model.cp2) ? model.cp2 : 0) + own;
    if (!cp && !cs) return z;
    const y = inverse2(z);
    if (!y) return z;
    put(y, 2, 0, 0, add(get(y, 2, 0, 0), [0, w * cp])); put(y, 2, 1, 1, add(get(y, 2, 1, 1), [0, w * cs]));
    put(y, 2, 0, 1, add(get(y, 2, 0, 1), [0, w * across])); put(y, 2, 1, 0, add(get(y, 2, 1, 0), [0, w * across]));
    return inverse2(y) ?? z;
  }
  // Changes the number of core sections; the total inductance stays, the corner frequencies are spread a decade apart
  // around the corner of the present core. The optimiser then places them.
  function cmcSections(model, count) {
    const sections = coreSections(model), total = sections.reduce((sum, [m]) => sum + m, 0);
    const corners = sections.map(([m, r]) => fin(r) ? r / (TAU * 2 * m) : NaN).filter(fin);
    const fc = corners.length ? Math.exp(corners.reduce((sum, f) => sum + Math.log(f), 0) / corners.length) : NaN;
    const next = { ...model };
    for (const [m, r] of CORE_KEYS) { next[m] = NaN; next[r] = NaN; }
    for (let k = 0; k < count; k++) {
      const [m, r] = CORE_KEYS[k], value = total / count, f = fc * 10 ** (k - (count - 1) / 2);
      next[m] = value; next[r] = fin(f) ? TAU * 2 * value * f : NaN;
    }
    return next;
  }
  // Core sections from the measurement. The common mode carries the core, the differential mode not, so with the shunt
  // capacitances of the present model the core impedance per winding follows from the measured mode admittances alone:
  //   Z_core = 2/(y_H − jωC_H) − 2/(y_D − jωC_D),  C_H = 2Ct + 2Cx + Cg,  C_D = 2Ct + 2Cw + Cg.
  // A section 2M ∥ R is a relaxation of the complex inductance, Z_core/(j2ω) = Σ M_k/(1 + jωτ_k) with τ_k = 2M_k/R_k, linear in
  // M_k once the τ_k are given. A non-negative least-squares fit on a grid of τ (a distribution of relaxation times) shows
  // where the measurement puts inductance; its strongest groups become the sections. Only points where the H mode is resolved
  // and the capacitance has not taken over (|ωC_H| below half of the series admittance) are used.
  function coreRelaxation(freq, meas, model, band = null) {
    const C_H = 2 * model.ct + 2 * (fin(model.cx) ? model.cx : 0) + model.cg, C_D = 2 * model.ct + 2 * model.cw + model.cg, R = meas.ref ?? 50;
    const pts = [];
    for (let i = 0; i < freq.length; i++) {
      const f = freq[i], y = meas.y?.[i];
      if (!(f > 0) || !y || (band && (f < band[0] || f > band[1]))) continue;
      const w = TAU * f, yh = sub(y[2], [0, w * C_H]), yd = sub(y[3], [0, w * C_D]);
      if (!(abs(yh) > 0) || !(abs(yd) > 0) || w * C_H > 0.5 * abs(yh)) continue;
      const weight = weightOf(zError(invert(y[2]), R, R));
      if (weight < 0.1) continue;
      const L = div(sub(div([2, 0], yh), div([2, 0], yd)), [0, 2 * w]);
      if (abs(L) > 0) pts.push({ w, L, weight });
    }
    if (pts.length < 8) return null;
    const wMin = Math.min(...pts.map(p => p.w)), wMax = Math.max(...pts.map(p => p.w)), G = 48;
    // τ grid one decade beyond the band on both sides; the shortest τ stands for a section that stays lossless in the band
    const taus = Array.from({ length: G }, (_, k) => Math.exp(Math.log(0.1 / wMax) + k / (G - 1) * Math.log(100 * wMax / wMin)));
    const A = [], b = [];
    for (const p of pts) {
      const s = Math.sqrt(p.weight) / abs(p.L);
      const re = [], im = [];
      for (const t of taus) { const v = div([1, 0], [1, p.w * t]); re.push(s * v[0]); im.push(s * v[1]); }
      A.push(re, im); b.push(s * p.L[0], s * p.L[1]);
    }
    // projected coordinate descent on the normal equations, M ≥ 0 (a small ridge keeps neighbouring τ from fighting)
    const AtA = taus.map((_, a) => taus.map((_, c) => A.reduce((sum, row) => sum + row[a] * row[c], 0)));
    const Atb = taus.map((_, a) => A.reduce((sum, row, j) => sum + row[a] * b[j], 0));
    const ridge = 1e-6 * Math.max(...AtA.map((row, a) => row[a]));
    const M = taus.map(() => 0);
    for (let sweep = 0; sweep < 4000; sweep++) {
      let change = 0;
      for (let a = 0; a < G; a++) {
        let g = Atb[a];
        for (let c = 0; c < G; c++) if (c !== a) g -= AtA[a][c] * M[c];
        const next = Math.max(0, g / (AtA[a][a] + ridge));
        change = Math.max(change, Math.abs(next - M[a])); M[a] = next;
      }
      if (change < 1e-9 * Math.max(...M, 1e-30)) break;
    }
    // groups of neighbouring grid points that carry inductance
    const top = Math.max(...M), groups = [];
    let run = null;
    M.forEach((m, k) => {
      if (m > 1e-3 * top) { run ||= { m: 0, lt: 0 }; run.m += m; run.lt += m * Math.log(taus[k]); }
      else if (run) { groups.push(run); run = null; }
    });
    if (run) groups.push(run);
    return groups.map(g => ({ m: g.m, tau: Math.exp(g.lt / g.m) })).sort((x, y) => y.m - x.m);
  }
  // A model with `count` core sections placed on the relaxation groups of the measurement. Fewer groups than sections: the
  // largest group is split around its τ (factor 3 each way). More groups: the weakest are merged into their nearest section.
  // Sections are ordered by inductance, so M and R_Fe stay the main section.
  function cmcCoreStart(freq, meas, model, count, band = null) {
    let groups = coreRelaxation(freq, meas, model, band);
    if (!groups || !groups.length) return cmcSections(model, count);
    groups = groups.map(g => ({ ...g }));
    while (groups.length < count) {
      const g = groups.shift(), parts = [{ m: g.m / 2, tau: g.tau * 3 }, { m: g.m / 2, tau: g.tau / 3 }];
      groups.push(...parts); groups.sort((x, y) => y.m - x.m);
    }
    const kept = groups.slice(0, count);
    for (const g of groups.slice(count)) {
      const near = kept.reduce((a, c) => Math.abs(Math.log(c.tau / g.tau)) < Math.abs(Math.log(a.tau / g.tau)) ? c : a);
      near.tau = Math.exp((near.m * Math.log(near.tau) + g.m * Math.log(g.tau)) / (near.m + g.m)); near.m += g.m;
    }
    kept.sort((x, y) => y.m - x.m);   // section 1 (M, R_Fe) is the main one
    const next = { ...model };
    for (const [m, r] of CORE_KEYS) { next[m] = NaN; next[r] = NaN; }
    kept.forEach((g, k) => { const [m, r] = CORE_KEYS[k]; next[m] = g.m; next[r] = 2 * g.m / g.tau; });
    return next;
  }
  // How many core sections the measurement carries. Each count from 1 to 3 is fitted from the relaxation start (and, for the
  // count the model already has, also from the model itself). A further section counts only if it lowers the weighted cost
  // by at least 10 % and stays a section of its own: its τ at least a factor 2 from every other, at least 1 % of the inductance.
  // Otherwise the fit has merely split one relaxation, which the measurement cannot tell apart.
  const SECTION_GAIN = 0.9, SECTION_TAU = 2, SECTION_SHARE = 0.01;
  function cmcSectionOrder(freq, meas, model, options = {}) {
    const have = coreSections(model).length, fits = [];
    for (let count = 1; count <= CORE_KEYS.length; count++) {
      const starts = [cmcCoreStart(freq, meas, model, count, options.band ?? null)];
      if (count === have) starts.push(model);
      // One section is the reference and is fitted robustly. More sections start close to the measurement (relaxation start),
      // so the faster fit suffices. If it ends clearly worse than one section fewer (the nested model could at least come
      // close), it has stalled and is repeated robustly. Compared on the deviation in dB: the cost also holds the loose tie to
      // the start values, which an extra section that only splits one relaxation always pays a little for.
      // Of several starts, the one Levenberg–Marquardt alone brings furthest is the one fitted in full.
      const fixed = (options.fixed ?? []).filter(key => !/^(m|rfe)\d?$/.test(key));
      const fit = (start, method) => fitMulti(freq, meas, start, { ...options, fixed, method });
      const quick = starts.map(start => ({ start, fit: fit(start, 'lm') })).filter(q => q.fit);
      if (!quick.length) break;
      const lead = quick.reduce((a, b) => b.fit.cost < a.fit.cost ? b : a);
      const pick = (...list) => list.filter(Boolean).reduce((a, b) => b.cost < a.cost ? b : a);
      let best = pick(lead.fit, fit(lead.start, count === 1 ? 'robust' : 'hybrid'));
      if (fits.length && best.err > 1.1 * fits.at(-1).err + 0.05) best = pick(best, fit(lead.start, 'robust'));
      if (!best) break;
      const sections = coreSections(best.model), total = sections.reduce((sum, [m]) => sum + m, 0), taus = sections.map(([m, r]) => fin(r) ? 2 * m / r : 0);
      const distinct = sections.every(([m], k) => m >= SECTION_SHARE * total && taus.every((t, j) => j === k || !(t > 0) || !(taus[k] > 0) || Math.abs(Math.log(t / taus[k])) >= Math.log(SECTION_TAU)));
      fits.push({ count, model: best.model, err: best.err, phase: best.phase, cost: best.cost, distinct });
    }
    let chosen = fits[0];
    for (const fit of fits.slice(1)) {
      if (fit.distinct && fit.cost <= SECTION_GAIN * chosen.cost) chosen = fit; else break;
    }
    return { fits, best: chosen };
  }
  const MULTI_KEYS = { cmc: ['m', 'rfe', 'm2', 'rfe2', 'm3', 'rfe3', 'ls', 'rls', 'rw', 'ct', 'cw', 'cx', 'cg'], trafo: ['lm', 'lst', 'lse', 'rse', 'n', 'rpri', 'rsec', 'rfe', 'cp', 'cp2', 'cwa', 'cwx'] };
  // Transformer: the natural modes of the differential two-port. Referred to the primary (secondary voltage ÷ n, current × n,
  // i.e. Y' = T·Y·T with T = diag(1, n)) the transformer is 1 : 1, and its modes are the sum and the difference of both sides:
  // in the original coordinates the voltage direction a = [1, σn]/√2 only magnetises (both windings in step, no ampere-turns
  // left for the leakage) and b = [σ, −n]/√2 only drives the leakage. (b is orthogonal to a in the primary-referred metric,
  // not in the plain one: with [σn, −1] the coupling curve would carry (n − 1/n)/(2(1+n²)·Z_m) of the magnetising branch.) The curves are 1/y in these directions – mode M (magnetising: L_m, R_Fe and above its resonance
  // C_aa), mode σ (leakage: Lσ, R₁, R₂ and at its own, much higher resonance C_bb) – and 1/y_ab, the coupling between them
  // (asymmetry of the two sides). For n = 1: C_aa = (C_p + C_p2)/2 + C_wx/2, C_bb = (C_p + C_p2)/2 + C_wa/2, C_ab = (C_p − C_p2)/2;
  // with C_ww = C_wa + C_wx from the common mode all four are fixed. On Z₁₁/Z₂₂/Z₂₁/Z_k they are not: below the leakage
  // resonance C_wa barely touches any of them, and a single C_p on the primary cannot give the negative C_ab real parts show.
  // The basis comes from the start values (meas.basis) and stays fixed during a fit, so measured curves do not move with n.
  const invert = y => y && abs(y) > 0 ? div(one, y) : null;
  const trafoBasis = (n, flip) => { const s = flip ? -1 : 1, k = Math.SQRT1_2; return { a: [k, s * n * k], b: [s * k, -n * k], norm2: (1 + n * n) / 2 }; };
  function trafoCurves(z, basis) {
    const y = inverse2(z);
    if (!y || !basis) return [null, null, null];
    const form = (u, v) => { let sum = [0, 0]; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) sum = add(sum, scale(get(y, 2, i, j), u[i] * v[j])); return sum; };
    const { a, b } = basis, yab = scale(add(form(a, b), form(b, a)), 0.5);
    return [invert(form(a, a)), invert(form(b, b)), invert(yab)];
  }
  // CMC: the impedances 1/y of the four natural modes – G (all terminals against ground: C_g), V (winding against winding:
  // C_w + C_x), H (common mode through the windings) and D (differential mode through the windings). Together they hold the
  // whole symmetric four-port. Z CM and Z DM after CISPR 17 are the ABCD parameter B of the mode two-ports, i.e. the pure series
  // impedance: shunt elements drop out of them exactly, so C_w and C_g could never be fitted from them.
  // A transformer measurement without a basis gets the one of the model it is first compared with, once per call.
  const withBasis = (meas, model) => model.type === 'trafo' && !meas.basis ? { ...meas, basis: trafoBasis(model.n, model.flip) } : meas;
  function multiCurves(model, f, meas) {
    if (model.type === 'cmc') return cmcModal(model, f).map(invert);
    return trafoCurves(trafoModelZ(model, f), meas.basis ?? trafoBasis(model.n, model.flip));
  }
  const multiMeasured = (model, meas, i) => model.type === 'cmc' ? (meas.y[i] ? meas.y[i].map(invert) : [null, null, null, null])
    : meas.z[i] ? trafoCurves(meas.z[i], meas.basis ?? trafoBasis(model.n, model.flip)) : [null, null, null];
  const usable = z => !!z && Number.isFinite(z[0]) && Number.isFinite(z[1]) && (z[0] !== 0 || z[1] !== 0);
  function multiPoints(freq, model, meas, band) {
    const idx = [];
    for (let i = 0; i < freq.length; i++) {
      if (!(freq[i] > 0) || (band && (freq[i] < band[0] || freq[i] > band[1]))) continue;
      if (multiMeasured(model, meas, i).every(usable)) idx.push(i);
    }
    return idx;
  }
  // How well a measured impedance is resolved. A series element between two ports with reference R gives S = 2R/(Z + 2R),
  // a reflection gives Γ = (Z − R)/(Z + R). An uncertainty δ of S or Γ then makes the relative error of Z
  //   e = δ·|Z + a|² / (2R·|Z|),  a = 2R (series) or a = R (reflection),
  // smallest near |Z| = a and large for impedances far below or far above it. δ = 3·10⁻³·|S| + 10⁻⁴ (about 0.03 dB plus a floor)
  // is a typical value for a calibrated, de-embedded fixture measurement; it is an assumption, not read from the file.
  // A point weighs 1/(1 + (e/5 %)²): what the measurement cannot resolve does not steer the fit.
  const DELTA_REL = 3e-3, DELTA_ABS = 1e-4, E_OK = 0.05;
  function zError(z, R, a) {
    const m = abs(z), lever = abs(add(z, [a, 0]));
    if (!(m > 0) || !(R > 0)) return Infinity;
    const s = a === R ? abs(sub(z, [R, 0])) / lever : 2 * R / lever;
    return (DELTA_REL * s + DELTA_ABS) * lever * lever / (2 * R * m);
  }
  const weightOf = e => Number.isFinite(e) ? 1 / (1 + (e / E_OK) ** 2) : 0;
  function multiWeights(model, meas, zx) {
    // natural modes are orthonormal combinations of the single-ended ports: each is a reflection against the port reference
    if (model.type === 'cmc') { const R = meas.ref ?? 50; return zx.map(z => weightOf(zError(z, R, R))); }
    // modes M and σ are combinations of the two differential ports with |a|² = |b|² = (1+n²)/2: each a reflection against the
    // port reference scaled by that norm. The coupling y_ab inherits the absolute admittance errors of both:
    // σ_ab ≈ √(e_M|y_M|·e_σ|y_σ|), relative to |y_ab|.
    const R = (meas.ref ?? 100) / (meas.basis?.norm2 ?? 1), eM = zError(zx[0], R, R), eS = zError(zx[1], R, R);
    const eX = Math.sqrt(eM / abs(zx[0]) * eS / abs(zx[1])) * abs(zx[2]);
    return [weightOf(eM), weightOf(eS), weightOf(eX)];
  }
  const curveNames = model => model.type === 'cmc' ? ['g', 'v', 'h', 'd'] : ['m', 's', 'x'];
  // Deviation per curve and overall inside a band, weighted by how well each point is resolved: magnitude in dB RMS, phase in degrees RMS.
  // `resolved` is the frequency range in which a curve weighs at least one half.
  function multiQuality(freq, meas, model, band = null) {
    meas = withBasis(meas, model);
    const idx = multiPoints(freq, model, meas, band), names = curveNames(model);
    if (!idx.length) return { err: NaN, phase: NaN, points: 0, band: band ?? [NaN, NaN], parts: {} };
    const W = names.map(() => 0), sq = names.map(() => 0), ph = names.map(() => 0), seen = names.map(() => []);
    for (const i of idx) {
      const zm = multiCurves(model, freq[i], meas), zx = multiMeasured(model, meas, i), wt = multiWeights(model, meas, zx);
      names.forEach((_, k) => {
        if (!usable(zm[k])) { sq[k] = NaN; return; }
        let dp = Math.atan2(zm[k][1], zm[k][0]) - Math.atan2(zx[k][1], zx[k][0]);
        dp -= TAU * Math.round(dp / TAU);
        W[k] += wt[k]; sq[k] += wt[k] * (20 * Math.log10(abs(zm[k]) / abs(zx[k]))) ** 2; ph[k] += wt[k] * dp * dp;
        if (wt[k] >= 0.5) seen[k].push(freq[i]);
      });
    }
    const parts = Object.fromEntries(names.map((name, k) => [name, { err: Math.sqrt(sq[k] / W[k]), phase: Math.sqrt(ph[k] / W[k]) / RAD, weight: W[k] / idx.length,
      resolved: seen[k].length ? [seen[k][0], seen[k].at(-1)] : null }]));
    const total = W.reduce((x, y) => x + y, 0);
    return { err: Math.sqrt(sq.reduce((x, y) => x + y, 0) / total), phase: Math.sqrt(ph.reduce((x, y) => x + y, 0) / total) / RAD,
      points: idx.length, band: [freq[idx[0]], freq[idx.at(-1)]], parts };
  }
  // Residual rows of one model at the sampled points, three per curve: the log-magnitude ratio ln|Z_model/Z_meas| and the phase
  // difference φ as the chord on the unit circle, √½·sin φ and √½·(1 − cos φ). For small φ the chord is φ itself (the phase
  // in degrees as reported); unlike φ it has no step at ±180°, where a resonance shifted against the measured one would
  // otherwise put an edge into the cost that stops a gradient method. The magnitude part stays unbounded, so a resonance far
  // off still pulls the fit towards the measured one.
  const RESIDUAL_ROWS = 3;
  function multiResiduals(freq, meas, model, sample, measured) {
    const out = [];
    sample.forEach((i, s) => {
      const zm = multiCurves(model, freq[i], meas), zx = measured[s];
      for (let k = 0; k < zx.length; k++) {
        const r = usable(zm[k]) ? div(zm[k], zx[k]) : null, m = r ? abs(r) : NaN;
        if (!(m > 0) || !Number.isFinite(m)) { out.push(NaN, NaN, NaN); continue; }
        out.push(Math.log(m), Math.SQRT1_2 * r[1] / m, Math.SQRT1_2 * (1 - r[0] / m));
      }
    });
    return out;
  }
  function samplePoints(freq, meas, model, band, target) {
    const idx = multiPoints(freq, model, meas, band), stride = Math.max(1, Math.floor(idx.length / target));
    const sample = idx.filter((_, k) => k % stride === 0), measured = sample.map(i => multiMeasured(model, meas, i));
    const weights = measured.flatMap(zx => multiWeights(model, meas, zx).flatMap(w => Array(RESIDUAL_ROWS).fill(w)));
    return { idx, sample, measured, weights };
  }
  // How firmly the measurement fixes each parameter. The Jacobian J of the weighted residuals with respect to ln p gives,
  // through (JᵀWJ)⁻¹, how far a parameter can move while all others compensate; the residual scatter of the model sets the scale
  // (at least 1 %). Neighbouring frequency points are not independent and the model error is systematic, so the values are a
  // guide (well / weakly / not determined), not confidence intervals. Returns the relative spread per free parameter.
  // `sigma` replaces the residual scatter by a fixed model accuracy: the spread then says whether the measurement could fix a
  // parameter at all, independent of how well the present values fit.
  function multiSpread(freq, meas, model, { fixed = [], band = null, sigma: given = null } = {}) {
    meas = withBasis(meas, model);
    const hold = new Set(fixed), free = modelParams(model).filter(p => !hold.has(p.key));
    const { sample, measured, weights } = samplePoints(freq, meas, model, band, 120);
    if (!free.length || sample.length < free.length + 3) return {};
    const base = multiResiduals(freq, meas, model, sample, measured), h = 0.02;
    const columns = free.map(p => multiResiduals(freq, meas, modelWith(model, { [p.key]: p.value * Math.exp(h) }), sample, measured).map((r, j) => (r - base[j]) / h));
    const rows = base.map((r, j) => Number.isFinite(r) && columns.every(c => Number.isFinite(c[j])) ? j : -1).filter(j => j >= 0);
    let W = 0, rr = 0;
    for (const j of rows) { W += weights[j]; rr += weights[j] * base[j] * base[j]; }
    const n = free.length, A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => rows.reduce((sum, j) => sum + weights[j] * columns[a][j] * columns[b][j], 0)));
    // two independent quantities per curve and point (magnitude, phase); the third row is second order in the phase
    const sigma = given > 0 ? given : Math.max(0.01, Math.sqrt(rr / Math.max(1, W * 2 / RESIDUAL_ROWS / 2 - n)));
    const inverse = invertSymmetric(A);
    return Object.fromEntries(free.map((p, k) => [p.key, inverse && inverse[k][k] > 0 ? sigma * Math.sqrt(inverse[k][k]) : Infinity]));
  }
  // Parameters the measurement cannot fix. Meant for an already optimised model, whose residual sets the scale (a start far
  // off would make everything look undetermined; `sigma` can fix the scale instead). One parameter at a time: the least
  // determined one is held and the others are judged again, because two parameters that only act together (both undetermined
  // alone) are fixed as soon as one of them stays put. Spread > 100 % (more than a factor e) = undetermined.
  const SPREAD_GOOD = 0.1, SPREAD_WEAK = 1;
  function multiUndetermined(freq, meas, model, { fixed = [], band = null, sigma = null, limit = SPREAD_WEAK, keep = [] } = {}) {
    const held = [];
    for (;;) {
      const spread = multiSpread(freq, meas, model, { fixed: [...fixed, ...held], band, sigma });
      const worst = Object.entries(spread).filter(([key]) => !keep.includes(key)).sort((a, b) => b[1] - a[1])[0];
      if (!worst || !(worst[1] > limit)) return held;
      held.push(worst[0]);
    }
  }
  // Optimisation that keeps undetermined parameters at their start value: a free fit first, then every parameter the result
  // does not determine goes back to its start value and is held, and the rest is fitted again. Returns the fit and the held keys.
  function fitMultiHeld(freq, meas, model, options = {}) {
    const first = fitMulti(freq, meas, model, options);
    if (!first || !first.free) return first && { ...first, held: [] };
    // A value the fit pushes below a tenth of its start is "small" by the measurement, not unknown: on the logarithmic scale
    // of the parameters it loses its influence and looks undetermined, but resetting it would undo what the data say.
    const keep = modelParams(model).filter(p => first.model[p.key] < 0.1 * p.value).map(p => p.key);
    const held = multiUndetermined(freq, meas, first.model, { fixed: options.fixed ?? [], band: options.band ?? null, keep });
    if (!held.length) return { ...first, held };
    const back = modelWith(first.model, Object.fromEntries(held.map(key => [key, model[key]])));
    const second = fitMulti(freq, meas, back, { ...options, fixed: [...(options.fixed ?? []), ...held] });
    // Cross-check: the spread is a linear estimate. If holding the values makes the curves noticeably worse (5 % plus 0.002 dB),
    // the measurement does carry them and the free result stands.
    if (!second || second.err > 1.05 * first.err + 0.002) return { ...first, held: [], spared: held };
    return { ...second, held };
  }
  const spreadClass = s => s === undefined ? 'fixed' : s <= SPREAD_GOOD ? 'good' : s <= SPREAD_WEAK ? 'weak' : 'none';
  // Gauss–Jordan with partial pivoting; null when the matrix is singular (a parameter has no influence at all).
  function invertSymmetric(A) {
    const n = A.length, M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => Number(i === j))]);
    const scaleOf = Math.max(...A.map((row, i) => Math.abs(row[i])));
    if (!(scaleOf > 0)) return null;
    for (let c = 0; c < n; c++) {
      let pivot = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
      if (Math.abs(M[pivot][c]) < 1e-14 * scaleOf) return null;
      [M[c], M[pivot]] = [M[pivot], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c && M[r][c]) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(row => row.slice(n));
  }
  // Re-optimises the free parameters on magnitude and phase of all curves, each point weighted by how well it is resolved.
  // `prior` holds values the curves fix only weakly (C_g of the CMC): the fit is pulled gently towards them. `priorSum` does the same
  // for a sum of parameters (C_wa + C_wx of the transformer = C_ww from the common mode). Every free parameter is also tied very
  // loosely to its start value, so one that the measurement does not determine stays put instead of drifting to an arbitrary value.
  const TIE = 2e-4;
  function fitMulti(freq, meas, model, { fixed = [], band = null, prior = {}, priorSum = null, method = 'robust' } = {}) {
    meas = withBasis(meas, model);
    const hold = new Set(fixed), free = modelParams(model).filter(p => !hold.has(p.key));
    const { idx, sample, measured, weights } = samplePoints(freq, meas, model, band, 160);
    if (idx.length < Math.max(8, free.length + 3)) return null;
    if (!free.length) return { model, ...multiQuality(freq, meas, model, band), free: 0 };
    // normalised to two quantities (magnitude, phase) per curve and point, whatever the number of residual rows
    const total = weights.reduce((x, y) => x + y, 0) * 2 / RESIDUAL_ROWS;
    if (!(total > 0)) return null;
    const start = free.map(p => Math.log(p.value));
    const build = x => modelWith(model, Object.fromEntries(free.map((p, k) => [p.key, Math.exp(start[k] + Math.max(-7, Math.min(7, x[k] - start[k])))])));
    // Cost = weighted data deviation + physical priors (fit) + a loose tie of every free parameter to a centre (tie). The tie
    // keeps a parameter the measurement does not determine where it is instead of letting it drift to an arbitrary value.
    const priors = m => {
      let value = 0;
      for (const p of free) if (fin(prior[p.key])) value += 0.05 * Math.log(m[p.key] / prior[p.key]) ** 2;
      if (priorSum && fin(priorSum.value) && priorSum.keys.some(key => !hold.has(key))) value += 0.05 * Math.log(priorSum.keys.reduce((sum, key) => sum + (fin(m[key]) ? m[key] : 0), 0) / priorSum.value) ** 2;
      return value;
    };
    const fitCost = x => {
      const m = build(x), r = multiResiduals(freq, meas, m, sample, measured);
      let sum = 0;
      for (let j = 0; j < r.length; j++) { if (!Number.isFinite(r[j])) return Infinity; sum += weights[j] * r[j] * r[j]; }
      const value = 2 * sum / total + priors(m);
      return Number.isFinite(value) ? value : Infinity;
    };
    const tie = (x, centre) => { let value = 0; for (let k = 0; k < free.length; k++) value += TIE * (x[k] - centre[k]) ** 2; return value; };
    const cost = x => fitCost(x) + tie(x, start);
    // The same cost as rows of a least-squares problem, for Levenberg–Marquardt: Σ rows² = cost (tied to `centre`).
    const rows = (x, centre = start) => {
      const m = build(x), r = multiResiduals(freq, meas, m, sample, measured), out = new Array(r.length);
      for (let j = 0; j < r.length; j++) out[j] = Math.sqrt(2 * weights[j] / total) * r[j];
      for (let k = 0; k < free.length; k++) out.push(Math.sqrt(TIE) * (x[k] - centre[k]));
      for (const p of free) if (fin(prior[p.key])) out.push(Math.sqrt(0.05) * Math.log(m[p.key] / prior[p.key]));
      if (priorSum && fin(priorSum.value) && priorSum.keys.some(key => !hold.has(key))) out.push(Math.sqrt(0.05) * Math.log(priorSum.keys.reduce((sum, key) => sum + (fin(m[key]) ? m[key] : 0), 0) / priorSum.value));
      return out;
    };
    let best;
    const box = { lo: start.map(v => v - 7), hi: start.map(v => v + 7) }, lm = x => { const r = levenbergMarquardt(rows, x, box); return { x: r.x, f: cost(r.x) }; };
    if (method === 'lm') best = lm(start);
    // Levenberg–Marquardt converges in a few dozen evaluations but stays in the valley it starts in; a sharp resonance placed
    // beside the measured one is such a valley. The simplex explores more widely but converges slowly and not exactly.
    // 'robust' (default): Levenberg–Marquardt from the start, the full simplex from the start, and Levenberg–Marquardt from
    // the simplex result; the best of the three is kept, so the result is never worse than the simplex alone.
    // 'hybrid' (faster, for good starts): Levenberg–Marquardt, a short simplex run from there, Levenberg–Marquardt again.
    else if (method === 'hybrid') {
      const first = lm(start), wander = nelderMead(cost, first.x, 120 * start.length), last = lm(wander.f < first.f ? wander.x : first.x);
      best = [first, wander, last].reduce((a, b) => b.f < a.f ? b : a);
    } else if (method === 'robust') {
      const simplex = () => { let b = nelderMead(cost, start, 220 * start.length); for (let round = 0; round < 3; round++) { const again = nelderMead(cost, b.x, 160 * start.length); if (again.f < b.f - 1e-12) b = again; else break; } return b; };
      const direct = lm(start), wide = simplex(), polished = lm(wide.x);
      best = [direct, wide, polished].reduce((a, b) => b.f < a.f ? b : a);
    } else {
      best = nelderMead(cost, start, 220 * start.length);
      for (let round = 0; round < 3; round++) { const again = nelderMead(cost, best.x, 160 * start.length); if (again.f < best.f - 1e-12) best = again; else break; }
    }
    if (!(Number.isFinite(best.f) && best.f <= cost(start))) return { model, ...multiQuality(freq, meas, model, band), free: free.length, cost: fitCost(start) };
    // Proximal passes: the tie pulls every parameter a little towards the start, also those the measurement does determine
    // (with clean data noticeably: R_Fe several per cent off where the data fix it to a fraction of a per cent). Centring the tie
    // on the last result and running Levenberg–Marquardt again removes that pull step by step; a parameter the measurement
    // does not determine has a flat direction and stays where it is.
    // Stops when the parameters no longer move (0.1 % per pass) or the fit no longer improves.
    let x = best.x, f = fitCost(x);
    for (let pass = 0; pass < 12; pass++) {
      const centre = x.slice(), next = levenbergMarquardt(x => rows(x, centre), x, box).x, fn = fitCost(next);
      if (!(fn <= f)) break;
      const step = Math.max(...next.map((v, k) => Math.abs(v - x[k])));
      x = next; f = fn;
      if (step < 1e-3) break;
    }
    const fitted = build(x);
    return { model: fitted, ...multiQuality(freq, meas, fitted, band), free: free.length, cost: f };
  }
  function multiNetlist(model, name) {
    const v = value => value.toExponential(5), lines = [];
    if (model.type === 'cmc') {
      lines.push('* S-Parameter Analyzer - CMC equivalent circuit', '* Pins: 1 IN+   2 IN-   3 OUT+   4 OUT-   (0 = ground)',
        '* Per winding: Rw + (Lsigma || Rsigma) in series with the coupled part: one or more sections M || Rfe, each coupled with k = 1.', '.subckt ' + name + ' 1 2 3 4');
      const sections = coreSections(model);
      for (const [t, a, b] of [['a', 1, 3], ['b', 2, 4]]) {
        lines.push('Rw' + t + ' ' + a + ' ' + t + '1 ' + v(model.rw), 'Ls' + t + ' ' + t + '1 ' + t + '2 ' + v(model.ls));
        if (fin(model.rls)) lines.push('Rs' + t + ' ' + t + '1 ' + t + '2 ' + v(model.rls));
        sections.forEach(([m, r], k) => {
          const from = t + (k + 2), to = k === sections.length - 1 ? String(b) : t + (k + 3), tag = t + (k ? k + 1 : '');
          lines.push('Lm' + tag + ' ' + from + ' ' + to + ' ' + v(m));
          if (fin(r)) lines.push('Rf' + tag + ' ' + from + ' ' + to + ' ' + v(r));
        });
        lines.push('Ct' + t + ' ' + a + ' ' + b + ' ' + v(model.ct));
      }
      sections.forEach((_, k) => lines.push('Kab' + (k ? k + 1 : '') + ' Lma' + (k ? k + 1 : '') + ' Lmb' + (k ? k + 1 : '') + ' 1'));
      lines.push('Cwi 1 2 ' + v(model.cw), 'Cwo 3 4 ' + v(model.cw));
      if (fin(model.cx)) lines.push('Cxa 1 4 ' + v(model.cx), 'Cxb 2 3 ' + v(model.cx));
      for (const pin of [1, 2, 3, 4]) lines.push('Cg' + pin + ' ' + pin + ' 0 ' + v(model.cg));
    } else {
      const n = model.n, sec = model.flip ? '4 s1' : 's1 4';
      lines.push('* S-Parameter Analyzer - transformer T equivalent circuit, ratio 1 : ' + n.toPrecision(5), '* Pins: 1 PRI+   2 PRI-   3 SEC+   4 SEC-',
        '* Lm and Lt with k = 1 are the magnetising inductance together with the ideal transformer 1 : n.', '* The total leakage is split in halves (Ls1 = Ls2/n^2); the terminals only fix its sum. Le || Re: eddy-current part of the leakage.', '* Cwa: between like terminals (+ to +, - to -). Cwx: between unlike terminals. Cww = Cwa + Cwx.', '.subckt ' + name + ' 1 2 3 4');
      if (fin(model.cp)) lines.push('Cp 1 2 ' + v(model.cp));
      if (fin(model.cp2)) lines.push('Cp2 3 4 ' + v(model.cp2));
      const eddy = fin(model.lse) && fin(model.rse);
      lines.push('R1 1 p1 ' + v(model.rpri), 'Ls1 p1 ' + (eddy ? 'pe ' : 'p2 ') + v(model.lst / 2));
      if (eddy) lines.push('Le1 pe p2 ' + v(model.lse / 2), 'Re1 pe p2 ' + v(model.rse / 2));
      lines.push('Lm p2 2 ' + v(model.lm));
      if (fin(model.rfe)) lines.push('Rfe p2 2 ' + v(model.rfe));
      lines.push('Lt ' + sec + ' ' + v(n * n * model.lm), 'K1 Lm Lt 1', 'Ls2 s1 ' + (eddy ? 'se ' : 's2 ') + v(n * n * model.lst / 2));
      if (eddy) lines.push('Le2 se s2 ' + v(n * n * model.lse / 2), 'Re2 se s2 ' + v(n * n * model.rse / 2));
      lines.push('R2 s2 3 ' + v(model.rsec));
      if (fin(model.cwa)) lines.push('Cwa1 1 3 ' + v(model.cwa / 2), 'Cwa2 2 4 ' + v(model.cwa / 2));
      if (fin(model.cwx)) lines.push('Cwx1 1 4 ' + v(model.cwx / 2), 'Cwx2 2 3 ' + v(model.cwx / 2));
    }
    lines.push('.ends ' + name);
    return lines.join('\n') + '\n';
  }

  return {
    MAX_PORTS, TAU, RAD, abs, add, sub, mul, scale, div, get, put, matrix, indices, solve, submatrix,
    changeRef, toZY, fromZY, project, parseTouchstone, inspectSource, sourceToSingleEnded, loadGamma, terminate, prepareNetwork, processPoint,
    reflection, twoPort, transmission, cispr, cmcNatural, fitCMC, demoNetwork, exportTouchstone,
    plateau, crossing, peakFreq, lcFit, transformerPoint, analyzeTransformer, analyzeElement, classify4, median, profileLines, annotate, fitResonant, tankImpedance, resonantNetlist, joinPorts, joinInfo,
    modelImpedance, modelParams, modelWith, modelQuality, fitModel, fitCapacitor, modelNetlist,
    cmcModal, cmcModelY, cmcModelZ, trafoModelZ, trafoBasis, trafoCurves, multiQuality, fitMulti, multiSpread, multiUndetermined, fitMultiHeld, spreadClass, cmcSections, coreRelaxation, cmcCoreStart, cmcSectionOrder, coreSections, levenbergMarquardt, zError
  };
})();
