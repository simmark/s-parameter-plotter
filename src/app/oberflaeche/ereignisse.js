// oberflaeche/ereignisse – Globale Ereignisse: Klicks, Tastatur, Formulare, Ziehen und Ablegen.
import { enterMarker } from '../analyse/marker.js';
import { handleSelect } from '../analyse/steuerung.js';
import { $, openDialog } from '../basis/dom.js';
import { action, formHandler } from '../basis/erweiterung.js';
import { state } from '../basis/zustand.js';
import { flushSettings } from '../dateien/einstellungen.js';
import { ingest } from '../dateien/import.js';
import { sourcesFromDrop } from '../dateien/quellen.js';
import { session, stepSession } from '../dateien/sitzung.js';
import { exportDialog } from './export.js';
import { setTab, setViewMode, tabButtons } from './rahmen.js';
import { renderSidebar } from './seitenleiste.js';

document.addEventListener('click', event => {
  const target = event.target.closest('button[data-action]');
  if (target && !target.disabled) action(target.dataset.action)?.(target.dataset.value, target);
});
document.addEventListener('change', event => {
  const element = event.target;
  if (element.matches('select[data-change]')) handleSelect(element);
  if (element.matches('input[id^="marker-"]')) enterMarker(element);
});

document.addEventListener('submit', event => {
  const handler = formHandler(event.target.id);
  if (!handler) return;
  event.preventDefault();
  handler(event.target);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('input[id^="marker-"]')) {
    event.preventDefault();
    enterMarker(event.target);
    return;
  }
  if (['PageDown', 'PageUp'].includes(event.key) && session.items.length > 1 && !event.target.closest('input, select, textarea, dialog') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    stepSession(event.key === 'PageDown' ? 1 : -1);
    return;
  }
  if (['ArrowLeft', 'ArrowRight'].includes(event.key) && session.items.length > 1 && !event.altKey && !event.ctrlKey && !event.metaKey &&
    !event.target.closest('input, select, textarea, dialog, [role="tab"], summary') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    stepSession(event.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = tabButtons();
  const index = tabs.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
  setTab(tabs[next].dataset.value);
  tabs[next].focus();
});

$('sidebar-button').addEventListener('click', () => { state.collapsed = !state.collapsed; renderSidebar(); });
$('method-button').addEventListener('click', () => openDialog('method-dialog'));
$('export-button').addEventListener('click', exportDialog);
$('dropzone').addEventListener('click', () => action('open-file')());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSettings(); });
window.addEventListener('pagehide', flushSettings);
// In the plot the arrow keys step through the files; Shift + arrow moves the marker.
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.viewMode && !document.querySelector('dialog[open]')) { setViewMode(0); return; }
  if (event.target.id !== 'plot' || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.shiftKey || session.items.length < 2) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  stepSession(event.key === 'ArrowRight' ? 1 : -1);
}, true);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.viewMode > 1) setViewMode(1); });
window.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  $('dropzone').classList.add('is-dragging');
});
window.addEventListener('dragleave', event => {
  if (!event.relatedTarget) $('dropzone').classList.remove('is-dragging');
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  $('dropzone').classList.remove('is-dragging');
  sourcesFromDrop(event.dataTransfer).then(bag => ingest(bag));
});
