// module/quelltext/pruefung – Prüft den Entwurf mit dem Touchstone-Parser des RF-Kerns in einem eigenen Worker, mit Rückfall auf die Seite.
import { $ } from '../../basis/dom.js';

// A dedicated worker keeps validation independent from ESB fitting and connector jobs.
let worker = null, workerUrl = null;
function cancelInspection() { worker?.terminate(); worker = null; }

function inspectSource(text, name, receive) {
  cancelInspection();
  const direct = () => receive(RF.inspectSource(text,name));
  if (window.SPA_NO_WORKER || typeof Worker !== 'function') { direct(); return; }
  try {
    workerUrl ??= URL.createObjectURL(new Blob([$('rf-core').textContent,
      '\nself.onmessage = e => self.postMessage(RF.inspectSource(e.data.text,e.data.name));'], {type:'text/javascript'}));
    const task = worker = new Worker(workerUrl);
    task.onmessage = event => { if (worker === task) { cancelInspection(); receive(event.data); } };
    task.onerror = event => { event.preventDefault(); if (worker === task) { cancelInspection(); direct(); } };
    task.postMessage({text,name});
  } catch { cancelInspection(); direct(); }
}

export { cancelInspection, inspectSource };
