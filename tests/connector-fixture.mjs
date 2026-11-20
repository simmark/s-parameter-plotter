// Synthetic multiport measurements for connector and magnetics tests. Independent of the app code: own complex
// arithmetic, own matrix inversion, own Touchstone writer. Lumped circuits: branches with an inductance matrix (mutual
// coupling) and series resistance between nodes, capacitance matrix between nodes and to ground, ports to ground at 50 Ω.

const cx = (re, im = 0) => [re, im];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };

// Inverse of a complex square matrix (array of rows) by Gauss–Jordan with partial pivoting.
export function cinv(A) {
  const n = A.length, M = A.map((row, i) => [...row.map(v => [...v]), ...Array.from({ length: n }, (_, j) => cx(i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.hypot(...M[r][c]) > Math.hypot(...M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] = cdiv(M[c][j], d);
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f[0] || f[1]) for (let j = 0; j < 2 * n; j++) M[r][j] = csub(M[r][j], cmul(f, M[c][j])); }
  }
  return M.map(row => row.slice(n));
}
const cmatmul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((acc, v, k) => cadd(acc, cmul(v, B[k][j])), cx(0))));

// circuit: { nodes, branches: [{ a, b, r, l }], L: mutual inductance matrix entries [[i, j, M]], C: [[i, j, c]] (j = -1 → ground) }
// Returns S (array of rows) of the nodal network with every node a 50 Ω port, at frequency f.
export function sMatrix(circuit, f, z0 = 50) {
  const w = 2 * Math.PI * f, N = circuit.nodes, B = circuit.branches.length;
  const Zb = Array.from({ length: B }, (_, i) => Array.from({ length: B }, (_, j) => cx(0, i === j ? w * circuit.branches[i].l : 0)));
  circuit.branches.forEach((br, i) => { Zb[i][i] = cadd(Zb[i][i], cx(br.r)); });
  for (const [i, j, m] of circuit.L || []) { Zb[i][j] = cadd(Zb[i][j], cx(0, w * m)); Zb[j][i] = cadd(Zb[j][i], cx(0, w * m)); }
  const Yb = cinv(Zb);
  const Y = Array.from({ length: N }, () => Array.from({ length: N }, () => cx(0)));
  const inc = (node, br) => circuit.branches[br].a === node ? 1 : circuit.branches[br].b === node ? -1 : 0;
  for (let p = 0; p < B; p++) for (let q = 0; q < B; q++) {
    const y = Yb[p][q]; if (!y[0] && !y[1]) continue;
    for (const [n1, s1] of [[circuit.branches[p].a, 1], [circuit.branches[p].b, -1]]) for (const [n2, s2] of [[circuit.branches[q].a, 1], [circuit.branches[q].b, -1]]) {
      Y[n1][n2] = cadd(Y[n1][n2], [y[0] * s1 * s2, y[1] * s1 * s2]);
    }
  }
  void inc;
  for (const [i, j, c] of circuit.C || []) {
    const y = cx(0, w * c);
    Y[i][i] = cadd(Y[i][i], y);
    if (j >= 0) { Y[j][j] = cadd(Y[j][j], y); Y[i][j] = csub(Y[i][j], y); Y[j][i] = csub(Y[j][i], y); }
  }
  // S = (I + z0·Y)⁻¹ (I − z0·Y)
  const P = Y.map((row, i) => row.map((v, j) => cadd(cx(i === j ? 1 : 0), [z0 * v[0], z0 * v[1]])));
  const Q = Y.map((row, i) => row.map((v, j) => csub(cx(i === j ? 1 : 0), [z0 * v[0], z0 * v[1]])));
  return cmatmul(cinv(P), Q);
}

export const logf = (a, b, n) => Array.from({ length: n }, (_, k) => a * (b / a) ** (k / (n - 1)));

