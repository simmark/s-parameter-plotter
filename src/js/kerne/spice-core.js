'use strict';
// SPICE subset for passive models: R, L, C, K, X, .subckt with parameters. AC analysis → S-parameters of the subcircuit pins.
const Spice = (() => {
  const SUFFIX = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

  function number(text) {
    const match = String(text).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmuµnpf])?[a-zµΩ]*$/i);
    if (!match) return NaN;
    const suffix = (match[2] || '').toLowerCase();
    return Number(match[1]) * (suffix === 'mil' ? 25.4e-6 : SUFFIX[suffix] ?? 1);
  }

  const FUNCTIONS = { sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, pow: Math.pow, pwr: Math.pow, min: Math.min, max: Math.max };

  function evaluate(text, scope) {
    const src = String(text).trim().replace(/^[{']|[}']$/g, '');
    let at = 0;
    const ws = () => { while (at < src.length && /\s/.test(src[at])) at++; };
    function primary() {
      ws();
      if (src[at] === '(') { at++; const value = sum(); ws(); if (src[at] === ')') at++; return value; }
      if (src[at] === '-') { at++; return -primary(); }
      if (src[at] === '+') { at++; return primary(); }
      const rest = src.slice(at), id = /^[A-Za-z_][\w.]*/.exec(rest);
      if (id) {
        at += id[0].length; ws();
        const name = id[0].toLowerCase();
        if (src[at] === '(') {
          at++;
          const args = [sum()]; ws();
          while (src[at] === ',') { at++; args.push(sum()); ws(); }
          if (src[at] === ')') at++;
          return FUNCTIONS[name] ? FUNCTIONS[name](...args) : NaN;
        }
        return name === 'pi' ? Math.PI : scope.has(name) ? scope.get(name) : NaN;
      }
      const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmuµnpf])?[a-zµΩ]*/i.exec(rest);
      if (num) { at += num[0].length; return number(num[0]); }
      at = src.length + 1;
      return NaN;
    }
    function power() { let v = primary(); ws(); while (src[at] === '^' || src.startsWith('**', at)) { at += src[at] === '^' ? 1 : 2; v = Math.pow(v, primary()); ws(); } return v; }
    function product() { let v = power(); ws(); while (src[at] === '*' || src[at] === '/') { const op = src[at++], r = power(); v = op === '*' ? v * r : v / r; ws(); } return v; }
    function sum() { let v = product(); ws(); while (src[at] === '+' || src[at] === '-') { const op = src[at++], r = product(); v = op === '+' ? v + r : v - r; ws(); } return v; }
    const value = sum(); ws();
    return at === src.length ? value : NaN;
  }

  function parse(text, fileName) {
    const lines = [];
    for (const raw of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
      const line = raw.replace(/;.*$/, '');
      if (!line.trim() || /^\s*\*/.test(line)) continue;
      if (/^\s*\+/.test(line) && lines.length) lines[lines.length - 1] += ' ' + line.replace(/^\s*\+/, '');
      else lines.push(line.trim());
    }
    const subs = new Map(), globals = [], warnings = new Set();
    let cur = null;
    const pairs = (tokens, into) => tokens.forEach(token => { const at = token.indexOf('='); if (at > 0) into.push([token.slice(0, at).toLowerCase(), token.slice(at + 1)]); });
    for (const full of lines) {
      const tokens = full.replace(/\{[^}]*\}/g, m => m.replace(/\s+/g, '')).replace(/\s*=\s*/g, '=').split(/[\s,]+/).filter(token => token && !/^params:?$/i.test(token));
      const head = tokens[0].toLowerCase();
      if (head === '.subckt') {
        const plain = tokens.slice(2).filter(token => !token.includes('='));
        cur = { name: tokens[1].toLowerCase(), label: tokens[1], pins: plain.map(p => p.toLowerCase()), params: [], elements: [], calls: new Set(), unsupported: new Set() };
        pairs(tokens.slice(2), cur.params);
        subs.set(cur.name, cur);
      } else if (head === '.ends') cur = null;
      else if (head === '.param') pairs(tokens.slice(1), cur ? cur.params : globals);
      else if (head[0] === '.') { if (!['.end', '.backanno', '.lib', '.inc', '.include'].includes(head)) warnings.add(head); }
      else if (cur) {
        const type = head[0].toUpperCase(), name = head;
        if (type === 'R' || type === 'L' || type === 'C') {
          const extra = [];
          pairs(tokens.slice(3), extra);
          const value = tokens[3] && !/^(rser|rpar|cpar|ic|temp|tc\d?)=/i.test(tokens[3]) ? tokens[3].replace(/^[rlc]=/i, '') : '';
          cur.elements.push({ type, name, nodes: [tokens[1], tokens[2]], value, extra: new Map(extra) });
        } else if (type === 'K') cur.elements.push({ type, name, inductors: tokens.slice(1, -1).map(t => t.toLowerCase()), value: tokens.at(-1) });
        else if (type === 'X') {
          const plain = tokens.slice(1).filter(token => !token.includes('=')), params = [];
          pairs(tokens.slice(1), params);
          const sub = plain.at(-1).toLowerCase();
          cur.calls.add(sub);
          cur.elements.push({ type, name, nodes: plain.slice(0, -1), sub, params });
        } else cur.unsupported.add(type);
      }
    }
    const called = new Set([...subs.values()].flatMap(sub => [...sub.calls]));
    const tops = [...subs.values()].filter(sub => !called.has(sub.name) && sub.pins.length >= 1 && sub.pins.length <= 32);
    if (!subs.size) throw new Error('Keine .subckt-Definition gefunden.');
    return { fileName, subs, globals, tops, warnings: [...warnings] };
  }

  function flatten(lib, top) {
    const nodes = new Map(), R = [], L = [], C = [], K = [];
    const node = key => { if (!nodes.has(key)) nodes.set(key, nodes.size); return nodes.get(key); };
    const ground = name => name === '0' || name === 'gnd';
    const globals = new Map();
    for (const [key, raw] of lib.globals) globals.set(key, evaluate(raw, globals));
    function instance(sub, path, pinNodes, overrides, depth) {
      if (depth > 12) throw new Error('Subcircuits sind zu tief verschachtelt.');
      if (sub.unsupported.size) throw new Error('Nicht unterstützte Elemente in ' + sub.label + ': ' + [...sub.unsupported].join(', ') + ' (nur R, L, C, K, X).');
      const scope = new Map([...globals, ...overrides]);
      for (const [key, raw] of sub.params) if (!overrides.has(key)) scope.set(key, evaluate(raw, scope));
      const local = raw => {
        const name = raw.toLowerCase(), pin = sub.pins.indexOf(name);
        return pin >= 0 ? pinNodes[pin] : ground(name) ? -1 : node(path + name);
      };
      const read = (element, raw) => {
        const value = evaluate(raw, scope);
        if (!Number.isFinite(value)) throw new Error('Wert von ' + element.name + ' in ' + sub.label + ' nicht lesbar: ' + raw);
        return value;
      };
      for (const element of sub.elements) {
        if (element.type === 'X') {
          const child = lib.subs.get(element.sub);
          if (!child) throw new Error('Subcircuit ' + element.sub + ' fehlt in der Bibliothek.');
          if (child.pins.length !== element.nodes.length) throw new Error('Pinzahl von ' + element.name + ' passt nicht zu ' + child.label + '.');
          const next = new Map();
          for (const [key, raw] of element.params) next.set(key, read(element, raw));
          instance(child, path + element.name + '.', element.nodes.map(local), next, depth + 1);
        } else if (element.type === 'K') K.push({ names: element.inductors.map(name => path + name), k: read(element, element.value) });
        else {
          let a = local(element.nodes[0]);
          const b = local(element.nodes[1]), value = read(element, element.value), extra = key => element.extra.has(key) ? read(element, element.extra.get(key)) : 0;
          const name = path + element.name, rser = extra('rser');
          if (element.type !== 'R') {
            if (extra('rpar') > 0) R.push({ a, b, v: extra('rpar') });
            if (element.type === 'L' && extra('cpar') > 0) C.push({ a, b, v: extra('cpar') });
            if (rser > 0) { const mid = node(name + '#rser'); R.push({ a, b: mid, v: rser }); a = mid; }
          }
          ({ R, L, C })[element.type].push({ name, a, b, v: value });
        }
      }
    }
    const pins = top.pins.map(pin => ground(pin) ? -1 : node('pin:' + pin));
    instance(top, '', pins, new Map(), 0);
    const index = new Map(L.map((l, i) => [l.name, i])), M = L.length, mutual = new Float64Array(M * M);
    L.forEach((l, i) => { mutual[i * M + i] = l.v; });
    for (const { names, k } of K) {
      const ids = names.map(name => index.get(name));
      if (ids.some(id => id === undefined)) throw new Error('Kopplung verweist auf eine unbekannte Induktivität: ' + names.join(' '));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const m = k * Math.sqrt(L[ids[i]].v * L[ids[j]].v);
        mutual[ids[i] * M + ids[j]] = m; mutual[ids[j] * M + ids[i]] = m;
      }
    }
    return { pins, nodeCount: nodes.size, R, L, C, mutual, elements: R.length + L.length + C.length };
  }

  function sparams(net, freq, z0 = 50) {
    const N = net.nodeCount, M = net.L.length, size = N + M, P = net.pins.length, root = Math.sqrt(z0);
    return Array.from(freq, f => {
      const w = 2 * Math.PI * f, A = new Float64Array(2 * size * size), B = new Float64Array(2 * size * P);
      const add = (r, c, re, im) => { if (r < 0 || c < 0) return; const at = 2 * (r * size + c); A[at] += re; A[at + 1] += im; };
      const stamp = (a, b, re, im) => { add(a, a, re, im); add(b, b, re, im); add(a, b, -re, -im); add(b, a, -re, -im); };
      for (let i = 0; i < N; i++) add(i, i, 1e-12, 0);
      for (const r of net.R) stamp(r.a, r.b, 1 / Math.max(Math.abs(r.v), 1e-9), 0);
      for (const c of net.C) stamp(c.a, c.b, 0, w * c.v);
      net.L.forEach((l, m) => {
        add(l.a, N + m, 1, 0); add(l.b, N + m, -1, 0); add(N + m, l.a, 1, 0); add(N + m, l.b, -1, 0);
        for (let k = 0; k < M; k++) if (net.mutual[m * M + k]) add(N + m, N + k, 0, -w * net.mutual[m * M + k]);
      });
      net.pins.forEach((pin, k) => { add(pin, pin, 1 / z0, 0); if (pin >= 0) B[2 * (pin * P + k)] += 2 / root; });
      const x = RF.solve(A, B, size, P);
      if (!x) return null;
      const s = new Float64Array(2 * P * P);
      for (let i = 0; i < P; i++) for (let k = 0; k < P; k++) {
        const pin = net.pins[i], at = 2 * (i * P + k);
        s[at] = (pin >= 0 ? x[2 * (pin * P + k)] / root : 0) - Number(i === k);
        s[at + 1] = pin >= 0 ? x[2 * (pin * P + k) + 1] / root : 0;
      }
      return s;
    });
  }

  function dataset(lib, sub, sweep) {
    const net = flatten(lib, sub), count = Math.max(11, sweep.n | 0);
    const freq = Float64Array.from({ length: count }, (_, i) => sweep.f1 * (sweep.f2 / sweep.f1) ** (i / (count - 1)));
    const samples = sparams(net, freq);
    if (!samples.some(Boolean)) throw new Error('Das Netzwerk ist singulär und lässt sich nicht lösen.');
    const n = sub.pins.length;
    return {
      name: sub.label, n, refs: Array(n).fill(50), freq, samples, version: 'SPICE', format: 'AC', sourceKind: 'Modell',
      portNames: sub.pins.map(pin => 'Pin ' + pin), sourcePairs: [], profile: null, embedded: null,
      warnings: lib.warnings.length ? ['Ignorierte SPICE-Anweisungen: ' + lib.warnings.join(' ')] : [], noiseCount: 0, demo: false,
      spice: { lib: lib.fileName, sub: sub.name, elements: net.elements, nodes: net.nodeCount }
    };
  }

  return { parse, flatten, sparams, dataset, number, evaluate };
})();
