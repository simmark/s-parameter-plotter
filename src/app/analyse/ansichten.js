// analyse/ansichten – Ansichten S-Parameter, Smith-Chart und Impedanz.
import { cache, createComplex, extractS, rawTrace, withUnits } from './daten.js';
import { S_FORMATS, Z_EVALUATIONS, Z_FORMATS } from './formate.js';
import { getView, modeLabel, modeOptions, traceLabel } from './kurven.js';
import { chooseMode } from './steuerung.js';
import { actionButton, esc, help, selectField } from '../basis/dom.js';
import { registerChanges, registerView } from '../basis/erweiterung.js';
import { COLORS, MODE_PALETTE, REFLECTION_DASH, traceFamily } from '../basis/farben.js';
import { display, portName } from '../basis/format.js';
import { axis, state } from '../basis/zustand.js';
import { loadName } from '../oberflaeche/seitenleiste.js';

function sView() {
  const view = getView();
  const indexes = new Map(view.modes.map((mode, i) => [mode.key, i]));
  const used = {};
  const traces = state.sKeys[state.basis].map((key, i) => {
    const [row, col] = key.split(':').map(k => indexes.get(k));
    const data = extractS(view, row, col);
    const r = view.modes[row], c = view.modes[col];
    const family = traceFamily(r, c);
    const ramp = MODE_PALETTE[family];
    const color = ramp ? ramp[(used[family] = (used[family] ?? -1) + 1) % ramp.length] : COLORS[i];
    const trace = rawTrace('s:' + state.basis + ':' + key, traceLabel(r, c), color, data, state.sFormat);
    trace.family = family;
    trace.dash = row === col ? REFLECTION_DASH : null;
    return trace;
  });
  return {
    ...withUnits(traces, state.sFormat), title: 'Frequenzgang', caption: 'Zeile = Antwort · Spalte = Anregung',
    format: state.sFormat, floor: state.sFormat === 'db' ? -180 : null, native: '',
    hint: state.sFormat === 'db' ? 'Darstellungsgrenze −180 dB' : ''
  };
}

function smithView() {
  const view = getView(), i = view.modes.findIndex(m => m.key === state.smith);
  const mode = view.modes[i];
  const data = extractS(view, i, i);
  const trace = rawTrace('smith:' + mode.key, traceLabel(mode, mode), mode.type === 'C' ? MODE_PALETTE.cc[0] : mode.type === 'D' ? MODE_PALETTE.dd[0] : COLORS[0], data, 'mag');
  return {
    traces: [trace], title: 'Smith-Diagramm', caption: 'Normierung · ' + modeLabel(mode),
    format: 'mag', unit: '', native: '', smith: true, smithRef: mode.ref
  };
}

function zView() {
  const settings = state.z, view = getView();
  const a = view.modes.findIndex(m => m.key === settings.input), b = view.modes.findIndex(m => m.key === settings.output);
  const mode = view.modes[a];
  const key = ['z', state.basis, settings.method, a, b].join(':');
  const modePair = settings.method.startsWith('tx');
  if (modePair && (a === b || view.modes.length < 2)) return { empty: 'Für die Transmissionsimpedanz werden zwei verschiedene aktive Ports oder Moden benötigt.' };
  const native = settings.method === 'ymatrix' ? 'S' : 'Ω';
  const data = cache(key, () => createComplex(i => {
    const s = view.samples[i];
    if (!s) return null;
    if (settings.method === 'reflection') return RF.reflection(RF.get(s, view.modes.length, a, a), mode.ref);
    if (modePair) {
      const result = RF.twoPort(s, view.modes, a, b);
      return result.s && RF.transmission(RF.get(result.s, 2, 1, 0), result.ref, settings.method === 'txseries' ? 'series' : 'shunt');
    }
    const m = RF.toZY(s, view.modes.map(x => x.ref), settings.method === 'zmatrix' ? 'Z' : 'Y');
    return m && RF.get(m, view.modes.length, b, a);
  }));
  let label, caption, note;
  if (settings.method === 'reflection') {
    label = 'Zin ' + mode.key;
    caption = 'Reflexion an ' + modeLabel(mode);
    note = 'Übrige aktive Ports und Moden sind mit ihren jeweiligen Bezugsimpedanzen abgeschlossen.';
  } else if (modePair) {
    const r1 = mode.ref, r2 = view.modes[b].ref;
    const ref = r1 === r2 ? r1 : Math.sqrt(r1) * Math.sqrt(r2);
    label = settings.method === 'txseries' ? 'Z Serie' : 'Z Shunt';
    caption = mode.key + ' → ' + view.modes[b].key + ' · Z₀ ' + display(ref) + ' Ω';
    note = 'Diese Transmissionsformel gilt für die gewählte reine Serien- oder Shunt-Fixture. Übrige aktive Ports und Moden sind angepasst.';
    if (mode.type !== view.modes[b].type) note += ' Die beiden ausgewählten Kanäle haben unterschiedliche Moden.';
  } else {
    label = traceLabel(view.modes[b], mode, native === 'S' ? 'Y' : 'Z');
    caption = mode.key + ' → ' + view.modes[b].key;
    note = native === 'S'
      ? 'Die Y-Matrix gibt die Kurzschluss-Admittanzen des bereits mit den konfigurierten Lasten reduzierten Netzwerks an.'
      : 'Die Z-Matrix gibt die Leerlaufimpedanzen des bereits mit den konfigurierten Lasten reduzierten Netzwerks an.';
  }
  const trace = rawTrace(key, label, COLORS[0], data, settings.format);
  return {
    ...withUnits([trace], settings.format, native), native, title: native === 'S' ? 'Admittanz' : 'Impedanzverlauf',
    caption, format: settings.format, details: () => '<p class="note">' + esc(note) + ' ' + help + '</p>'
  };
}

