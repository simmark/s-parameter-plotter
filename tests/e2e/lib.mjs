// Shared helpers for the browser regression tests: static server, Chrome with a real profile, synthetic test data.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

// The root can be switched while the server runs: that is how the update from an older app version is tested on one origin.
export function serve(root = ROOT) {
  return new Promise(resolve => {
    const state = { root };
    const server = http.createServer((req, res) => {
      const root = state.root;
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/', setRoot: next => { state.root = next; }, close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done); }) }));
  });
}

export const tempDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// A real browser profile on disk: closing and launching again is a full browser restart.
export async function launch(profile, { mobile = false, lang = 'de-DE' } = {}) {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, locale: lang, acceptDownloads: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : fs.existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {}),
    args: ['--no-sandbox'],
    ...(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' } : { viewport: { width: 1360, height: 900 } })
  });
  const page = context.pages()[0] ?? await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|favicon/.test(message.text())) errors.push(message.text()); });
  return { context, page, errors };
}

// ---- Synthetic Touchstone data (no manufacturer files in the repository) ----
export function touchstone(ports, seed = 1, points = 60) {
  const lines = ['! synthetic test network ' + seed, '# Hz S RI R 50'];
  for (let k = 0; k < points; k++) {
    const f = 1e5 * 10 ** (4 * k / (points - 1)), row = [f.toExponential(6)];
    for (let i = 0; i < ports; i++) for (let j = 0; j < ports; j++) {
      const a = 0.05 + 0.4 * Math.abs(Math.sin(seed * 0.37 + i * 1.3 + j * 0.7 + k * 0.05)), ph = seed * 0.11 + (i + j) * 0.5 - k * 0.07;
      row.push((a * Math.cos(ph) * (i === j ? 0.5 : 1)).toFixed(8), (a * Math.sin(ph) * (i === j ? 0.5 : 1)).toFixed(8));
    }
    if (ports <= 2) lines.push(row.join(' '));
    else for (let i = 0; i < ports; i++) lines.push((i ? '' : row[0] + ' ') + row.slice(1 + i * ports * 2, 1 + (i + 1) * ports * 2).join(' '));
  }
  return lines.join('\n') + '\n';
}

// ---- ZIP writer for tests: store/deflate, UTF-8 or raw names, and deliberate defects ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (~c) >>> 0; };
// entries: [{ name, data, method = 8, flags, rawName, corrupt, fakeSize, encrypted }]
export function makeZip(entries, { comment = '', zip64 = false } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const name = e.rawName ?? Buffer.from(e.name, 'utf8');
    const method = e.method ?? 8;
    let body = method === 8 ? zlib.deflateRawSync(data) : method === 0 ? data : Buffer.from(data);
    const flags = e.flags ?? ((e.rawName ? 0 : 0x800) | (e.encrypted ? 1 : 0));
    const crc = crc32(data), size = e.fakeSize ?? data.length;
    if (e.corrupt) { body = Buffer.from(body); body[Math.floor(body.length / 2)] ^= 0xff; }
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    let extra = Buffer.alloc(0);
    if (zip64) {
      // ZIP64 extended information: sizes and offset move into the extra field, the 32-bit fields hold 0xFFFFFFFF.
      extra = Buffer.alloc(28);
      extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2); extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(body.length), 12); extra.writeBigUInt64LE(BigInt(offset), 20);
      cd.writeUInt32LE(0xffffffff, 20); cd.writeUInt32LE(0xffffffff, 24); cd.writeUInt32LE(0xffffffff, 42); cd.writeUInt16LE(28, 30); cd.writeUInt16LE(45, 6);
    }
    parts.push(head, name, body); central.push(cd, name, extra);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22), note = Buffer.from(comment, 'utf8');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(note.length, 20);
  if (zip64) {
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32); record.writeBigUInt64LE(BigInt(cdBuf.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + cdBuf.length), 8); locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
    return Buffer.concat([...parts, cdBuf, record, locator, end, note]);
  }
  return Buffer.concat([...parts, cdBuf, end, note]);
}

// 100 files in nested folders with several port counts, plus Unicode names and equal names in different folders.
export function bigPackage(count = 100) {
  const files = [], families = ['CMC/0805', 'CMC/1206', 'LAN-Übertrager/10BASE-T1L', 'Induktivitäten', 'Kondensatoren/X7R/0402'];
  for (let i = 0; i < count; i++) {
    const ports = [1, 2, 4, 2, 4][i % 5], folder = families[i % families.length];
    const name = i % 10 === 0 ? 'Messung.s' + ports + 'p' : 'Bauteil_' + String(i).padStart(3, '0') + (i % 7 === 0 ? '_Größe' : '') + '.s' + ports + 'p';
    files.push({ name: folder + (i % 10 === 0 ? '/Serie' + i : '') + '/' + name, data: touchstone(ports, i + 1) });
  }
  return files;
}

