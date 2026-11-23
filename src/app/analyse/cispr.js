// analyse/cispr – CISPR-17-Auswertung (Einfügedämpfung) und ihre Diagnose.
import { cache, createComplex, rawTrace, selectedPairs, withUnits } from './daten.js';
import { Z_EVALUATIONS, Z_FORMATS } from './formate.js';
import { getView, modeLabel, modeOptions } from './kurven.js';
import { chooseMode, controlsPairs } from './steuerung.js';
import { esc, help, selectField } from '../basis/dom.js';
import { registerChanges, registerView } from '../basis/erweiterung.js';
import { COLORS } from '../basis/farben.js';
import { display, hz, valueWith } from '../basis/format.js';
import { axis, state } from '../basis/zustand.js';

function modalCispr(pairs) {
  const [a, b] = pairs;
  const view = getView('mm');
  const lookup = new Map(view.modes.map((mode, index) => [mode.key, index]));
  const modes = ['C', 'D'].map(type => ({
    type, a: lookup.get(type + a.id), b: lookup.get(type + b.id)
  }));
  return cache('modal-cispr:' + a.id + ':' + b.id, () => {
    const blocks = modes.map(mode => Array.from(state.dataset.freq, (_, i) => {
      if (!view.samples[i]) return null;
      const two = RF.twoPort(view.samples[i], view.modes, mode.a, mode.b);
      return RF.cispr(two.s, two.ref);
    }));
    const conversion = i => {
      const s = view.samples[i];
      if (!s) return NaN;
      const c = [modes[0].a, modes[0].b], d = [modes[1].a, modes[1].b];
      let max = 0;
      for (const ic of c) {
        for (const id of d) {
          max = Math.max(max, RF.abs(RF.get(s, view.modes.length, ic, id)), RF.abs(RF.get(s, view.modes.length, id, ic)));
        }
      }
      return 20 * Math.log10(max);
    };
    return { blocks, conversion };
  });
}

function diagnosticsTable(items, conversion) {
  const f = state.dataset.freq[state.markers[state.activeMarker]];
  const rows = items.map(({ label, value, showCondition }) => '<tr><td>' + esc(label) + '</td><td>' +
    esc(valueWith(value?.ref, 'Ω')) + '</td><td>' + esc(value ? valueWith(20 * Math.log10(RF.abs(value.t)), 'dB') : '—') +
    '</td><td>' + esc(display(value?.reflectionDelta)) + '</td><td>' + esc(display(value?.transmissionDelta)) + '</td>' +
    (showCondition ? '<td>' + esc(display(value?.condition)) + '</td>' : '') + '</tr>').join('');
  return '<section class="detail-card"><div class="fit-summary"><h3>Symmetrie am Marker</h3><small>' + esc(hz(f)) +
    '</small></div><div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Auswertung</th>' +
    '<th scope="col">Z₀</th><th scope="col">|T|</th><th scope="col">|S₁₁ − S₂₂|</th><th scope="col">|S₂₁ − S₁₂|</th>' +
    (items[0].showCondition ? '<th scope="col">Fixture-Bedingung</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    (conversion === undefined ? '' : '<p class="diagnostics">Max. CM↔DM-Konversion im gewählten Vierport · ' +
      esc(valueWith(conversion, 'dB')) + '</p>') + '</section>';
}

