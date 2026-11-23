// dateien/sitzungsliste – Dateiliste der Sitzung und Speicherhinweis.
import { $, actionButton, checked, disabled, esc, iconButton, insertHtml, pressed } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { state } from '../basis/zustand.js';
import { renderShelf } from './bibliothek.js';
import { FILE_COLORS, session } from './sitzung.js';

function compareLetter(id) {
  const ids = state.compare.ids.filter(other => other !== session.current);
  if (!ids.length) return '';
  if (id === session.current) return 'A';
  const index = ids.indexOf(id);
  return index < 0 ? '' : 'BCDEFGH'[index];
}

// Storage notices: no durable storage, interrupted imports, results of the one-time migration.
function renderStorageNotice() {
  const box = $('storage-notice'), parts = [];
  const real = session.items.length > 0;
  if (!Store.persistent()) {
    parts.push('<p class="inline-notice" id="notice-volatile"><span>' + (Store.info.blocked
      ? 'Die Datenbank wird von einem anderen Tab mit einer älteren Version blockiert. Schließe die anderen Tabs der App und lade neu. Bis dahin wird nichts dauerhaft gespeichert.'
      : 'Dieser Browser erlaubt hier keinen dauerhaften Speicher (z. B. privater Modus). Geladene Dateien gehen beim Neuladen verloren.') + '</span></p>');
  } else if (real && session.items.some(item => item.volatile)) {
    parts.push('<p class="inline-notice" id="notice-volatile"><span>Ein Teil der Dateien ist nicht dauerhaft gespeichert und geht beim Neuladen verloren.</span></p>');
  }
  for (const note of session.notices) {
    parts.push('<p class="inline-notice' + (note.neutral ? ' neutral' : '') + '" data-notice="' + esc(note.id) + '"><span>' + esc(note.text) + '</span>' +
      actionButton('Verstanden', 'notice-dismiss', note.id, 'quiet-button') + '</p>');
  }
  box.hidden = !parts.length;
  insertHtml(box, parts.join(''));
}

function dismissNotice(id) {
  const note = session.notices.find(item => item.id === id);
  session.notices = session.notices.filter(item => item.id !== id);
  if (note?.importId) Store.dismissImport(note.importId).catch(() => {});
  renderStorageNotice();
}