export async function waitIdle(page, timeout = 120000) {
  await page.waitForFunction(() => document.getElementById('store-dialog').dataset.state !== 'running', null, { timeout });
}
export const importResult = page => page.evaluate(() => { const raw = document.getElementById('store-dialog').dataset.result; return raw ? JSON.parse(raw) : null; });
export const sessionKeys = page => page.evaluate(async () => (await Store.entries('session')).map(e => Store.keyOf(e)).sort());
export const libraryKeys = page => page.evaluate(async () => (await Store.entries('library')).map(e => Store.keyOf(e)).sort());

export class Report {
  constructor(title) { this.title = title; this.rows = []; this.failed = 0; }
  check(name, ok, detail = '') {
    this.rows.push({ name, ok: !!ok, detail });
    if (!ok) this.failed++;
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' · ' + detail : ''));
    return !!ok;
  }
  equal(name, actual, expected) { return this.check(name, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual) === JSON.stringify(expected) ? String(typeof expected === 'object' ? '' : expected) : 'ist ' + JSON.stringify(actual)?.slice(0, 200) + ' · soll ' + JSON.stringify(expected)?.slice(0, 200)); }
  done() {
    const verdict = this.failed ? 'FAIL' : 'PASS';
    console.log(verdict + ' · ' + this.title + ' · ' + (this.rows.length - this.failed) + '/' + this.rows.length);
    return !this.failed;
  }
}

// Polls an async check inside the page (waitForFunction does not wait for promises).
export async function until(page, check, arg = undefined, timeout = 120000) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(check, arg)) return;
    if (Date.now() - start > timeout) throw new Error('Zeitüberschreitung beim Warten auf: ' + String(check).slice(0, 120));
    await page.waitForTimeout(100);
  }
}

// ---- Reference networks with known answers (complex arithmetic kept explicit and small) ----
const cx = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }, inv: a => cx.div([1, 0], a) };
export const logFreqs = (f1, f2, n) => Array.from({ length: n }, (_, k) => f1 * (f2 / f1) ** (k / (n - 1)));
// Inductor with winding capacitance: R + (jωL ∥ 1/(jωC) ∥ Rp)
export const inductorZ = ({ L, C, R, Rp }) => f => { const w = 2 * Math.PI * f; return cx.add([R, 0], cx.inv(cx.add(cx.add(cx.inv([0, w * L]), [0, w * C]), [1 / Rp, 0]))); };
// Capacitor with ESR and ESL: ESR + jωESL + 1/(jωC)
export const capacitorZ = ({ C, ESR, ESL }) => f => { const w = 2 * Math.PI * f; return [ESR, w * ESL - 1 / (w * C)]; };
// Two-port Touchstone of an impedance in series between the ports, or in shunt to ground.
export function fixtureS2P(z, freqs, kind = 'series', z0 = 50) {
  const lines = ['! synthetic reference: ' + kind + ' fixture', '# Hz S RI R ' + z0];
  for (const f of freqs) {
    const Z = z(f);
    let s11, s21;
    if (kind === 'series') { const d = cx.add(Z, [2 * z0, 0]); s11 = cx.div(Z, d); s21 = cx.div([2 * z0, 0], d); }
    else { const d = cx.add([z0, 0], cx.mul([2, 0], Z)); s11 = cx.div([-z0, 0], d); s21 = cx.div(cx.mul([2, 0], Z), d); }
    lines.push([f, ...s11, ...s21, ...s21, ...s11].map(v => Number(v).toPrecision(12)).join(' '));
  }
  return lines.join('\n') + '\n';
}
// One-port Touchstone of an impedance to ground.
export function reflectionS1P(z, freqs, z0 = 50) {
  const lines = ['! synthetic reference: one-port', '# Hz S RI R ' + z0];
  for (const f of freqs) { const Z = z(f), g = cx.div(cx.sub(Z, [z0, 0]), cx.add(Z, [z0, 0])); lines.push([f, ...g].map(v => Number(v).toPrecision(12)).join(' ')); }
  return lines.join('\n') + '\n';
}
