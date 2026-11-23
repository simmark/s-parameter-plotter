// analyse/kurvenwahl – Kurvenmatrix: Kurven gezielt auswählen.
import { renderAnalysis } from './darstellung.js';
import { currentModes, deviceType, modeLabel, rememberCurves, traceKey, traceLabel } from './kurven.js';
import { $, actionButton, esc, insertHtml, openDialog, pressed, toast } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { MODE_COLOR, traceFamily } from '../basis/farben.js';
import { MAX_TRACES, state } from '../basis/zustand.js';

function renderMatrix() {
  const modes = currentModes();
  const modalCount = modes.filter(mode => mode.type !== 'P').length;
  const selected = state.sKeys[state.basis];
  const blockStart = i => i > 0 && modes[i].type !== modes[i - 1].type ? ' class="block-start"' : '';
  const familyName = {
    dd: 'Differential → Differential', cc: 'Gleichtakt → Gleichtakt',
    dc: 'Konversion Gleichtakt → Differential (Störfestigkeit)', cd: 'Konversion Differential → Gleichtakt (Abstrahlung)',
    p: 'mit Einzelport', se: 'Single Ended'
  };
  const tag = mode => '<span class="mode-tag" style="--c:' + MODE_COLOR[mode.type] + '">' + esc(mode.key) + '</span>';
  const cells = modes.map((row, i) => '<tr' + blockStart(i) + '><th scope="row" title="' + esc(modeLabel(row)) + '">' + tag(row) + '</th>' +
    modes.map((col, j) => {
      const key = traceKey(row, col), label = traceLabel(row, col), family = traceFamily(row, col);
      return '<td' + blockStart(j) + '><button class="matrix-cell fam-' + family + (i === j ? ' is-reflection' : '') + '" type="button" id="matrix-' + i + '-' + j +
        '" data-action="select-curve" data-value="' + esc(key) + '"' + pressed(selected.includes(key)) +
        ' title="' + esc(row.key + ' ← ' + col.key + ' · ' + familyName[family] + (i === j ? ' · Reflexion' : ' · Transmission')) + '">' +
        esc(label) + '</button></td>';
    }).join('') + '</tr>').join('');
  const legend = state.basis === 'mm'
    ? '<div class="mode-legend matrix-legend"><span><i style="--c:var(--mode-d)"></i>DD Differential</span><span><i style="--c:var(--mode-c)"></i>CC Gleichtakt</span>' +
      '<span><i style="--c:var(--mode-dc)"></i>Sdc C→D · Störfestigkeit</span><span><i style="--c:var(--mode-cd)"></i>Scd D→C · Abstrahlung</span>' + (modes.some(m => m.type === 'P') ? '<span><i style="--c:var(--mode-p)"></i>Einzelport</span>' : '') +
      '<span>Zeile = Antwort · Spalte = Anregung · Diagonale = Reflexion</span></div>' : '';
  const content = $('matrix-content');
  const previous = content.querySelector('.matrix-scroll');
  const position = previous ? [previous.scrollLeft, previous.scrollTop] : [0, 0];
  insertHtml(content, '<div class="matrix-actions">' +
    actionButton('Standard', 'curve-preset', 'default') + (['cmc', 'lan'].includes(deviceType()) && state.basis === 'mm' ? actionButton('Erweitert', 'curve-preset', 'ext') : '') + actionButton('Übertragung', 'curve-preset', 'through') +
    actionButton('Reflexion', 'curve-preset', 'reflect') +
    (state.basis === 'mm' ? actionButton('Modenkonversion', 'curve-preset', 'convert') : '') +
    (modes.length ** 2 <= MAX_TRACES ? actionButton('Alle ' + modes.length ** 2, 'curve-preset', 'all') : '') +
    (modalCount === 4 && modes.length > 4 ? actionButton('16 Mixed Mode', 'curve-preset', 'modal-all') : '') +
    actionButton('Leeren', 'curve-preset', 'clear') + '</div>' + legend + '<div class="matrix-scroll">' +
    '<table class="matrix-table"><thead><tr><th scope="col">↓ / →</th>' +
    modes.map((mode, j) => '<th scope="col"' + blockStart(j) + ' title="' + esc(modeLabel(mode)) + '">' + tag(mode) + '</th>').join('') +
    '</tr></thead><tbody>' + cells + '</tbody></table></div><p class="matrix-meta">' + selected.length + ' / ' + MAX_TRACES + ' Kurven ausgewählt</p>');
  content.querySelector('.matrix-scroll').scrollTo(...position);
}

function pickCurves() {
  renderMatrix();
  openDialog('matrix-dialog');
}

function selectCurve(key) {
  const selected = state.sKeys[state.basis];
  if (selected.includes(key)) {
    state.sKeys[state.basis] = selected.filter(entry => entry !== key);
  } else if (selected.length < MAX_TRACES) {
    selected.push(key);
    state.hiddenTraces.delete('s:' + state.basis + ':' + key);
  } else {
    toast('Es sind bereits ' + MAX_TRACES + ' Kurven ausgewählt.');
    return;
  }
  rememberCurves();
  renderMatrix();
  renderAnalysis();
}

registerActions({
  matrix: pickCurves,
  'select-curve': selectCurve,
});

export { renderMatrix };