function renderSession() {
  const items = session.items, box = $('session-files');
  const index = items.findIndex(item => item.id === session.current);
  $('file-nav').hidden = items.length < 2;
  $('file-nav-count').textContent = (index + 1) + '/' + items.length;
  $('file-pager').hidden = items.length < 2;
  $('file-pager-count').textContent = (index + 1) + ' / ' + items.length;
  $('file-pager-name').textContent = items[index]?.name || '';
  document.querySelectorAll('[data-action="session-step"]').forEach(button => {
    button.disabled = button.dataset.value === '-1' ? index <= 0 : index < 0 || index >= items.length - 1;
  });
  const current = items[index];
  const sibling = items.length === 1 && current?.handle && window.showDirectoryPicker;
  box.hidden = !items.length;
  box.dataset.count = String(items.length);
  box.dataset.current = current?.key ?? '';
  if (box.hidden) { box.innerHTML = ''; return; }
  const filter = session.filter.trim().toLowerCase();
  const shown = filter ? items.filter(item => item.key.toLowerCase().includes(filter)) : items;
  const volatile = items.filter(item => item.volatile).length;
  const top = box.querySelector('.session-list')?.scrollTop ?? null;
  let folder = null;
  const rows = shown.slice(0, 300).map(item => {
    const letter = compareLetter(item.id), k = 'BCDEFGH'.indexOf(letter);
    const head = item.path !== folder ? '<div class="session-folder" title="' + esc(item.path) + '">' + esc(item.path || 'Einzelne Dateien') + '</div>' : '';
    folder = item.path;
    return head + '<div class="session-row' + (item.id === session.current ? ' is-current' : '') + (item.error ? ' has-error' : '') + (session.selecting ? ' is-selecting' : '') + '"' +
      (k >= 0 ? ' style="--fc:' + FILE_COLORS[k % FILE_COLORS.length] + '"' : '') + '>' +
      (session.selecting ? '<label class="session-pick" title="Auswählen"><input type="checkbox" value="' + item.id + '" aria-label="' + esc(item.name) + ' auswählen"' + checked(session.picked.has(item.id)) + '></label>' : '') +
      '<button type="button" class="session-open" id="session-' + item.id + '" data-action="session-open" data-value="' + item.id + '" data-key="' + esc(item.key) + '" title="' + esc(item.error || item.key) + '">' +
      '<span>' + esc(item.name) + '</span>' + (item.ports ? '<small>' + item.ports + 'P</small>' : '') + '</button>' +
      '<button type="button" class="session-compare" data-action="session-compare" data-value="' + item.id + '"' + pressed(!!letter) +
      ' title="Im Diagramm vergleichen" aria-label="' + esc(item.name) + ' vergleichen">' + (letter || '+') + '</button></div>';
  }).join('');
  insertHtml(box, '<h4>Aktuelle Sitzung <small>' + items.length + '</small><span class="session-tools">' +
    (items.length > 1 ? iconButton('Vorherige Datei (Bild↑)', 'session-step', -1, 'chevron', ' data-flip' + disabled(index <= 0)) +
      iconButton('Nächste Datei (Bild↓)', 'session-step', 1, 'chevron', disabled(index >= items.length - 1)) +
      actionButton('Stapel', 'batch-open', '', 'quiet-button', '', ' title="Alle Dateien analysieren und Fingerabdrücke lernen"') +
      actionButton(session.selecting ? 'Fertig' : 'Auswählen', 'session-select', '', 'quiet-button', '', ' title="Mehrere Dateien für die Bibliothek auswählen"' + pressed(session.selecting)) +
      actionButton('Leeren', 'session-clear', '', 'quiet-button', '', ' title="Alle anderen Dateien aus der Sitzung entfernen. Die Bibliothek bleibt unverändert."') : '') + '</span></h4>' +
    '<p class="session-state' + (volatile ? ' is-volatile' : '') + '" id="session-state" data-saved="' + (volatile ? '0' : '1') + '">' +
    (volatile ? 'Nur im Arbeitsspeicher · geht beim Neuladen verloren' : 'Dauerhaft gespeichert · bleibt nach dem Neuladen erhalten') + '</p>' +
    (items.length > 8 ? '<input id="session-filter" class="field-input session-filter" type="search" placeholder="Filtern …" aria-label="Dateien filtern" value="' + esc(session.filter) + '">' : '') +
    '<div class="session-list">' + rows + '</div>' +
    (shown.length > 300 ? '<p class="note">+' + (shown.length - 300) + ' weitere · Filter nutzen</p>' : '') +
    (!shown.length ? '<p class="note">Kein Treffer.</p>' : '') +
    (sibling ? actionButton('Nachbardateien aus dem Ordner laden', 'open-siblings', '', 'quiet-button', 'network') : ''));
  // Keep the scroll position of the list; only bring the open file into view inside the list, never scroll the page.
  const list = box.querySelector('.session-list'), row = list?.querySelector('.is-current');
  if (list && top !== null) list.scrollTop = top;
  if (list && row) {
    const a = row.offsetTop - list.offsetTop, b = a + row.offsetHeight;
    if (a < list.scrollTop) list.scrollTop = a;
    else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight;
  }
}

registerActions({
  'session-select': () => { session.selecting = !session.selecting; if (!session.selecting) session.picked.clear(); renderSession(); renderShelf(); },
  'notice-dismiss': dismissNotice,
});

document.addEventListener('input', event => {
  if (event.target.id !== 'session-filter') return;
  session.filter = event.target.value;
  renderSession();
});

export { compareLetter, renderStorageNotice, renderSession };
