// module/vorlagen/batch – Stapelverarbeitung: Vorlagen aus allen Dateien lernen und den Rest erkennen.
import { level, physicsOf, short, templateConflict } from '../../analyse/erkennung.js';
import { $, actionButton, disabled, esc, insertHtml, nextTick, openDialog, toast } from '../../basis/dom.js';
import { registerActions, view } from '../../basis/erweiterung.js';
import { tx } from '../../basis/sprache.js';
import { state } from '../../basis/zustand.js';
import { settingsFromEmbedded } from '../../dateien/einstellungen.js';
import { loadDataset, openItem, session } from '../../dateien/sitzung.js';
import { Templates } from '../../dateien/vorlagen.js';
import { renderPacks } from './packs.js';

async function runBatch() {
  if (batch.running) return;
  const items = session.items.slice();
  Object.assign(batch, { running: true, cancel: false, rows: [], done: 0, total: items.length, pass: 'Lernen' });
  const rowOf = new Map(items.map(item => [item.id, { id: item.id, name: item.name, status: 'wait', detail: '' }]));
  batch.rows = [...rowOf.values()];
  renderBatch();
  const pending = [];
  const leaf = path => String(path || '').split('/').filter(Boolean).pop() || '';
  const step = async () => { batch.done++; if (batch.done % 3 === 0) { renderBatch(); await nextTick(); } };
  for (const item of items) {
    if (batch.cancel) break;
    const row = rowOf.get(item.id);
    try {
      const dataset = await loadDataset(item);
      const ph = physicsOf(dataset);
      row.physics = ph?.status === 'candidate' && ph.verdict.category && ph.verdict.level !== 'unklar' ? short(ph.verdict.category) + ' (' + level(ph.verdict.level) + ')' : ph?.status === 'candidate' ? level('unklar') : '';
      const embedded = settingsFromEmbedded(dataset);
      if (embedded && embedded.config.pairs.length) {
        const name = embedded.profileName || leaf(item.path) || dataset.n + '-Port';
        Templates.learn(name, dataset, embedded.config, { tab: 's', basis: 'mm', sFormat: embedded.sFormat || 'db', sKeys: { mm: embedded.sKeys?.mm ?? null } });
        Object.assign(row, { status: 'learned', detail: name + ' · ' + dataset.n + ' Ports' });
      } else pending.push(item);
    } catch (error) { Object.assign(row, { status: 'error', detail: error.message }); }
    await step();
  }
  batch.pass = 'Erkennen'; batch.done = 0; batch.total = pending.length;
  for (const item of pending) {
    if (batch.cancel) break;
    const row = rowOf.get(item.id);
    try {
      const dataset = await loadDataset(item);
      const matches = await Templates.match(dataset, () => !batch.cancel);
      const conflict = matches[0] && matches[0].score <= Templates.AUTO ? templateConflict(matches[0].tpl, physicsOf(dataset)) : null;
      if (matches[0] && matches[0].score <= Templates.AUTO && !conflict) Object.assign(row, { status: 'known', detail: matches[0].tpl.name + ' · ' + Templates.similarity(matches[0].score) + ' %' });
      else Object.assign(row, { status: 'unknown', detail: dataset.n + ' Ports' + (conflict ? tx(' · Vorlage ' + matches[0].tpl.name + ' gesperrt', ' · template ' + matches[0].tpl.name + ' blocked') : '') });
    } catch (error) { Object.assign(row, { status: 'error', detail: error.message }); }
    await step();
  }
  batch.running = false;
  renderBatch();
  if ($('pack-dialog').open) renderPacks();
  if (state.dataset) view('ports')?.render(); // the template list lives in the ports panel
  toast(batch.cancel ? 'Stapel abgebrochen.' : 'Stapel fertig: ' + batch.rows.filter(r => r.status === 'learned').length + ' gelernt · ' + batch.rows.filter(r => r.status === 'known').length + ' erkannt.');
}

function renderBatch() {
  const box = $('batch-content');
  if (!box) return;
  const count = key => batch.rows.filter(r => r.status === key).length;
  const items = session.items.length;
  const rows = batch.rows.slice(0, 300).map(r => '<li class="batch-row is-' + r.status + '"><button type="button" class="batch-open" data-action="batch-file" data-value="' + esc(r.id) + '">' +
    '<span class="batch-state">' + esc(BATCH_LABEL[r.status] || r.status) + '</span><span class="batch-name">' + esc(r.name) + '</span><small>' + esc(r.detail + (r.physics ? tx(' · Physik: ', ' · physics: ') + r.physics : '')) + '</small></button></li>').join('');
  insertHtml(box,
    '<p class="note">Dateien mit gespeichertem Port-Profil (Paare, Abschlüsse, Bauteiltyp) liefern Fingerabdrücke. Alle anderen werden damit verglichen und, wenn sie passen, automatisch zugeordnet. ' +
    'Dateien ohne Profil und ohne passende Vorlage bleiben „Unbekannt“: Ordne bei einer davon die Ports zu und lerne sie als Vorlage, danach werden ähnliche erkannt.</p>' +
    '<div class="pack-actions">' + (batch.running ? actionButton('Abbrechen', 'batch-cancel', '', 'button') : actionButton(batch.rows.length ? 'Erneut starten' : items + ' Dateien analysieren', 'batch-run', '', 'button primary', 'network', disabled(items < 1))) +
    '<span class="batch-progress mono">' + (batch.running ? esc(batch.pass) + ' ' + batch.done + ' / ' + batch.total : batch.rows.length ? batch.rows.length + ' Dateien' : '') + '</span></div>' +
    (batch.rows.length ? '<p class="batch-summary">' + count('learned') + ' Fingerabdrücke gelernt · ' + count('known') + ' erkannt · ' + count('unknown') + ' unbekannt' +
      (count('error') ? ' · ' + count('error') + ' Fehler' : '') + '</p><ul class="batch-list">' + rows + '</ul>' : ''));
}

function openBatch() { renderBatch(); openDialog('batch-dialog'); }

const BATCH_LABEL = { learned: 'Gelernt', known: 'Erkannt', unknown: 'Unbekannt', error: 'Fehler', wait: 'Wartet' };

// ---- Batch: learn fingerprints from every profiled file of the loaded set, then recognise the rest with them. ----
const batch = { running: false, cancel: false, rows: [], done: 0, total: 0, pass: '' };

registerActions({
  'batch-open': () => { $('pack-dialog').open && $('pack-dialog').close(); openBatch(); },
  'batch-run': runBatch,
  'batch-cancel': () => { batch.cancel = true; },
  'batch-file': value => { $('batch-dialog').close(); openItem(value, { keepTab: true }); },
});