function cisprView() {
  const settings = state.cispr;
  let traces, caption, details;
  const fmt = settings.format;
  if (settings.method === 'four') {
    const pairs = selectedPairs();
    if (!pairs) return { empty: 'Definiere zwei Portpaare als Eingang und Ausgang für CM und DM.', needsPairs: true };
    const modal = modalCispr(pairs);
    const names = ['Z CM', 'Z DM'];
    traces = modal.blocks.map((block, i) => rawTrace('cispr:four:' + i, names[i], COLORS[1 - i],
      cache('cispr:data:' + pairs.map(p => p.id).join(':') + ':' + i, () => createComplex(j => block[j]?.z)), fmt));
    caption = '§ 6.3.1.4 · Paar ' + pairs[0].id + ' → Paar ' + pairs[1].id;
    details = () => {
      const i = state.markers[state.activeMarker];
      const items = modal.blocks.map((block, j) => ({ label: names[j], value: block[i] }));
      return diagnosticsTable(items, modal.conversion(i)) +
        '<p class="note">Die Vierportformel setzt eine hinreichend symmetrische Struktur und Messdaten an den DUT-Referenzebenen voraus. ' + help + '</p>';
    };
  } else {
    const view = getView();
    const a = view.modes.findIndex(m => m.key === settings.input);
    const b = view.modes.findIndex(m => m.key === settings.output);
    const first = view.modes[a];
    if (settings.method === 'one') {
      const key = 'cispr:one:' + state.basis + ':' + a;
      const data = cache(key, () => createComplex(i => view.samples[i] &&
        RF.reflection(RF.get(view.samples[i], view.modes.length, a, a), first.ref)));
      traces = [rawTrace(key, 'Z ' + first.key, COLORS[0], data, fmt)];
      caption = '§ 6.3.1.2 · ' + modeLabel(first);
      details = () => '<p class="note">Eintor-Auswertung aus Reflexion an der DUT-Referenzebene. ' + help + '</p>';
    } else {
      if (a === b || view.modes.length < 2) return { empty: 'Wähle zwei verschiedene aktive Ports oder Moden für den Zweitoraufbau.' };
      const key = ['cispr', state.basis, settings.method, a, b].join(':');
      const blocks = cache(key, () => Array.from(state.dataset.freq, (_, i) => {
        if (!view.samples[i]) return null;
        const result = RF.twoPort(view.samples[i], view.modes, a, b);
        return RF.cispr(result.s, result.ref, settings.method);
      }));
      const label = settings.method === 'series' ? 'Z Serie' : 'Z Shunt';
      traces = [rawTrace(key, label, COLORS[0], cache(key + ':data', () => createComplex(i => blocks[i]?.z)), fmt)];
      caption = '§ 6.3.1.3 · ' + first.key + ' → ' + view.modes[b].key;
      details = () => diagnosticsTable([{ label, value: blocks[state.markers[state.activeMarker]], showCondition: true }]) +
        '<p class="note">Bei geeigneter Fixture sollte die angezeigte Bedingungszahl deutlich kleiner als 1 sein. ' + help + '</p>';
    }
  }
  return { ...withUnits(traces, fmt, 'Ω'), native: 'Ω', format: fmt, title: 'Impedanz nach CISPR 17', caption, details };
}

function cisprControls() {
  const settings = state.cispr;
  return selectField('Auswertung', 'z-eval', Z_EVALUATIONS, 'cispr:' + settings.method) +
    (settings.method === 'four' ? controlsPairs() :
      selectField(settings.method === 'one' ? 'Port / Mode' : 'Eingang', 'cispr-input', modeOptions(), settings.input) +
      (settings.method === 'one' ? '' : selectField('Ausgang', 'cispr-output', modeOptions(), settings.output))) +
    selectField('Darstellung', 'cispr-format', Z_FORMATS, settings.format);
}

registerView({
  id: 'cispr', title: 'CISPR 17', button: 'z', basis: () => state.cispr.method !== 'four', context: 'Indirekte Impedanzauswertung · CISPR 17:2011',
  plot: cisprView, controls: cisprControls, enter: () => { state.zFamily = 'cispr'; },
});

registerChanges({
  'cispr-method': value => { state.cispr.method = value; },
  'cispr-input': value => chooseMode(state.cispr, 'input', value, state.cispr.method !== 'one'),
  'cispr-output': value => chooseMode(state.cispr, 'output', value, state.cispr.method !== 'one'),
  'cispr-format': value => { axis().yRange = null; state.cispr.format = value; },
});

export { modalCispr };
