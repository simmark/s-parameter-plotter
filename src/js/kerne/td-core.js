// Time domain from frequency-domain S-parameters: phase unwrapping, group delay, resampling with DC extrapolation, windowed inverse FFT,
// step and impulse response, TDR impedance, NRZ eye diagram by superposition and peak distortion. Pure functions, no DOM.
const TD = (() => {
  const TAU = 2 * Math.PI;
  const mag = v => Math.hypot(v[0], v[1]);

  // Unwrapped phase. Plain unwrapping takes the step closest to zero; when the delay estimate from the previous steps predicts
  // a step beyond ±π (sparse or logarithmic sampling of a long delay), the step closest to that prediction is taken instead.
  // That assumes a smooth delay and is reported (guided), never hidden.
  function unwrap(freq, values) {
    const out = new Float64Array(freq.length).fill(NaN), recent = [];
    let prev = null, guided = 0, maxStep = 0, last = -1;
    for (let i = 0; i < freq.length; i++) {
      const v = values[i];
      if (!v || !(mag(v) > 0)) continue;
      const raw = Math.atan2(v[1], v[0]);
      if (prev === null) { out[i] = raw; prev = raw; last = i; continue; }
      const dw = TAU * (freq[i] - freq[last]);
      let step = ((raw - prev) % TAU + TAU) % TAU; if (step > Math.PI) step -= TAU;   // plain: closest to zero
      // the delay is trusted only when the last three estimates agree within 10 % (a pure delay; not a filter edge)
      const tau = recent.length === 3 && recent.every(t => t > 0 && Math.abs(t - recent[2]) <= 0.1 * recent[2]) ? recent[2] : null;
      if (tau !== null && tau * dw > Math.PI / 2) {
        const k = Math.round((-tau * dw - step) / TAU);
        if (k) guided++;
        step += k * TAU;
      }
      maxStep = Math.max(maxStep, Math.abs(step));
      out[i] = prev + step;
      recent.push(-step / dw); if (recent.length > 3) recent.shift();
      prev = out[i]; last = i;
    }
    return { phase: out, guided, maxStep };
  }

  // Group delay τ = −dφ/dω (central differences on the real frequency spacing).
  function groupDelay(freq, values) {
    const { phase, guided, maxStep } = unwrap(freq, values), n = freq.length, tau = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : i, b = i < n - 1 ? i + 1 : i;
      if (a === b || !Number.isFinite(phase[a]) || !Number.isFinite(phase[b])) continue;
      tau[i] = -(phase[b] - phase[a]) / (TAU * (freq[b] - freq[a]));
    }
    return { tau, phase, guided, maxStep };
  }

  // Sampling of a frequency grid: linear or logarithmic spacing, lowest point relative to the step, gaps.
  function sampling(freq) {
    const f = Array.from(freq), n = f.length, d = f.slice(1).map((x, i) => x - f[i]), r = f.slice(1).map((x, i) => x / f[i]);
    const max = a => a.reduce((x, y) => Math.max(x, y), -Infinity), min = a => a.reduce((x, y) => Math.min(x, y), Infinity);
    const spread = a => a.length ? (max(a) - min(a)) / max(a.map(Math.abs)) : 0;
    const kind = n < 3 ? 'other' : spread(d) < 0.02 ? 'linear' : f[0] > 0 && spread(r) < 0.02 ? 'log' : 'other';
    return { kind, points: n, fmin: f[0], fmax: f[n - 1], maxStep: max(d), dcGap: f[0] };
  }

  // Values on the uniform grid k·df, k = 0…N−1 (N a power of two). Magnitude and unwrapped phase are interpolated linearly in f.
  // Below the first sample the magnitude is held and the phase extrapolated with the low-frequency delay; the DC value is real,
  // its sign from the extrapolated phase. Above fmax nothing is invented: the grid ends at fmax.
  function resample(freq, values, { points = 4096 } = {}) {
    const fmax = freq[freq.length - 1], N = points, df = fmax / (N - 1);
    const { phase, guided, maxStep } = unwrap(freq, values);
    // points with |S| = 0 carry no phase: it is taken from the nearest point that has one (irrelevant for the value)
    const idx = []; for (let i = 0; i < freq.length; i++) if (values[i] && Number.isFinite(mag(values[i]))) idx.push(i);
    if (idx.length < 2) throw new Error('Zu wenige gültige Frequenzpunkte für den Zeitbereich.');
    const known = idx.filter(i => Number.isFinite(phase[i]));
    const near = i => known.length ? phase[known.reduce((a, b) => Math.abs(b - i) < Math.abs(a - i) ? b : a)] : 0;
    const f = idx.map(i => freq[i]), m = idx.map(i => mag(values[i])), p = idx.map(i => Number.isFinite(phase[i]) ? phase[i] : near(i));
    const slope = (p[1] - p[0]) / (f[1] - f[0]), phi0 = p[0] - slope * f[0];
    const turns = Math.round(phi0 / Math.PI), sign = turns % 2 === 0 ? 1 : -1;
    const re = new Float64Array(N), im = new Float64Array(N);
    let j = 0;
    for (let k = 0; k < N; k++) {
      const x = k * df;
      let a, ph;
      if (x <= f[0]) { a = m[0]; ph = turns * Math.PI + (p[0] - turns * Math.PI) * (x / f[0]); }
      else {
        while (j < f.length - 2 && f[j + 1] < x) j++;
        const t = Math.min(1, (x - f[j]) / (f[j + 1] - f[j]));
        a = m[j] + (m[j + 1] - m[j]) * t; ph = p[j] + (p[j + 1] - p[j]) * t;
      }
      re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph);
    }
    re[0] = sign * m[0]; im[0] = 0;
    return { df, N, re, im, guided, maxStep, dcPhase: phi0, dcResidual: Math.abs(phi0 - turns * Math.PI) };
  }

  // In-place radix-2 FFT (sign −1 forward, +1 inverse without scaling).
  function fft(re, im, sign) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = sign * TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  // Spectral weighting on 0…fmax: window (rect, hann, kaiser) and a Gaussian edge for a given 10–90 % rise time.
  // Gaussian: |H| = exp(−ln2/2·(f/f3)²) with f3 = 0.3394/t_r has a 10–90 % step rise time t_r.
  function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; }
  function weights(N, df, { window = 'hann', beta = 6, rise = 0 } = {}) {
    const w = new Float64Array(N), f3 = rise > 0 ? 0.3394 / rise : 0;
    for (let k = 0; k < N; k++) {
      const x = k / (N - 1);
      let v = window === 'rect' ? 1 : window === 'kaiser' ? bessel0(beta * Math.sqrt(Math.max(0, 1 - x * x))) / bessel0(beta) : 0.5 * (1 + Math.cos(Math.PI * x));
      if (f3) v *= Math.exp(-Math.LN2 / 2 * (k * df / f3) ** 2);
      w[k] = v;
    }
    return w;
  }

  // Impulse response h[n] (per sample, sums to H(0)) and step response on t = t0 + n·dt. Zero padding in frequency refines the
  // time step (dt = 1/(2·N·df·oversample)); one eighth of the window lies before t = 0, so a non-causal band-limited edge at t = 0
  // is not folded to the end. The step is the trapezoidal integral of the impulse (no half-sample shift).
  function responses(grid, opts = {}) {
    const { N, df } = grid, os = opts.oversample ?? 4, M = 2 * N * os, w = weights(N, df, opts);
    const re = new Float64Array(M), im = new Float64Array(M);
    for (let k = 0; k < N; k++) { re[k] = grid.re[k] * w[k]; im[k] = grid.im[k] * w[k]; }
    for (let k = 1; k < N; k++) { re[M - k] = re[k]; im[M - k] = -im[k]; }       // Hermitian: real time signal
    fft(re, im, 1);
    const pre = M >> 3, dt = 1 / (M * df), h = new Float64Array(M), step = new Float64Array(M);
    for (let n = 0; n < M; n++) h[n] = re[(n - pre + M) % M] / M;   // sums to H(0)
    let acc = 0;
    for (let n = 0; n < M; n++) { step[n] = acc + h[n] / 2; acc += h[n]; }
    return { dt, t0: -pre * dt, h, step, span: 1 / df };
  }

  // TDR: impedance from the reflection step response, Z = Z0·(1+ρ)/(1−ρ).
  const impedance = (step, z0) => Float64Array.from(step, r => r < 0.999999 ? z0 * (1 + r) / (1 - r) : Infinity);

  // 10–90 % rise time and 50 % delay of a step response (settled value from the last tenth of the first half of the window).
  function edge(step, dt, t0 = 0) {
    const half = Math.floor(step.length / 2), tail = step.slice(Math.floor(half * 0.8), half), final = tail.reduce((a, b) => a + b, 0) / tail.length;
    const cross = level => { for (let n = 1; n < half; n++) { const a = step[n - 1] - level * final, b = step[n] - level * final; if (a * b <= 0 && a !== b) return t0 + (n - 1 + a / (a - b)) * dt; } return NaN; };
    return { final, t10: cross(0.1), t50: cross(0.5), t90: cross(0.9), rise: cross(0.9) - cross(0.1) };
  }

  // PRBS by LFSR (x^7+x^6+1, x^9+x^5+1, x^11+x^9+1, x^15+x^14+1): 2^k − 1 bits, every k-bit word except all zeros.
  const TAPS = { 7: [7, 6], 9: [9, 5], 11: [11, 9], 15: [15, 14] };
  function prbs(order) {
    const [a, b] = TAPS[order]; if (!a) throw new Error('PRBS-Ordnung nicht unterstützt.');
    let reg = (1 << order) - 1; const out = new Uint8Array((1 << order) - 1);
    for (let i = 0; i < out.length; i++) { const bit = ((reg >> (a - 1)) ^ (reg >> (b - 1))) & 1; out[i] = reg & 1; reg = ((reg << 1) | bit) & ((1 << order) - 1); }
    return out;
  }

  // Step response resampled to s samples per UI (linear interpolation), starting at t = 0.
  function perUI(step, dt, ui, s) {
    const h = ui / s, count = Math.floor((step.length / 2 - 1) * dt / h), out = new Float64Array(count);
    for (let n = 0; n < count; n++) { const x = n * h / dt, i = Math.floor(x), t = x - i; out[n] = step[i] + (step[i + 1] - step[i]) * t; }
    return out;
  }

  // NRZ eye: levels ±amp, a periodic PRBS pattern, waveform by superposition of the pulse response p(t) = s(t) − s(t − UI).
  // The pulse response is cut where it has decayed to 1e-4 of its peak; the pattern repeats, so the result is the steady state.
  // Metrics at the best sampling phase: inner eye height (lowest 1 − highest 0), eye width (phases with height > 0),
  // and peak distortion: main cursor minus the sum of all |ISI| cursors (the worst case of any pattern).
  function eye(step, dt, { ui, amp = 0.5, order = 7, s = 32 } = {}) {
    const st = perUI(step, dt, ui, s);
    const pulse = new Float64Array(st.length);
    for (let n = 0; n < st.length; n++) pulse[n] = st[n] - (n >= s ? st[n - s] : 0);
    let peak = 0; for (const v of pulse) peak = Math.max(peak, Math.abs(v));
    let len = pulse.length; while (len > s && Math.abs(pulse[len - 1]) < 1e-4 * peak) len--;
    const p = pulse.subarray(0, len), bits = prbs(order), L = bits.length, total = L * s;
    if (len > total * 4) throw new Error('Die Pulsantwort ist länger als das Vierfache des Musters. Wähle eine höhere PRBS-Ordnung oder eine höhere Bitrate.');
    const wave = new Float64Array(total);
    for (let k = 0; k < L; k++) {
      const a = (2 * bits[k] - 1) * amp;
      for (let n = 0; n < len; n++) wave[(k * s + n) % total] += a * p[n];
    }
    const heights = new Float64Array(s);
    let best = { phase: 0, height: -Infinity };
    // cursor position: sample index of the pulse maximum; bit k is sampled at k·s + cursor
    let top = 0; for (let n = 1; n < len; n++) if (pulse[n] > pulse[top]) top = n;
    // centre of the main lobe (pulse above half its peak): for a flat NRZ pulse the middle of the bit, for a peaked one the peak
    let lo = top, hi = top; while (lo > 0 && pulse[lo - 1] >= 0.5 * pulse[top]) lo--; while (hi < len - 1 && pulse[hi + 1] >= 0.5 * pulse[top]) hi++;
    const cur = Math.round((lo + hi) / 2);
    const at = (bit, off) => wave[((bit * s + off) % total + total) % total];
    for (let d = -Math.floor(s / 2); d < Math.ceil(s / 2); d++) {
      const off = cur + d;
      let lo1 = Infinity, hi0 = -Infinity;
      for (let k = 0; k < L; k++) { const v = at(k, off); if (bits[k]) lo1 = Math.min(lo1, v); else hi0 = Math.max(hi0, v); }
      const i = d + Math.floor(s / 2);
      heights[i] = lo1 - hi0;
      // ties (a flat eye) go to the phase closest to the pulse centre
      if (lo1 - hi0 > best.height + 1e-9 * amp || (Math.abs(lo1 - hi0 - best.height) <= 1e-9 * amp && Math.abs(d) < Math.abs(best.phase))) best = { phase: d, height: lo1 - hi0, offset: off, one: lo1, zero: hi0 };
    }
    const open = Array.from(heights, h => h > 0);
    const width = open.filter(Boolean).length / s;
    // peak distortion at the best phase
    const off = best.offset;
    let main = 0, isi = 0;
    for (let n = ((off % s) + s) % s; n < len; n += s) { if (n === off) main = p[n]; else isi += Math.abs(p[n]); }
    const pda = 2 * amp * (main - isi);
    return { wave, total, s, L, bits, cursor: cur, peak: top, best, heights, width, pda, main: main * amp, isi: isi * amp, pulse: p, ui };
  }

  return { unwrap, groupDelay, sampling, resample, fft, weights, responses, impedance, edge, prbs, perUI, eye };
})();
