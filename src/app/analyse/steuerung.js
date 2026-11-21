// analyse/steuerung – Bedienleiste über dem Diagramm und Auswahllisten der Analyse.
import { $, actionButton, iconButton, insertHtml, pressed, selectField } from '../basis/dom.js';
import { changeHandler, registerChanges, view } from '../basis/erweiterung.js';
import { portName } from '../basis/format.js';
import { state } from '../basis/zustand.js';
import { compareCache, session } from '../dateien/sitzung.js';
import { renderMain } from '../oberflaeche/rahmen.js';

function controlsPairs() {
  const pairs = state.config.pairs;
  if (pairs.length < 2) return '';
  const pairOptions = pairs.map(p => [p.id, 'Paar ' + p.id + ' · ' + portName(p.p) + '/' + portName(p.q)]);
  return selectField('Eingang', 'pair-in', pairOptions, state.pairIn) +
    selectField('Ausgang', 'pair-out', pairOptions, state.pairOut);
}

function renderControls() {
  let html = view(state.tab)?.controls?.() || '';
  const compared = state.compare.ids.filter(id => id !== session.current && compareCache.get(id)?.ctx).length;
  if (compared) {
    html += '<div class="compare-chip"><span>Vergleich · ' + (compared + 1) + ' Dateien</span>' +
      actionButton('Δ zu ⟨A⟩', 'compare-delta', '', 'button', '', pressed(state.compare.delta) + ' title="Differenz zur geöffneten Datei anzeigen"') +
      iconButton('Vergleich beenden', 'compare-clear', '', 'close') + '</div>';
  }
  insertHtml($('view-controls'), html);
}

function choosePair(which, id) {
  const other = which === 'pairIn' ? 'pairOut' : 'pairIn';
  if (state[other] === id) state[other] = state[which];
  state[which] = id;
}

function chooseMode(settings, field, value, distinct) {
  const other = field === 'input' ? 'output' : 'input';
  if (distinct && settings[other] === value) settings[other] = settings[field];
  settings[field] = value;
}

// Auswahllisten mit data-change: die Module melden ihre Listen über registerChanges an.
function handleSelect(select) {
  const entry = changeHandler(select.dataset.change);
  if (!entry) return;
  entry.handler(select.value, select);
  if (entry.rerender) renderMain();
}

registerChanges({
  'pair-in': value => choosePair('pairIn', Number(value)),
  'pair-out': value => choosePair('pairOut', Number(value)),
});

export { controlsPairs, renderControls, chooseMode, handleSelect };
