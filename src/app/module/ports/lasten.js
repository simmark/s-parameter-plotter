// module/ports/lasten – Lasten an den Ports: Art und Werte bearbeiten.
import { refreshNetwork } from '../../analyse/netzwerk.js';
import { $, formError, formErrorHtml, openDialog, textField, toast } from '../../basis/dom.js';
import { registerActions, registerChanges, registerForms } from '../../basis/erweiterung.js';
import { numberValue, portName } from '../../basis/format.js';
import { EDITABLE_LOADS, state } from '../../basis/zustand.js';
import { loadName } from '../../oberflaeche/seitenleiste.js';

function mayTerminate(port) {
  return state.config.loads[port].type !== 'active' || state.config.loads.some((load, i) => i !== port && load.type === 'active');
}

function openLoad(port, type) {
  if (!mayTerminate(port)) {
    toast('Mindestens ein physischer Port muss aktiv bleiben.');
    return;
  }
  const load = state.config.loads[port], d = state.dataset;
  state.dialogLoad = { port, type };
  const displayName = d.portNames[port] ? ' · ' + d.portNames[port] : '';
  $('load-subtitle').textContent = portName(port) + displayName + ' · ' + loadName({ type });
  let fields = textField('R [Ω]', 'r', load.r ?? d.refs[port], '0');
  if (type === 'complex') fields += textField('X [Ω]', 'x', load.x ?? 0, '0');
  if (type === 'series' || type === 'parallel') {
    fields += textField('L [nH]', 'l', load.l ? load.l * 1e9 : 0, '0') +
      textField('C [pF]', 'c', load.c ? load.c * 1e12 : 0, '0');
  }
  $('load-content').innerHTML = '<div class="dialog-grid">' + fields + '</div>' +
    (type === 'series' || type === 'parallel'
      ? '<p class="form-note">0 oder ein leeres Feld lässt das jeweilige Bauteil weg.</p>'
      : type === 'complex' ? '<p class="form-note">X bleibt über den Sweep konstant. Verwende für ein L oder C die RLC-Last.</p>' : '') +
    formErrorHtml;
  openDialog('load-dialog');
}

function applyLoad(form) {
  const { port, type } = state.dialogLoad;
  const data = new FormData(form);
  const read = name => {
    const text = data.get(name)?.trim();
    return text ? numberValue(text) : 0;
  };
  const r = read('r'), x = read('x'), l = read('l'), c = read('c');
  if (![r, x, l, c].every(Number.isFinite) || r < 0 || l < 0 || c < 0) {
    formError(form, 'R, L und C müssen nichtnegative Zahlen sein. X kann ein Vorzeichen haben.');
    return;
  }
  if (!mayTerminate(port)) {
    formError(form, 'Mindestens ein physischer Port muss aktiv bleiben.');
    return;
  }
  state.config.loads[port] = { type, r, x, l: l * 1e-9, c: c * 1e-12 };
  $('load-dialog').close();
  refreshNetwork();
}

function setLoadType(select) {
  const port = Number(select.dataset.port), type = select.value;
  if (type.startsWith('join:')) {
    const to = Number(type.slice(5)), now = state.config.loads[port];
    if (!mayTerminate(port)) {
      select.value = now.type === 'join' ? 'join:' + now.to : now.type;
      toast('Mindestens ein physischer Port muss aktiv bleiben.');
      return;
    }
    // Ports that were tied to this one follow to the common node.
    state.config.loads.forEach(load => { if (load.type === 'join' && load.to === port) load.to = to; });
    state.config.loads[port] = { type: 'join', to };
    refreshNetwork();
    return;
  }
  if (type !== 'active' && !mayTerminate(port)) {
    select.value = state.config.loads[port].type;
    toast('Mindestens ein physischer Port muss aktiv bleiben.');
    return;
  }
  if (EDITABLE_LOADS.includes(type)) {
    select.value = state.config.loads[port].type;
    openLoad(port, type);
  } else {
    state.config.loads[port] = { type };
    refreshNetwork();
  }
}

registerActions({
  'edit-load': value => openLoad(Number(value), state.config.loads[Number(value)].type),
});

registerForms({
  'load-form': applyLoad,
});

registerChanges({ 'load-type': (_, select) => setLoadType(select) }, { rerender: false });
