// basis/rechnen – Rechen-Worker: Einlesen und Netzwerkrechnung außerhalb der Seite, mit Rückfall auf die Seite.
import { $ } from './dom.js';

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Large files are parsed in a worker built from the same RF source, so the page stays responsive.
let workerUrl = null;
function parseInWorker(bytes, name) {
  workerUrl ??= URL.createObjectURL(new Blob([$('rf-core').textContent + `
      self.onmessage = event => {
        const { bytes, name } = event.data;
        try {
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch { text = new TextDecoder('windows-1252').decode(bytes); }
          const dataset = RF.parseTouchstone(text, name);
          self.postMessage({ dataset }, [dataset.freq.buffer, ...dataset.samples.map(s => s.buffer)]);
        } catch (error) {
          self.postMessage({ error: error.message });
        }
      };`], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(workerUrl); } catch (error) { reject(Object.assign(error, { fallback: true })); return; }
    worker.onmessage = event => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.dataset);
    };
    worker.onerror = event => {
      worker.terminate();
      event.preventDefault?.();
      reject(Object.assign(new Error(event.message || 'Worker-Fehler'), { fallback: true }));
    };
    worker.postMessage({ bytes, name }, [bytes]);
  });
}

// Long model fits run in a worker built from the same RF source, so the page stays responsive (a fit of a four-terminal
// model takes seconds, on a phone longer). Only one fit runs at a time: a new one ends the previous worker. Without workers
// (or if the worker fails to start) the call runs on the page as before.
let jobUrl = null, jobWorker = null;
function rfJob(name, args) {
  const direct = () => new Promise(resolve => setTimeout(() => resolve(RF[name](...args)), 30));
  if (typeof Worker !== 'function') return direct();
  jobUrl ??= URL.createObjectURL(new Blob([$('rf-core').textContent + `
      self.onmessage = event => {
        const { name, args } = event.data;
        try { self.postMessage({ result: RF[name](...args) }); }
        catch (error) { self.postMessage({ error: error.message }); }
      };`], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(jobUrl); } catch { direct().then(resolve, reject); return; }
    jobWorker?.terminate();
    jobWorker = worker;
    const done = () => { worker.terminate(); if (jobWorker === worker) jobWorker = null; };
    worker.onmessage = event => { done(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
    worker.onerror = event => { event.preventDefault?.(); done(); direct().then(resolve, reject); };
    worker.postMessage({ name, args });
  });
}

// Compute worker: network (all frequency points), crosstalk of applied channels and eye diagrams run off the page, built from
// the same rf-core, td-core and connector-core source. Datasets are sent once and kept (the last three). A newer network job of
// the same lane (current file, comparison) ends the older one at its next pause. Results are identical to the page path (same
// code); if workers are missing or fail, everything runs on the page as before. window.SPA_NO_WORKER = true forces the page.
const compute = { url: null, worker: null, ids: new WeakMap(), sent: new Set(), next: 1, jobs: new Map(), failed: false, stats: { worker: 0, page: 0 } };
// local diagnostics for tests and the console (how many network jobs ran where); nothing leaves the browser
window.SPA_COMPUTE_STATS = () => ({ ...compute.stats, failed: compute.failed, running: !!compute.worker });
function computeWorker() {
  if (compute.failed || typeof Worker !== 'function' || window.SPA_NO_WORKER) return null;
  if (compute.worker) return compute.worker;
  compute.url ??= URL.createObjectURL(new Blob([$('rf-core').textContent, '\n', $('td-core').textContent, '\n', $('connector-core').textContent, `
      const sets = new Map(), latest = {};
      const pause = () => new Promise(resolve => setTimeout(resolve, 0));
      async function network(m) {
        const ds = sets.get(m.id);
        if (!ds) throw new Error('missing dataset');
        const layout = RF.prepareNetwork(ds, m.config), se = [], mm = [];
        let gaps = 0, start = performance.now();
        for (let i = 0; i < ds.freq.length; i++) {
          if ((i & 31) === 0 && performance.now() - start > 40) { await pause(); if (latest[m.lane] !== m.job) return null; start = performance.now(); }
          const [a, b] = RF.processPoint(ds, m.config, layout, i);
          se.push(a); mm.push(b); if (!a || !b) gaps++;
        }
        let xt = null;
        if (m.channels?.length) xt = Connector.crosstalk({ freq: ds.freq, mm, se, modes: layout.mmModes, active: layout.active, channels: m.channels });
        // one buffer per basis instead of one per point (thousands of transfers cost the page more than one copy here);
        // this also leaves the cached dataset intact (without loads a point is the dataset's own matrix)
        const pack = list => {
          const len = list.find(Boolean)?.length || 0, data = new Float64Array(len * list.length), mask = new Uint8Array(list.length);
          list.forEach((x, i) => { if (x) { data.set(x, i * len); mask[i] = 1; } });
          return { len, data, mask };
        };
        const se2 = pack(se), mm2 = mm.every((x, i) => x === se[i]) ? null : pack(mm);
        return { se: se2, mm: mm2, gaps, xt };
      }
      self.onmessage = async event => {
        const m = event.data;
        if (m.type === 'dataset') { sets.delete(m.id); sets.set(m.id, m.dataset); while (sets.size > 3) sets.delete(sets.keys().next().value); return; }
        try {
          if (m.type === 'network') {
            latest[m.lane] = m.job;
            const r = await network(m);
            if (!r) { self.postMessage({ job: m.job, cancelled: true }); return; }
            self.postMessage({ job: m.job, result: r }, [r.se.data.buffer, r.se.mask.buffer, ...(r.mm ? [r.mm.data.buffer, r.mm.mask.buffer] : [])]);
          } else if (m.type === 'eye') {
            const e = TD.eye(m.step, m.dt, m.opts);
            self.postMessage({ job: m.job, result: e }, [e.wave.buffer]);
          } else if (m.type === 'crosstalk') {
            self.postMessage({ job: m.job, result: Connector.crosstalk(m.args) });
          }
        } catch (error) { self.postMessage({ job: m.job, error: error.message, missing: error.message === 'missing dataset' }); }
      };`], { type: 'text/javascript' }));
  try { compute.worker = new Worker(compute.url); } catch { compute.failed = true; return null; }
  compute.worker.onmessage = event => {
    const { job, result, error, cancelled, missing } = event.data, pending = compute.jobs.get(job);
    if (!pending) return;
    compute.jobs.delete(job);
    if (cancelled) pending.resolve(null);
    else if (error) pending.reject(Object.assign(new Error(error), { missing }));
    else pending.resolve(result);
  };
  compute.worker.onerror = event => {
    event.preventDefault?.();
    compute.failed = true; compute.worker?.terminate(); compute.worker = null; compute.sent.clear();
    for (const pending of compute.jobs.values()) pending.reject(Object.assign(new Error('Worker-Fehler'), { fallback: true }));
    compute.jobs.clear();
  };
  return compute.worker;
}
function computeCall(message, transfer = []) {
  const worker = computeWorker();
  if (!worker) return null;
  const job = compute.next++;
  return new Promise((resolve, reject) => { compute.jobs.set(job, { resolve, reject }); worker.postMessage({ ...message, job }, transfer); });
}
function computeDataset(dataset) {
  let id = compute.ids.get(dataset);
  if (!id) { id = compute.next++; compute.ids.set(dataset, id); }
  if (!compute.sent.has(id)) {
    // a structured copy: the page keeps its dataset
    compute.worker.postMessage({ type: 'dataset', id, dataset: { n: dataset.n, freq: dataset.freq, samples: dataset.samples, refs: dataset.refs, name: dataset.name } });
    compute.sent.add(id);
    if (compute.sent.size > 3) compute.sent.delete(compute.sent.values().next().value);
  }
  return id;
}
async function networkInWorker(dataset, config, lane, channels) {
  if (!computeWorker()) return undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = computeDataset(dataset);
    try {
      const r = await computeCall({ type: 'network', id, config, lane, channels: channels?.length ? channels : null });
      if (r) compute.stats.worker++;
      return r;
    } catch (error) {
      if (error.missing) { compute.sent.delete(id); continue; }   // dropped from the worker's cache: send again
      if (error.fallback) return undefined;
      throw error;
    }
  }
  return undefined;
}

async function parseFile(file) {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024 && typeof Worker === 'function') {
    try {
      return await parseInWorker(bytes.slice(0), file.name);
    } catch (error) {
      if (!error.fallback) throw error;
    }
  }
  return RF.parseTouchstone(decodeText(bytes), file.name);
}

export { decodeText, rfJob, compute, computeWorker, computeCall, networkInWorker, parseFile };