function zControls() {
  const settings = state.z;
  const matrixMethod = ['zmatrix', 'ymatrix'].includes(settings.method);
  const formats = settings.method === 'ymatrix' ? Z_FORMATS.slice(0, 4) : Z_FORMATS;
  return selectField('Auswertung', 'z-eval', Z_EVALUATIONS, 'z:' + settings.method) +
    selectField(settings.method === 'reflection' ? 'Port / Mode' : matrixMethod ? 'Anregung' : 'Eingang', 'z-input', modeOptions(), settings.input) +
    (settings.method !== 'reflection' ? selectField(matrixMethod ? 'Antwort' : 'Ausgang', 'z-output', modeOptions(), settings.output) : '') +
    selectField('Darstellung', 'z-format', formats, settings.format);
}

// "Ports & Lasten" text of the S view: pairs, triples and taps of the profile.
function sContext() {
  const active = state.layout.active.length;
  return state.basis === 'mm'
    ? state.config.pairs.length + ' Paare · ' + (state.config.triples?.length ? state.config.triples.length + ' Dreileitergruppen · ' : '') + active + ' aktive Ports' +
      (state.dataset.profile ? ' · ' + state.dataset.profile.taps.map(tap =>
        portName(tap) + ' ' + loadName(state.config.loads[tap])).join(' / ') : '')
    : state.dataset.n + ' physische Ports · ' + active + ' aktiv';
}

registerView({
  id: 's', title: 'S-Parameter', basis: () => true, context: sContext, plot: sView,
  controls: () => selectField('Darstellung', 's-format', S_FORMATS, state.sFormat) + actionButton('Ports zuordnen', 'tab', 'ports', 'button', 'network'),
});
registerView({
  id: 'smith', title: 'Smith-Chart', basis: () => true, context: 'Komplexe Reflexion · normiert auf die gewählte Portreferenz', plot: smithView,
  controls: () => selectField('Reflexion an', 'smith-port', modeOptions(), state.smith),
});
// "z" and "cispr" are two evaluation families inside the one main tab "Z"; the tab reopens the family used last.
registerView({
  id: 'z', title: 'Impedanz', basis: () => true, context: 'Eingangs-, Transfer- und Fixture-Impedanz', plot: zView, controls: zControls,
  enter: () => { if (state.zFamily === 'cispr') return 'cispr'; state.zFamily = 'z'; },
});

registerChanges({
  's-format': value => { axis().yRange = null; state.sFormat = value; },
  'smith-port': value => { state.smith = value; },
  'z-eval': value => {
    const [family, method] = value.split(':');
    if (family === 'cispr') state.cispr.method = method;
    else {
      state.z.method = method;
      if (method === 'ymatrix' && !Z_FORMATS.slice(0, 4).some(([f]) => f === state.z.format)) state.z.format = 'mag';
    }
    state.tab = state.zFamily = family;
    axis().yRange = null;
  },
  'z-method': value => {
    state.z.method = value;
    if (value === 'ymatrix' && !Z_FORMATS.slice(0, 4).some(([f]) => f === state.z.format)) state.z.format = 'mag';
    axis().yRange = null;
  },
  'z-input': value => chooseMode(state.z, 'input', value, state.z.method.startsWith('tx')),
  'z-output': value => chooseMode(state.z, 'output', value, state.z.method.startsWith('tx')),
  'z-format': value => { axis().yRange = null; state.z.format = value; },
});
