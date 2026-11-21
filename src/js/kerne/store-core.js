'use strict';
// Storage core: ZIP reading/writing and the durable file store. No DOM access, so it can be reused in a desktop shell.

// ---- Zip: defensive reader (central directory, ZIP64, CRC check, size limits) and a plain writer for backups. ----
const Zip = (() => {
  const LIMITS = { entries: 20000, fileBytes: 100 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024 };
  const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes, seed = 0) {
    let c = ~seed >>> 0;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  }
  class ZipError extends Error {
    constructor(code, message) { super(message); this.name = 'ZipError'; this.code = code; }
  }
  const slice = async (blob, start, length) => new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
  const big = (view, at) => {
    const value = view.getBigUint64(at, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('damaged', 'Das ZIP-Archiv enthält ungültige Größenangaben.');
    return Number(value);
  };

  function decodeName(bytes, utf8) {
    if (!utf8) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* legacy code page */ }
      let out = '';
      for (const b of bytes) out += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
      return out;
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Returns { dir, name } or null when the entry would leave the archive root or has no usable name.
  function safePath(raw) {
    const text = String(raw).replace(/\\/g, '/');
    if (/^[a-zA-Z]:/.test(text) || text.includes('\u0000')) return null;
    const parts = [];
    for (const part of text.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') return null;
      const clean = part.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (!clean || clean.length > 255) return null;
      parts.push(clean);
    }
    if (!parts.length || parts.length > 32) return null;
    return { name: parts.pop(), dir: parts.join('/') };
  }

  async function open(blob) {
    const size = blob.size;
    if (size < 22) throw new ZipError('not-zip', 'Kein lesbares ZIP-Archiv.');
    const tailLength = Math.min(size, 65557 + 20), tail = await slice(blob, size - tailLength, tailLength);
    const tv = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new ZipError('not-zip', 'Kein lesbares ZIP-Archiv. Das Ende des Archivs fehlt, die Datei ist vermutlich unvollständig.');
    if (tv.getUint16(end + 4, true) !== 0 || tv.getUint16(end + 6, true) !== 0) throw new ZipError('multi-disk', 'Mehrteilige ZIP-Archive werden nicht unterstützt.');
    let count = tv.getUint16(end + 10, true), cdSize = tv.getUint32(end + 12, true), cdOffset = tv.getUint32(end + 16, true);
    if (end >= 20 && tv.getUint32(end - 20, true) === 0x07064b50) {
      const at = big(tv, end - 20 + 8);
      if (at + 56 > size) throw new ZipError('damaged', 'Das ZIP64-Archiv ist beschädigt.');
      const z = await slice(blob, at, 56), zv = new DataView(z.buffer);
      if (zv.getUint32(0, true) !== 0x06064b50) throw new ZipError('damaged', 'Das ZIP64-Archiv ist beschädigt.');
      count = big(zv, 32); cdSize = big(zv, 40); cdOffset = big(zv, 48);
    } else if (count === 0xffff || cdOffset === 0xffffffff) {
      throw new ZipError('damaged', 'Das ZIP64-Archiv ist beschädigt.');
    }
    if (count > LIMITS.entries) throw new ZipError('too-many', 'Das Archiv enthält ' + count + ' Einträge. Mehr als ' + LIMITS.entries + ' werden nicht verarbeitet.');
    if (cdOffset + cdSize > size) throw new ZipError('damaged', 'Das Inhaltsverzeichnis des ZIP-Archivs ist beschädigt.');
    const cd = await slice(blob, cdOffset, cdSize), view = new DataView(cd.buffer);
    const entries = [];
    let at = 0;
    for (let k = 0; k < count; k++) {
      if (at + 46 > cd.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError('damaged', 'Das Inhaltsverzeichnis des ZIP-Archivs ist beschädigt.');
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true);
      let packed = view.getUint32(at + 20, true), length = view.getUint32(at + 24, true), local = view.getUint32(at + 42, true);
      const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
      if (at + 46 + nameLength + extraLength + commentLength > cd.length) throw new ZipError('damaged', 'Das Inhaltsverzeichnis des ZIP-Archivs ist beschädigt.');
      let raw = decodeName(cd.subarray(at + 46, at + 46 + nameLength), !!(flags & 0x800));
      let x = at + 46 + nameLength;
      const extraEnd = x + extraLength;
      while (x + 4 <= extraEnd) {
        const id = view.getUint16(x, true), len = view.getUint16(x + 2, true);
        if (x + 4 + len > extraEnd) break;
        if (id === 0x0001) {
          let p = x + 4;
          if (length === 0xffffffff && p + 8 <= x + 4 + len) { length = big(view, p); p += 8; }
          if (packed === 0xffffffff && p + 8 <= x + 4 + len) { packed = big(view, p); p += 8; }
          if (local === 0xffffffff && p + 8 <= x + 4 + len) { local = big(view, p); p += 8; }
        } else if (id === 0x7075 && len > 5 && view.getUint8(x + 4) === 1) {
          raw = new TextDecoder('utf-8').decode(cd.subarray(x + 9, x + 4 + len));
        }
        x += 4 + len;
      }
      at = extraEnd + commentLength;
      const directory = raw.endsWith('/') || raw.endsWith('\\');
      if (directory) continue;
      const path = safePath(raw);
      const entry = { raw, dir: path?.dir ?? '', name: path?.name ?? raw, size: length, packed, method, crc, problem: '' };
      if (!path) entry.problem = 'Unsicherer oder ungültiger Pfad im Archiv.';
      else if (flags & 0x41) entry.problem = 'Verschlüsselte ZIP-Einträge werden nicht unterstützt.';
      else if (method !== 0 && method !== 8) entry.problem = 'Diese ZIP-Kompression (Methode ' + method + ') wird nicht unterstützt.';
      else if (method === 8 && typeof DecompressionStream !== 'function') entry.problem = 'Dieser Browser kann komprimierte ZIP-Einträge nicht entpacken.';
      else if (length > LIMITS.fileBytes) entry.problem = 'Die Datei überschreitet 100 MiB.';
      else if (local + 30 > size || (method === 0 && packed !== length)) entry.problem = 'Der Eintrag ist beschädigt.';
      entry.read = () => readEntry(blob, entry, local);
      entries.push(entry);
    }
    return { entries, count };
  }

  async function readEntry(blob, entry, local) {
    if (entry.problem) throw new ZipError('entry', entry.problem);
    const head = await slice(blob, local, 30), hv = new DataView(head.buffer);
    if (head.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new ZipError('entry', 'Der Eintrag ist beschädigt.');
    const start = local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    if (start + entry.packed > blob.size) throw new ZipError('entry', 'Der Eintrag ist abgeschnitten.');
    const data = blob.slice(start, start + entry.packed);
    let bytes;
    if (entry.method === 0) bytes = new Uint8Array(await data.arrayBuffer());
    else {
      // The declared size is the hard limit while inflating: a ZIP bomb is stopped after that many bytes.
      const reader = data.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      bytes = new Uint8Array(entry.size);
      let filled = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (filled + value.length > entry.size) {
            await reader.cancel().catch(() => {});
            throw new ZipError('entry', 'Der Eintrag ist größer als im Archiv angegeben.');
          }
          bytes.set(value, filled);
          filled += value.length;
        }
      } catch (error) {
        if (error instanceof ZipError) throw error;
        throw new ZipError('entry', 'Der Eintrag ist beschädigt und lässt sich nicht entpacken.');
      }
      if (filled !== entry.size) throw new ZipError('entry', 'Der Eintrag ist beschädigt (Länge weicht ab).');
    }
    if (crc32(bytes) !== entry.crc) throw new ZipError('entry', 'Der Eintrag ist beschädigt (Prüfsumme weicht ab).');
    return bytes;
  }

  // Writer without compression: Touchstone backups stay byte-identical and the blob is built from parts, not from one large buffer.
  async function build(files, onProgress = null) {
    const encoder = new TextEncoder(), parts = [], central = [];
    let offset = 0, done = 0;
    for (const file of files) {
      const name = encoder.encode(file.path), bytes = new Uint8Array(await file.blob.arrayBuffer());
      if (offset + bytes.length + name.length + 30 > 0xfffffff0 || files.length > 0xfffe) throw new ZipError('too-large', 'Die Sicherung überschreitet 4 GiB und kann nicht als eine ZIP-Datei geschrieben werden.');
      const crc = crc32(bytes), head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x800, true);
      head.setUint32(14, crc, true); head.setUint32(18, bytes.length, true); head.setUint32(22, bytes.length, true); head.setUint16(26, name.length, true);
      parts.push(head.buffer, name, file.blob);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x800, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
      central.push(entry.buffer, name);
      offset += 30 + name.length + bytes.length;
      onProgress?.(++done, files.length);
    }
    const cdSize = central.reduce((sum, part) => sum + part.byteLength, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  return { open, build, crc32, safePath, LIMITS, ZipError };
})();

