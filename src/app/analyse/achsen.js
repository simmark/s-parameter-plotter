// analyse/achsen – Achsen: Skala, Bereich und Achsendialog.
import { renderAnalysis } from './darstellung.js';
import { $, formError, formErrorHtml, openDialog, options, textField } from '../basis/dom.js';
import { registerActions, registerForms } from '../basis/erweiterung.js';
import { freqInput, numberValue, parseHz } from '../basis/format.js';
import { axis, effectiveY, state, yScales } from '../basis/zustand.js';

function setYScale(value) {
  const a = axis();
  if (a.y === value) return;
  a.y = value;
  a.yRange = null;
  renderAnalysis();
}

function openAxes() {
  const a = axis();
  $('axes-content').innerHTML =
    '<div class="axis-group"><h3>Frequenzachse</h3>' +
    '<label class="control"><span>Skala</span><select name="x-scale">' +
    options(state.dataset.freq.at(-1) > 0 ? [['log', 'Logarithmisch'], ['linear', 'Linear']] : [['linear', 'Linear']], a.x) +
    '</select></label><div class="dialog-grid">' +
    textField('Von', 'x-start', a.xRange ? freqInput(a.xRange[0]) : '', 'Automatisch') +
    textField('Bis', 'x-stop', a.xRange ? freqInput(a.xRange[1]) : '', 'Automatisch') +
    '</div></div><div class="axis-group"><h3>Vertikale Achse</h3>' +
    '<label class="control"><span>Skala</span><select name="y-scale">' +
    options(yScales().map(key => [key, { linear: 'Linear', log: 'Logarithmisch · positive Werte', symlog: 'Symmetrisch logarithmisch · mit Vorzeichen' }[key]]), effectiveY()) +
    '</select></label><div class="dialog-grid">' +
    textField('Minimum ' + (state.view.unit ? '[' + state.view.unit + ']' : ''), 'y-start', a.yRange?.[0] ?? '', 'Automatisch') +
    textField('Maximum ' + (state.view.unit ? '[' + state.view.unit + ']' : ''), 'y-stop', a.yRange?.[1] ?? '', 'Automatisch') +
    '</div></div><p class="form-note">Leere Grenzwerte verwenden die automatische Skalierung. Frequenzen akzeptieren z. B. 20 MHz. Mit der Maus: Mausrad oder Ziehen auf der Y-Skala zoomt und verschiebt die vertikale Achse, Doppelklick dort setzt sie zurück. Am Touchscreen: Y-Skala links ziehen, zwei Finger übereinander zoomen, Doppeltippen auf die Skala setzt zurück.</p>' + formErrorHtml;
  openDialog('axes-dialog');
}

function applyAxes(form) {
  const data = new FormData(form), x = data.get('x-scale'), y = data.get('y-scale');
  const xa = data.get('x-start').trim(), xb = data.get('x-stop').trim();
  const ya = data.get('y-start').trim(), yb = data.get('y-stop').trim();
  const fs = state.dataset.freq;
  const min = x === 'log' && fs[0] === 0 ? fs[1] : fs[0], max = fs.at(-1);
  const xr = xa || xb ? [xa ? parseHz(xa) : min, xb ? parseHz(xb) : max] : null;
  const yr = ya || yb ? [numberValue(ya), numberValue(yb)] : null;
  if (xr && (!xr.every(Number.isFinite) || !(xr[1] > xr[0]) || xr[0] < 0 || (x === 'log' && xr[0] <= 0))) {
    formError(form, 'Gib einen aufsteigenden Frequenzbereich ein. Bei Log-Skalierung muss die untere Grenze positiv sein.');
    return;
  }
  if (yr && (!yr.every(Number.isFinite) || !(yr[1] > yr[0]) || (y === 'log' && yr[0] <= 0))) {
    formError(form, 'Gib zwei aufsteigende Y-Grenzen ein. Bei Log-Skalierung müssen beide positiv sein.');
    return;
  }
  Object.assign(axis(), { x, xRange: xr, y, yRange: yr });
  $('axes-dialog').close();
  renderAnalysis();
}

function setXScale(value) {
  const a = axis();
  if (a.x === value) return;
  a.x = value;
  if (value === 'log' && a.xRange?.[0] <= 0) a.xRange = null;
  renderAnalysis();
}

function resetPlot() {
  Object.assign(axis(), { xRange: null, yRange: null });
  renderAnalysis();
}

registerActions({
  'x-scale': setXScale,
  'y-scale': setYScale,
  axes: openAxes,
  'reset-plot': resetPlot,
});

registerForms({
  'axes-form': applyAxes,
});
