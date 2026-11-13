// ERZEUGT von tools/extract_core.py aus index.html (<script id="rf-core">).
// Nicht von Hand ändern: Änderungen in index.html machen und das Skript neu ausführen.
'use strict';

const RF = (() => {
  const MAX_PORTS = 32;
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

  function parseTouchstone(text, name) {
    const suffix = name.match(/\.s(\d+)p$/i);
    const portNames = new Map(), warnings = [];
    const packagePins = new Map();
    let lanPart = false;
    const freq = [], samples = [];
    const options = { unit: 'GHZ', kind: 'S', format: 'MA', refs: [50] };
    const header = {};
    let state = 'header', pending = '', optionFound = false, sawNetwork = false;
    let version = '1.0', n = 0, refs, fileModes, positions, buffer, fill = 0;
    const deferredVendorRefs = [];
    let expected = null, noiseCount = 0, noiseLast = -Infinity, vendorRefsDiffer = false;
    let unknownVendorRefs = false;
    let lineNumber = 0;
    const fail = message => { throw new Error('Zeile ' + lineNumber + ' · ' + message); };

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
      if (options.kind !== 'S') {
        if (version.startsWith('1.')) {
          const r = options.refs[0];
          if (options.kind === 'Z' || options.kind === 'Y') {
            const k = options.kind === 'Z' ? r : 1 / r;
            for (let j = 0; j < data.length; j++) data[j] *= k;
          } else {
            const k = options.kind === 'H' ? r : 1 / r;
            data[0] *= k; data[1] *= k; data[6] /= k; data[7] /= k;
          }
        }
        const waveRefs = fileModes ? fileModes.refs : refs;
        data = ['H', 'G'].includes(options.kind)
          ? fromHybrid(data, waveRefs, options.kind)
          : fromZY(data, waveRefs, options.kind);
        if (!data) fail('Die Umrechnung nach S ist bei ' + f + ' Hz singulär.');
      }
      freq.push(f);
      samples.push(fileModes ? project(data, n, fileModes.inverse) : data);
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
      const port = comment.match(/^\s*Port\s*\[\s*(\d+)\s*\]\s*=\s*(.+?)\s*$/i);
      if (port) portNames.set(Number(port[1]) - 1, port[2].slice(0, 80));
      lanPart ||= /\bP\/N\s*:\s*7490220115\b/i.test(comment);
      for (const [, vna, pin] of comment.matchAll(/\bPort\s+(\d+)\s*--->\s*\|(\d+)\|/gi)) {
        packagePins.set(Number(vna), Number(pin));
      }
      for (const [, pin, vna] of comment.matchAll(/\|(\d+)\|\s*--->\s*Port\s+(\d+)\b/gi)) {
        packagePins.set(Number(vna), Number(pin));
      }
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
        for (const token of tokens) {
          const value = parseNum(token);
          if (Number.isNaN(value)) fail('Ungültige Zahl: ' + token.slice(0, 40));
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
    const pinout = [1, 2, 3, 22, 23, 24];
    const profile = n === 6 && options.kind === 'S' && !fileModes && lanPart &&
      pinout.every((pin, i) => packagePins.get(i + 1) === pin) ? {
        part: '7490220115',
        pairs: [{ p: 0, q: 2 }, { p: 3, q: 5 }],
        taps: [1, 4]
      } : null;
    if (profile) {
      ['D1+', 'CD1', 'D1−', 'X1+', 'CX1', 'X1−'].forEach((label, i) => {
        if (!portNames.has(i)) portNames.set(i, label + ' · Pin ' + pinout[i]);
      });
    }
    return {
      name, n, refs, freq: Float64Array.from(freq), samples, version, format: options.format, sourceKind: options.kind,
      portNames: indices(n).map(i => portNames.get(i) || ''), sourcePairs: fileModes?.pairs || [],
      profile, warnings: [...new Set(warnings)], noiseCount, demo: false
    };
  }

  function loadGamma(load, ref, f) {
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

  function prepareNetwork(dataset, config) {
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
    seModes.forEach((mode, i) => {
      if (!pairPortSet.has(mode.port)) {
        mmModes.push({ ...mode, natRef: mode.ref });
        rows.push([[i, 1]]);
      }
    });
    const mmNatRefs = mmModes.map(mode => mode.natRef), mmRefs = mmModes.map(mode => mode.ref);
    const mmRenorm = mmRefs.some((ref, i) => ref !== mmNatRefs[i]);
    return { active, reducedLoads, nativeRefs, seRefs, seModes, mmModes, rows, notices, mmNatRefs, mmRefs, mmRenorm, hasMixed: !!config.pairs.length };
  }

  function processPoint(dataset, config, layout, index) {
    const { active, reducedLoads, nativeRefs, seRefs, rows, hasMixed } = layout;
    const gamma = reducedLoads.map(i => loadGamma(config.loads[i], dataset.refs[i], dataset.freq[index]));
    if (gamma.some(v => !v)) return [null, null];
    const raw = terminate(dataset.samples[index], dataset.n, active, reducedLoads, gamma);
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
      h: diag[2], d: diag[3], coupling: Math.sqrt(crossEnergy / diagonalEnergy)
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
    return {
      fEval: freq[iEval], ocl, ocl0: fit.l, l22: ls, m: mm, k, n: Math.sqrt(ls / ocl),
      leak: leak.value, leakConf: leak.conf, leakBand: leak.band,
      rdc: lowMedian(freq, rsc), cww: cap.value, cwwConf: cap.conf, cwwBand: cap.band,
      fres, cpar: fit.c > 0 ? fit.c : NaN,
      series: { l11, l22, m, lsc, rsc, cww, z11 }
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
      const lCurve = Float64Array.from(freq, (f, i) => f > 0 && im[i] > 0 ? im[i] / w(f) : NaN);
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
        cp: Number.isFinite(fsrf) && l.value > 0 ? 1 / ((TAU * fsrf) ** 2 * l.value) : NaN, rp: rPeak, lFlat: flat.value,
        series: { l: lCurve, r: re }
      };
    }
    const fsrf = crossing(freq, im, 1);
    const cCurve = Float64Array.from(freq, (f, i) => f > 0 && im[i] < 0 ? -1 / (w(f) * im[i]) : NaN);
    const lCurve = Float64Array.from(freq, (f, i) => f > 0 && im[i] > 0 ? im[i] / w(f) : NaN);
    const c = plateau(freq, cCurve, first, Number.isFinite(fsrf) ? fsrf / 3 : freq.at(-1), 0.12);
    const esl = Number.isFinite(fsrf) ? plateau(freq, lCurve, fsrf * 2, freq.at(-1), 0.2) : { value: NaN, conf: 0 };
    let esr = NaN;
    if (Number.isFinite(fsrf)) esr = re[nearestIndex(freq, fsrf)];
    return {
      kind, c: c.value, cConf: c.conf, cBand: c.band, fsrf, esl: esl.value, eslConf: esl.conf, esr,
      series: { c: cCurve, l: lCurve, r: re }
    };
  }

  // A CMC conducts common mode galvanically at low frequency, a transformer isolates it.
  function classify4(freq, sccLow, sddLow) {
    if (!Number.isFinite(sccLow)) return { type: 'unknown', confidence: 0 };
    if (sccLow > 0.5) return { type: 'cmc', confidence: Math.min(1, (sccLow - 0.5) / 0.4 + 0.5) };
    if (sccLow < 0.2) return { type: 'transformer', confidence: Math.min(1, (0.2 - sccLow) / 0.18 + 0.5) };
    return { type: sddLow > sccLow ? 'transformer' : 'cmc', confidence: 0.3 };
  }

  function exportTouchstone(dataset, network, basis) {
    const layout = network.layout, active = layout.active;
    const mixed = basis === 'mm' && layout.hasMixed;
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

  return {
    MAX_PORTS, TAU, RAD, abs, add, sub, mul, scale, div, get, put, matrix, indices, solve, submatrix,
    changeRef, toZY, fromZY, project, parseTouchstone, loadGamma, terminate, prepareNetwork, processPoint,
    reflection, twoPort, transmission, cispr, cmcNatural, fitCMC, demoNetwork, exportTouchstone,
    plateau, crossing, peakFreq, lcFit, transformerPoint, analyzeTransformer, analyzeElement, classify4, median
  };
})();
if (typeof module === 'object' && module.exports) module.exports = RF;