// ---- Store: content-addressed files (OPFS, IndexedDB as fallback) plus metadata for session and libraries in IndexedDB. ----
const Store = (() => {
  const DB_NAME = 's-parameter-analyzer', DB_VERSION = 2, CONTENT_DIR = 'inhalt', MAIN_LIBRARY = 'lib-main';
  const MAX_FILE = 100 * 1024 * 1024;
  let db = null, contentDir = null, ready = null;
  const info = { idb: false, opfs: false, opfsWrite: false, error: '', blocked: false };
  // Test hook: lets the regression tests interrupt an import at a defined point.
  const hooks = { beforeCommit: null, afterWrite: null };

  class StoreError extends Error {
    constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
  }
  const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const keyOf = entry => (entry.path ? entry.path + '/' : '') + entry.name;
  const isQuota = error => error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '');

  // SHA-256: Web Crypto where available (secure context), otherwise the same digest in plain JavaScript.
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256js(bytes) {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const length = bytes.length, total = (length + 9 + 63) & ~63, data = new Uint8Array(total), w = new Uint32Array(64);
    data.set(bytes); data[length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(total - 8, Math.floor(length / 0x20000000), false); view.setUint32(total - 4, (length << 3) >>> 0, false);
    for (let at = 0; at < total; at += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + 4 * i, false);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) >>> 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
    }
    return [...h].map(v => v.toString(16).padStart(8, '0')).join('');
  }
  async function hashOf(bytes) {
    if (globalThis.crypto?.subtle) {
      try {
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      } catch { /* fall through */ }
    }
    return sha256js(bytes);
  }

  // ---- IndexedDB ----
  function openDb() {
    return new Promise((resolve, reject) => {
      let request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const d = request.result;
        // Version 1 kept the last opened files in "files"; the store stays untouched so that a migration can never lose it.
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('entries')) {
          const entries = d.createObjectStore('entries', { keyPath: 'id' });
          entries.createIndex('scope', 'scope');
          entries.createIndex('hash', 'hash');
        }
        if (!d.objectStoreNames.contains('imports')) d.createObjectStore('imports', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('libraries')) d.createObjectStore('libraries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'hash' });
      };
      request.onblocked = () => { info.blocked = true; };
      request.onsuccess = () => {
        const d = request.result;
        d.onversionchange = () => { d.close(); db = null; info.idb = false; };
        resolve(d);
      };
      request.onerror = () => reject(request.error);
    });
  }
  const wrap = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  function tx(stores, mode, work) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new StoreError('unavailable', 'Der Browserspeicher ist nicht verfügbar.')); return; }
      let t, result;
      try { t = db.transaction(stores, mode); } catch (error) { reject(error); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new StoreError('aborted', 'Der Schreibvorgang wurde abgebrochen.'));
      try {
        const out = work(...[].concat(stores).map(name => t.objectStore(name)));
        if (out && typeof out.then === 'function') out.then(value => { result = value; }, error => { try { t.abort(); } catch { /* already finished */ } reject(error); });
        else result = out;
      } catch (error) { try { t.abort(); } catch { /* already finished */ } reject(error); }
    });
  }
  const getAll = (store, index = null, query = null) => tx(store, 'readonly', s => wrap((index ? s.index(index) : s).getAll(query)));
  const getOne = (store, key) => tx(store, 'readonly', s => wrap(s.get(key)));
  const getMeta = async key => (await getOne('meta', key))?.value ?? null;
  const setMeta = (key, value) => tx('meta', 'readwrite', s => { s.put({ key, value }); });

  async function init() {
    ready ??= (async () => {
      try {
        db = await Promise.race([openDb(), new Promise((_, reject) => setTimeout(() => reject(new StoreError('blocked', 'Die Datenbank wird von einem anderen Tab mit einer älteren Version blockiert. Schließe die anderen Tabs der App und lade neu.')), 4000))]);
        info.idb = true;
      } catch (error) {
        info.error = error?.message || String(error);
      }
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          contentDir = await root.getDirectoryHandle(CONTENT_DIR, { create: true });
          info.opfs = true;
          info.opfsWrite = typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;
        }
      } catch { contentDir = null; }
      return info;
    })();
    return ready;
  }
  const persistent = () => !!db;

  // ---- Content: one file per SHA-256. createWritable() writes to a swap file and replaces atomically on close(). ----
  async function contentFile(hash) {
    if (contentDir) {
      try { return await (await contentDir.getFileHandle(hash)).getFile(); } catch { /* not in OPFS */ }
    }
    if (db) {
      const record = await getOne('blobs', hash);
      if (record) return record.blob;
    }
    return null;
  }
  async function putContent(bytes, hash) {
    const existing = await contentFile(hash);
    if (existing && existing.size === bytes.length) return 'kept';
    if (contentDir && info.opfsWrite) {
      try {
        const handle = await contentDir.getFileHandle(hash, { create: true });
        const writer = await handle.createWritable();
        try { await writer.write(bytes); await writer.close(); }
        catch (error) { await writer.abort?.().catch(() => {}); throw error; }
        return 'opfs';
      } catch (error) {
        try { await contentDir.removeEntry(hash); } catch { /* nothing written */ }
        if (isQuota(error)) throw new StoreError('quota', 'Der Speicherplatz des Browsers reicht nicht aus.');
      }
    }
    try {
      await tx('blobs', 'readwrite', s => { s.put({ hash, size: bytes.length, blob: new Blob([bytes]) }); });
    } catch (error) {
      if (isQuota(error)) throw new StoreError('quota', 'Der Speicherplatz des Browsers reicht nicht aus.');
      throw new StoreError('write', 'Die Datei konnte nicht gespeichert werden: ' + (error?.message || error));
    }
    return 'idb';
  }
  async function removeContent(hash) {
    if (contentDir) { try { await contentDir.removeEntry(hash); } catch { /* not there */ } }
    if (db) { try { await tx('blobs', 'readwrite', s => { s.delete(hash); }); } catch { /* not there */ } }
  }
  async function verifyContent(hash, size) {
    const file = await contentFile(hash);
    if (!file) return 'Die gespeicherte Datei fehlt.';
    if (file.size !== size) return 'Die gespeicherte Datei hat eine andere Länge.';
    if (await hashOf(new Uint8Array(await file.arrayBuffer())) !== hash) return 'Die gespeicherte Datei weicht vom Original ab.';
    return '';
  }
  // Content without any entry is removed. Runs after deletions and at start (never while an import holds the lock).
  async function collect(hashes) {
    for (const hash of new Set(hashes)) {
      const used = await tx('entries', 'readonly', s => wrap(s.index('hash').count(hash)));
      if (!used) await removeContent(hash);
    }
  }
  const withLock = (mode, work) => navigator.locks?.request ? navigator.locks.request('spa-store', mode === 'try' ? { ifAvailable: true } : {}, lock => mode === 'try' && !lock ? null : work()) : work();
  async function sweep() {
    if (!db) return 0;
    return await withLock('try', async () => {
      const used = new Set((await getAll('entries')).map(entry => entry.hash));
      const stale = [];
      if (contentDir) for await (const [name, handle] of contentDir.entries()) if (handle.kind === 'file' && !used.has(name) && !name.endsWith('.crswap')) stale.push(name);
      for (const record of await tx('blobs', 'readonly', s => wrap(s.getAllKeys()))) if (!used.has(record)) stale.push(record);
      for (const hash of stale) await removeContent(hash);
      return stale.length;
    }) ?? 0;
  }

  // ---- Entries, libraries ----
  const visible = entry => !entry.pending;
  async function entries(scope, libId = null) {
    if (!db) return [];
    const list = (await getAll('entries', 'scope', scope)).filter(visible);
    return libId ? list.filter(entry => entry.libId === libId) : list;
  }
  const entry = id => getOne('entries', id);
  async function updateEntry(id, patch) {
    if (!db) return null;
    return tx('entries', 'readwrite', async s => {
      const record = await wrap(s.get(id));
      if (!record) return null;
      Object.assign(record, typeof patch === 'function' ? patch(record) : patch);
      s.put(record);
      return record;
    });
  }
  async function removeEntries(ids) {
    if (!db || !ids.length) return 0;
    const hashes = [];
    await tx('entries', 'readwrite', async s => {
      for (const id of ids) {
        const record = await wrap(s.get(id));
        if (record) { hashes.push(record.hash); s.delete(id); }
      }
    });
    await collect(hashes);
    return hashes.length;
  }
  // Renames or moves library entries. All changes land in one transaction or none; a target that is already
  // taken by another file aborts the whole move, so nothing is overwritten or half moved.
  async function moveEntries(changes) {
    if (!db || !changes.length) return 0;
    const clean = changes.map(change => {
      const safe = Zip.safePath((change.path ? change.path + '/' : '') + change.name);
      if (!safe) throw new StoreError('name', 'Der Name ist nicht zulässig: ' + change.name);
      return { id: change.id, path: safe.dir, name: safe.name };
    });
    return tx('entries', 'readwrite', async s => {
      const moving = new Map();
      for (const change of clean) {
        const record = await wrap(s.get(change.id));
        if (!record || record.scope !== 'library') throw new StoreError('missing', 'Die Datei gibt es in der Bibliothek nicht mehr.');
        moving.set(change.id, { record, change });
      }
      const libs = new Set([...moving.values()].map(item => item.record.libId));
      const taken = new Map();
      for (const other of await wrap(s.index('scope').getAll('library'))) {
        if (!libs.has(other.libId) || other.pending || moving.has(other.id)) continue;
        taken.set(other.libId + '\n' + keyOf(other).toLowerCase(), other);
      }
      for (const { record, change } of moving.values()) {
        const key = record.libId + '\n' + keyOf(change).toLowerCase();
        if (taken.has(key)) throw new StoreError('conflict', 'Am Ziel gibt es schon eine Datei mit diesem Namen: ' + keyOf(change));
        taken.set(key, record);
      }
      let n = 0;
      for (const { record, change } of moving.values()) {
        if (record.path === change.path && record.name === change.name) continue;
        record.path = change.path; record.name = change.name; record.movedAt = Date.now();
        s.put(record); n++;
      }
      return n;
    });
  }
  async function fileOf(record) {
    const blob = await contentFile(record.hash);
    if (!blob) throw new StoreError('missing', 'Die gespeicherte Datei fehlt im Browserspeicher. Bitte erneut importieren.');
    return new File([blob], record.name);
  }
  // Replaces the content of one entry (e.g. after a port profile was written into the file).
  async function replaceContent(id, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer()), hash = await hashOf(bytes);
    const old = await entry(id);
    if (!old) return null;
    await putContent(bytes, hash);
    const problem = await verifyContent(hash, bytes.length);
    if (problem) throw new StoreError('verify', problem);
    const record = await updateEntry(id, { hash, size: bytes.length });
    await collect([old.hash]);
    return record;
  }

  async function libraries() {
    if (!db) return [];
    const list = await getAll('libraries');
    if (!list.length) {
      const main = { id: MAIN_LIBRARY, name: 'Bibliothek', createdAt: Date.now() };
      await tx('libraries', 'readwrite', s => { s.put(main); });
      return [main];
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }
  async function createLibrary(name) {
    const clean = String(name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    if (!clean) throw new StoreError('name', 'Gib einen Namen für die Bibliothek ein.');
    const list = await libraries();
    if (list.some(lib => lib.name.toLowerCase() === clean.toLowerCase())) throw new StoreError('name', 'Eine Bibliothek mit diesem Namen gibt es schon.');
    const lib = { id: uid('lib'), name: clean, createdAt: Date.now() };
    await tx('libraries', 'readwrite', s => { s.put(lib); });
    return lib;
  }
  async function renameLibrary(id, name) {
    const clean = String(name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    if (!clean) throw new StoreError('name', 'Gib einen Namen für die Bibliothek ein.');
    const list = await libraries();
    if (list.some(lib => lib.id !== id && lib.name.toLowerCase() === clean.toLowerCase())) throw new StoreError('name', 'Eine Bibliothek mit diesem Namen gibt es schon.');
    return tx('libraries', 'readwrite', async s => {
      const lib = await wrap(s.get(id));
      if (!lib) throw new StoreError('missing', 'Die Bibliothek gibt es nicht mehr.');
      lib.name = clean;
      s.put(lib);
      return lib;
    });
  }
  async function removeLibrary(id) {
    const list = await entries('library', id);
    await removeEntries(list.map(item => item.id));
    if (id !== MAIN_LIBRARY) await tx('libraries', 'readwrite', s => { s.delete(id); });
  }

  // ---- Import pipeline: prepare → read and validate → write content → verify → commit metadata in one transaction. ----
  function uniqueName(name, taken, dir) {
    const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) {
      const next = base + ' (' + n + ')' + ext;
      if (!taken.has((dir ? dir + '/' : '') + next)) return next;
    }
  }
  async function estimate() {
    try {
      const e = await navigator.storage?.estimate?.();
      return e ? { usage: e.usage ?? null, quota: e.quota ?? null } : { usage: null, quota: null };
    } catch { return { usage: null, quota: null }; }
  }

  // files: [{ path, name, read() → Blob | Uint8Array, problem?, extra? }] or already stored content { path, name, hash, size }.
  async function importBatch({ name, kind = 'files', scope = 'session', libId = null, files, resolveConflict = null, onProgress = null, signal = null }) {
    await init();
    const result = { persisted: persistent(), importId: null, name, total: files.length, entries: [], added: 0, identical: 0, replaced: 0, renamed: 0, skipped: 0, failed: [], cancelled: false, bytes: 0 };
    if (!db) return result;
    if (scope === 'library') libId ??= MAIN_LIBRARY;
    const cancelled = () => !!signal?.aborted;
    return await withLock('wait', async () => {
      const importId = uid('imp'), written = [];
      result.importId = importId;
      const record = { id: importId, name, kind, scope, libId, state: 'pending', total: files.length, done: 0, startedAt: Date.now(), finishedAt: null };
      await tx('imports', 'readwrite', s => { s.put(record); });
      const abandon = async () => {
        await tx('imports', 'readwrite', s => { s.delete(importId); });
        await collect(written);
        result.cancelled = true;
        result.entries = [];
        return result;
      };
      const known = files.reduce((sum, file) => sum + (file.hash ? 0 : file.size || 0), 0), space = await estimate();
      if (known && space.quota !== null && space.usage !== null && known * 1.1 > space.quota - space.usage) {
        await tx('imports', 'readwrite', s => { s.delete(importId); });
        throw new StoreError('quota', 'Der Speicherplatz des Browsers reicht für diesen Import nicht aus.');
      }
      const progress = (phase, done) => onProgress?.({ phase, done, total: files.length, stored: candidates.length, failed: result.failed.length, bytes: result.bytes });
      const candidates = [];
      let quotaHit = false;
      for (let i = 0; i < files.length; i++) {
        if (cancelled()) return abandon();
        const file = files[i];
        try {
          if (file.problem) throw new StoreError('invalid', file.problem);
          if (quotaHit) throw new StoreError('quota', 'Der Speicherplatz des Browsers reicht nicht aus.');
          let hash = file.hash, size = file.size;
          if (!hash) {
            const data = await file.read();
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
            if (bytes.length > MAX_FILE) throw new StoreError('invalid', 'Die Datei überschreitet 100 MiB.');
            if (!bytes.length) throw new StoreError('invalid', 'Die Datei ist leer.');
            hash = await hashOf(bytes); size = bytes.length;
            const how = await putContent(bytes, hash);
            if (how !== 'kept') written.push(hash);
            await hooks.afterWrite?.(i, file);
          }
          candidates.push({ path: file.path || '', name: file.name, hash, size, extra: file.extra || null });
          result.bytes += size;
        } catch (error) {
          if (error?.code === 'quota') quotaHit = true;
          result.failed.push({ path: file.path || '', name: file.name, reason: error?.message || String(error), index: i });
        }
        if ((i & 7) === 7) {
          record.done = i + 1;
          tx('imports', 'readwrite', s => { s.put(record); }).catch(() => {});
        }
        progress('write', i + 1);
      }
      if (cancelled()) return abandon();

      // Verify what is really on disk before anything becomes visible.
      const verified = [];
      for (let i = 0; i < candidates.length; i++) {
        if (cancelled()) return abandon();
        const c = candidates[i], problem = await verifyContent(c.hash, c.size);
        if (problem) result.failed.push({ path: c.path, name: c.name, reason: problem });
        else verified.push(c);
        onProgress?.({ phase: 'verify', done: i + 1, total: candidates.length, stored: verified.length, failed: result.failed.length, bytes: result.bytes });
      }

      // Conflicts: same place and name. Identical content is not stored twice, different content needs a decision.
      const current = (await getAll('entries', 'scope', scope)).filter(e => visible(e) && (scope !== 'library' || e.libId === libId));
      const byKey = new Map(current.map(e => [keyOf(e), e])), taken = new Set(byKey.keys());
      const fresh = [], conflicts = [];
      for (const c of verified) {
        const key = keyOf(c), old = byKey.get(key);
        if (old && old.hash === c.hash) { result.identical++; result.entries.push(old); continue; }
        if (old) { conflicts.push({ candidate: c, old }); continue; }
        if (taken.has(key)) { c.name = uniqueName(c.name, taken, c.path); result.renamed++; }
        taken.add(keyOf(c));
        fresh.push(c);
      }
      const removeIds = [], removeHashes = [];
      if (conflicts.length) {
        const decision = resolveConflict ? await resolveConflict(conflicts.map(({ candidate }) => keyOf(candidate))) : 'rename';
        if (decision === 'cancel' || cancelled()) return abandon();
        for (const { candidate, old } of conflicts) {
          if (decision === 'skip') { result.skipped++; result.entries.push(old); continue; }
          if (decision === 'replace') {
            removeIds.push(old.id); removeHashes.push(old.hash);
            candidate.keep = { settings: old.settings ?? null, subs: old.subs ?? null };
            result.replaced++;
          } else {
            candidate.name = uniqueName(candidate.name, taken, candidate.path);
            taken.add(keyOf(candidate));
            result.renamed++;
          }
          fresh.push(candidate);
        }
      }
      const now = Date.now();
      const created = fresh.map((c, i) => ({
        id: uid('e') + i, scope, libId: scope === 'library' ? libId : null, importId, path: c.path, name: c.name, hash: c.hash, size: c.size,
        addedAt: now, settings: c.keep?.settings ?? c.extra?.settings ?? null, subs: c.keep?.subs ?? c.extra?.subs ?? null,
        ports: c.extra?.ports ?? (Number(c.name.match(/\.s(\d+)p$/i)?.[1]) || null), type: c.extra?.type ?? '', source: c.extra?.source ?? name
      }));
      await hooks.beforeCommit?.(result);
      if (cancelled()) return abandon();
      // One transaction: either every entry of this import and its "committed" mark exist, or none of them.
      record.state = 'committed'; record.finishedAt = Date.now(); record.done = files.length;
      record.added = created.length; record.failed = result.failed.map(f => ({ path: f.path, name: f.name, reason: f.reason }));
      await tx(['entries', 'imports', 'meta'], 'readwrite', (e, imports, meta) => {
        for (const id of removeIds) e.delete(id);
        for (const item of created) e.put(item);
        imports.put(record);
        meta.put({ key: 'lastSaved', value: record.finishedAt });
      });
      await collect(removeHashes);
      result.added = created.length;
      result.entries.push(...created);
      return result;
    });
  }

  // Imports that never reached their commit: nothing of them is visible; the content they wrote is removed.
  async function recover() {
    if (!db) return [];
    return await withLock('try', async () => {
      const open = (await getAll('imports')).filter(item => item.state === 'pending');
      if (!open.length) return [];
      const ids = new Set(open.map(item => item.id));
      const leftovers = (await getAll('entries')).filter(item => item.pending && ids.has(item.importId));
      await tx(['entries', 'imports'], 'readwrite', (e, imports) => {
        for (const item of leftovers) e.delete(item.id);
        for (const item of open) imports.put({ ...item, state: 'interrupted', finishedAt: Date.now() });
      });
      return open;
    }) ?? [];
  }
  const dismissImport = id => tx('imports', 'readwrite', s => { s.delete(id); });
  const interrupted = async () => db ? (await getAll('imports')).filter(item => item.state === 'interrupted') : [];
  async function trimImports() {
    if (!db) return;
    const done = (await getAll('imports')).filter(item => item.state === 'committed').sort((a, b) => b.finishedAt - a.finishedAt);
    if (done.length > 40) await tx('imports', 'readwrite', s => { for (const item of done.slice(40)) s.delete(item.id); });
  }

  // ---- Diagnosis, self test, backup ----
  async function diagnose() {
    await init();
    const space = await estimate();
    let persisted = null;
    try { persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { persisted = null; }
    const all = db ? (await getAll('entries')).filter(visible) : [];
    return {
      idb: info.idb, opfs: info.opfs, opfsWrite: info.opfsWrite, error: info.error, backend: !db ? 'memory' : contentDir && info.opfsWrite ? 'opfs' : 'idb',
      usage: space.usage, quota: space.quota, persisted,
      files: new Set(all.map(item => item.hash)).size, bytes: [...new Map(all.map(item => [item.hash, item.size])).values()].reduce((a, b) => a + b, 0),
      sessionFiles: all.filter(item => item.scope === 'session').length, libraryFiles: all.filter(item => item.scope === 'library').length,
      libraries: db ? (await libraries()).length : 0, lastSaved: db ? await getMeta('lastSaved') : null, session: db ? await getMeta('session') : null
    };
  }
  async function requestPersist() {
    try { return navigator.storage?.persist ? await navigator.storage.persist() : null; } catch { return null; }
  }
  // Writes a test file through the same path as an import, reads it back, compares and removes it.
  async function selfTest() {
    await init();
    const steps = [], step = (name, ok, detail = '') => { steps.push({ name, ok, detail }); return ok; };
    if (!step('IndexedDB öffnen', !!db, info.error)) return { ok: false, steps };
    const bytes = new TextEncoder().encode('S-Parameter Analyzer · Speichertest · ' + Date.now() + ' · äöü ' + Math.random());
    const hash = await hashOf(bytes);
    let ok = true;
    try {
      const how = await putContent(bytes, hash);
      step('Testdatei schreiben', true, how === 'opfs' ? 'OPFS' : 'IndexedDB');
      const problem = await verifyContent(hash, bytes.length);
      ok = step('Testdatei lesen und vergleichen', !problem, problem) && ok;
      await tx('meta', 'readwrite', s => { s.put({ key: 'selftest', value: Date.now() }); });
      ok = step('Metadaten schreiben', (await getMeta('selftest')) > 0) && ok;
    } catch (error) {
      ok = step('Testdatei schreiben', false, error?.message || String(error));
    }
    try {
      await removeContent(hash);
      ok = step('Testdatei entfernen', !(await contentFile(hash))) && ok;
    } catch (error) { ok = step('Testdatei entfernen', false, error?.message || String(error)); }
    return { ok, steps };
  }

  const BACKUP_FILE = 'spa-backup.json';
  async function exportBackup(settings = {}, onProgress = null) {
    const all = (await getAll('entries')).filter(visible), files = [], seen = new Set();
    for (const item of all) {
      if (seen.has(item.hash)) continue;
      seen.add(item.hash);
      const blob = await contentFile(item.hash);
      if (!blob) throw new StoreError('missing', 'Die Datei ' + keyOf(item) + ' fehlt im Browserspeicher. Die Sicherung wurde nicht erstellt.');
      files.push({ path: CONTENT_DIR + '/' + item.hash, blob });
    }
    const manifest = {
      format: 'spa-backup', version: 1, createdAt: new Date().toISOString(), libraries: await libraries(),
      entries: all.map(({ id, scope, libId, path, name, hash, size, addedAt, settings: s, subs, ports, type, source }) => ({ id, scope, libId, path, name, hash, size, addedAt, settings: s, subs, ports, type, source })),
      session: await getMeta('session'), settings
    };
    files.unshift({ path: BACKUP_FILE, blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
    return { blob: await Zip.build(files, onProgress), files: seen.size, entries: all.length };
  }
  async function readBackup(blob) {
    const zip = await Zip.open(blob), head = zip.entries.find(item => item.dir === '' && item.name === BACKUP_FILE);
    if (!head) return null;
    let manifest;
    try { manifest = JSON.parse(new TextDecoder().decode(await head.read())); } catch { throw new StoreError('backup', 'Die Sicherung ist beschädigt (Inhaltsverzeichnis nicht lesbar).'); }
    if (manifest?.format !== 'spa-backup' || !Array.isArray(manifest.entries)) throw new StoreError('backup', 'Die Datei ist keine Sicherung des S-Parameter Analyzers.');
    return { manifest, zip };
  }
  // Restores additively: nothing existing is overwritten; a different file under the same name is kept under a new name.
  async function importBackup({ manifest, zip }, { onProgress = null, signal = null } = {}) {
    const content = new Map(zip.entries.filter(item => item.dir === CONTENT_DIR).map(item => [item.name, item]));
    const mine = await libraries(), libMap = new Map();
    for (const lib of Array.isArray(manifest.libraries) ? manifest.libraries : []) {
      const same = mine.find(item => item.id === lib.id) || mine.find(item => item.name.toLowerCase() === String(lib.name).toLowerCase());
      libMap.set(lib.id, same ? same.id : (await createLibrary(String(lib.name))).id);
    }
    const summary = { added: 0, identical: 0, renamed: 0, failed: [], settings: manifest.settings ?? null, cancelled: false };
    const groups = new Map();
    for (const item of manifest.entries) {
      if (!item || typeof item.name !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash || '')) continue;
      const scope = item.scope === 'library' ? 'library' : 'session', libId = scope === 'library' ? libMap.get(item.libId) ?? MAIN_LIBRARY : null;
      const key = scope + '|' + (libId ?? '');
      if (!groups.has(key)) groups.set(key, { scope, libId, files: [] });
      const safe = Zip.safePath((item.path ? item.path + '/' : '') + item.name);
      const source = content.get(item.hash);
      groups.get(key).files.push({
        path: safe?.dir ?? '', name: safe?.name ?? item.name, size: item.size,
        problem: !safe ? 'Unsicherer oder ungültiger Pfad in der Sicherung.' : !source ? 'Der Dateiinhalt fehlt in der Sicherung.' : '',
        read: async () => {
          const bytes = await source.read();
          if (await hashOf(bytes) !== item.hash) throw new StoreError('backup', 'Der Dateiinhalt in der Sicherung ist beschädigt.');
          return bytes;
        },
        extra: { settings: item.settings ?? null, subs: item.subs ?? null, ports: item.ports ?? null, type: item.type ?? '', source: item.source ?? 'Sicherung' }
      });
    }
    for (const group of groups.values()) {
      const r = await importBatch({ name: 'Sicherung', kind: 'backup', scope: group.scope, libId: group.libId, files: group.files, resolveConflict: async () => 'rename', onProgress, signal });
      if (r.cancelled) { summary.cancelled = true; break; }
      summary.added += r.added; summary.identical += r.identical; summary.renamed += r.renamed; summary.failed.push(...r.failed);
    }
    return summary;
  }

  // ---- Migration from version 1: "Zuletzt geöffnet" (IndexedDB "files") and the folder library (OPFS "bibliothek"). ----
  async function migrate() {
    if (!db) return { recent: 0, shelf: 0 };
    const out = { recent: 0, shelf: 0 };
    if (!(await getMeta('migrated-recent'))) {
      try {
        const old = (await getAll('files')).filter(item => item?.blob && item.name).sort((a, b) => a.savedAt - b.savedAt);
        if (old.length) {
          const r = await importBatch({ name: 'Zuletzt geöffnet', kind: 'migration', scope: 'session', files: old.map(item => ({ path: '', name: item.name, size: item.size, read: async () => item.blob, extra: { settings: item.settings ?? null } })) });
          out.recent = r.added;
          const last = r.entries.find(e => e.name === old.at(-1).name);
          if (last && !(await getMeta('session'))) await setMeta('session', { entryId: last.id, sub: null, updatedAt: Date.now() });
          if (r.failed.length) throw new Error('unvollständig');
        }
        await setMeta('migrated-recent', Date.now());
      } catch { /* retried at the next start; the old store is never deleted */ }
    }
    if (!(await getMeta('migrated-shelf'))) {
      try {
        const root = await navigator.storage?.getDirectory?.();
        let shelf = null;
        try { shelf = await root?.getDirectoryHandle('bibliothek'); } catch { shelf = null; }
        if (shelf) {
          const dec = name => { try { return decodeURIComponent(name); } catch { return name; } };
          const files = [];
          for await (const [folder, dir] of shelf.entries()) {
            if (dir.kind !== 'directory') continue;
            for await (const [name, handle] of dir.entries()) {
              if (handle.kind === 'file') files.push({ path: dec(folder), name: dec(name), read: () => handle.getFile(), extra: { type: dec(folder), source: 'Bibliothek (Version 1)' } });
            }
          }
          if (files.length) {
            const r = await importBatch({ name: 'Bibliothek (Version 1)', kind: 'migration', scope: 'library', libId: MAIN_LIBRARY, files });
            out.shelf = r.added + r.identical;
            if (r.failed.length || out.shelf !== files.length) throw new Error('unvollständig');
          }
          // The old folder is only removed after every file was verified in the new store.
          await root.removeEntry('bibliothek', { recursive: true });
        }
        await setMeta('migrated-shelf', Date.now());
      } catch { /* retried at the next start; the old folder stays */ }
    }
    return out;
  }

  return {
    init, persistent, info, hooks, hashOf, sha256js, keyOf, entries, entry, updateEntry, removeEntries, moveEntries, fileOf, replaceContent, verifyContent,
    libraries, createLibrary, renameLibrary, removeLibrary, importBatch, recover, interrupted, dismissImport, trimImports, sweep, getMeta, setMeta,
    diagnose, requestPersist, selfTest, estimate, exportBackup, readBackup, importBackup, migrate, MAIN_LIBRARY, MAX_FILE, StoreError
  };
})();