// Touchstone 1.0, RI, with "Port[k] = name" comments. order[port] = node index.
export function touchstone(circuit, freq, order, names = null, title = 'synthetic') {
  const n = order.length, lines = ['! ' + title + ' – synthetic test data, not a measurement'];
  if (names) names.forEach((name, k) => lines.push('! Port[' + (k + 1) + '] = ' + name));
  lines.push('# HZ S RI R 50');
  for (const f of freq) {
    const S = sMatrix(circuit, f), vals = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const v = S[order[r]][order[c]]; vals.push(v[0].toExponential(9), v[1].toExponential(9)); }
    const row = [String(f)];
    for (let k = 0; k < vals.length; k += 8) { row.push(vals.slice(k, k + 8).join(' ')); }
    lines.push(row.join('\n'));
  }
  return lines.join('\n') + '\n';
}

// Thru connector: K conductors with positions, each a branch from node u (side 1) to node K+u (side 2).
// Coupling decays with distance (exp(−d/0.6)), deliberately different from the 1/d² ranking used by the app.
export function connectorCircuit(positions, { l = 2e-9, r = 0.02, c = 0.25e-12, kl = 0.35, kc = 0.3 } = {}) {
  const K = positions.length, branches = positions.map((_, u) => ({ a: u, b: K + u, r, l })), L = [], C = [];
  for (let u = 0; u < K; u++) {
    C.push([u, -1, c], [K + u, -1, c]);
    for (let v = u + 1; v < K; v++) {
      const d = Math.hypot(positions[u][0] - positions[v][0], positions[u][1] - positions[v][1]);
      if (d > 3) continue;
      const k = Math.exp(-d / 0.6);
      L.push([u, v, kl * k * l]);
      C.push([u, v, kc * k * c], [K + u, K + v, kc * k * c]);
    }
  }
  return { nodes: 2 * K, branches, L, C };
}

// LAN transformer channels with centre taps: per channel nodes [P+, PCT, P−, S+, SCT, S−] (6 per channel), or without taps
// [P+, P−, S+, S−]. Half windings coupled with k; secondary sense set by `invert`. Small inter-winding and ground capacitances.
export function magneticsCircuit(channels, { taps = true, lHalf = 90e-6, k = 0.995, r = 0.3, cww = 4e-12, cg = 1e-12, invert = [] } = {}) {
  const branches = [], L = [], C = [];
  const per = taps ? 6 : 4;
  for (let ch = 0; ch < channels; ch++) {
    const o = ch * per, b0 = branches.length;
    if (taps) {
      // primary: P+ → PCT → P− ; secondary: S+ → SCT → S−
      branches.push({ a: o, b: o + 1, r, l: lHalf }, { a: o + 1, b: o + 2, r, l: lHalf }, { a: o + 3, b: o + 4, r, l: lHalf }, { a: o + 4, b: o + 5, r, l: lHalf });
    } else {
      branches.push({ a: o, b: o + 1, r, l: 4 * lHalf }, { a: o + 2, b: o + 3, r, l: 4 * lHalf });
    }
    const idx = [...Array(branches.length - b0).keys()].map(i => b0 + i), sense = i => (taps ? i >= 2 : i >= 1) && invert.includes(ch) ? -1 : 1;
    for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
      const li = branches[idx[i]].l, lj = branches[idx[j]].l;
      L.push([idx[i], idx[j], sense(i) * sense(j) * k * Math.sqrt(li * lj)]);
    }
    const pri = taps ? [o, o + 1, o + 2] : [o, o + 1], sec = taps ? [o + 3, o + 4, o + 5] : [o + 2, o + 3];
    for (const a of pri) for (const b of sec) C.push([a, b, cww / (pri.length * sec.length)]);
    for (const a of [...pri, ...sec]) C.push([a, -1, cg]);
  }
  return { nodes: channels * per, branches, L, C };
}

// Positions of the USB-C receptacle contacts in the order A1…A12, B1…B12 (same geometry as the profile, front view).
export const USB_POSITIONS = [...Array.from({ length: 12 }, (_, k) => [k, 0]), ...Array.from({ length: 12 }, (_, k) => [11 - k, 1.4])];
export const USB_IDS = [...Array.from({ length: 12 }, (_, k) => 'A' + (k + 1)), ...Array.from({ length: 12 }, (_, k) => 'B' + (k + 1))];
export const RJ45_POSITIONS = Array.from({ length: 8 }, (_, k) => [k * 1.02, 0]);

export function shuffled(n, seed = 7) {
  const a = [...Array(n).keys()];
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
