// module/ports/portprofil – Port-Profil: in der Datei speichern, als Vorlage lernen, wiedererkennen.
import { detectModel } from '../../analyse/erkennung.js';
import { initDataset } from '../../analyse/netzwerk.js';
import { $, toast } from '../../basis/dom.js';
import { registerActions, registerForms } from '../../basis/erweiterung.js';
import { decodeText } from '../../basis/rechnen.js';
import { state } from '../../basis/zustand.js';
import { snapshotSettings } from '../../dateien/einstellungen.js';
import { blankProfile, configKey, session, sessionItem } from '../../dateien/sitzung.js';
import { spiceStore } from '../../dateien/spice.js';
import { Templates } from '../../dateien/vorlagen.js';
import { renderConfig } from './ports.js';
import { saveBlob } from '../../oberflaeche/export.js';
import { render } from '../../oberflaeche/rahmen.js';

// ---- Port profile: store in the file, learn as template, recognise in other files. ----
function currentProfile() {
  const fs = state.dataset.freq;
  return {
    name: state.profile.name, pairs: state.config.pairs, loads: state.config.loads, ref: state.config.ref,
    tab: ['ports', 'connector'].includes(state.tab) ? 's' : state.tab, basis: state.basis, sFormat: state.sFormat, sKeys: state.sKeys,
    markers: state.markers.filter(i => i !== null).map(i => fs[i])
  };
}

function defaultProfileName() {
  let type = '';
  try { type = state.config.pairs.length >= 2 ? detectModel().type : ''; } catch { type = ''; }
  return type === 'transformer' ? 'Übertrager' : type === 'cmc' ? 'CMC' : state.dataset.n + '-Port';
}

function learnTemplate(silent = false) {
  const name = ($('profile-name')?.value ?? state.profile.name).trim() || defaultProfileName();
  try {
    Templates.learn(name, state.dataset, state.config, { tab: ['ports', 'connector'].includes(state.tab) ? 's' : state.tab, basis: state.basis, sFormat: state.sFormat, sKeys: state.sKeys });
  } catch (error) {
    toast(error.message);
    return false;
  }
  state.profile.name = name;
  if (!silent) {
    toast('Vorlage „' + name + '“ gelernt. Ähnliche ' + state.dataset.n + '-Port-Dateien werden künftig automatisch zugeordnet.');
    renderConfig();
  }
  return true;
}

async function findTemplates() {
  const dataset = state.dataset;
  const matches = await Templates.match(dataset);
  if (dataset !== state.dataset) return;
  state.profile.matches = matches;
  if (!matches.length) toast(Templates.size ? 'Keine gelernte Vorlage passt zu dieser Portzahl und diesem Frequenzbereich.' : 'Es gibt noch keine gelernten Vorlagen.');
  renderConfig();
}

function applyTemplate(index) {
  const match = state.profile.matches[Number(index)];
  if (!match) return;
  const matches = state.profile.matches;
  state.profile = { ...blankProfile(), source: 'template', name: match.tpl.name, score: match.score, matches };
  initDataset(state.dataset, Templates.settings(match, state.dataset.n));
  state.profile.key = configKey();
  toast('Vorlage „' + match.tpl.name + '“ angewendet · ' + Templates.similarity(match.score) + ' %');
}

async function saveProfile(form) {
  const item = sessionItem(session.current);
  if (!item || state.dataset.demo) {
    toast('Öffne zuerst eine Touchstone-Datei.');
    return;
  }
  state.profile.name = String(new FormData(form).get('name') || '').trim().slice(0, 60);
  if (state.dataset.spice) {
    // A model has no measurement file to annotate: the configuration is kept on this device and learned as a template.
    const store = spiceStore(), key = state.dataset.spice.lib + '|' + state.dataset.spice.sub;
    delete store[key];
    store[key] = snapshotSettings();
    for (const old of Object.keys(store).slice(0, -300)) delete store[old];
    try { localStorage.setItem('spa-spice', JSON.stringify(store)); } catch { /* storage full */ }
    const learned = !!state.profile.name && learnTemplate(true);
    state.profile.source = 'local';
    state.profile.key = configKey();
    toast('Konfiguration für ' + state.dataset.name + ' gespeichert.' + (learned ? ' Vorlage „' + state.profile.name + '“ gelernt.' : ''));
    render();
    return;
  }
  try {
    const source = await item.getFile();
    const text = RF.annotate(decodeText(await source.arrayBuffer()), RF.profileLines(currentProfile()));
    const check = RF.parseTouchstone(text, item.name);
    if (!check.embedded || check.freq.length !== state.dataset.freq.length) throw new Error('Die Prüfung der neuen Datei ist fehlgeschlagen.');
    let inPlace = false;
    if (item.handle?.createWritable) {
      try {
        if (!item.handle.requestPermission || await item.handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
          const writer = await item.handle.createWritable();
          await writer.write(text);
          await writer.close();
          inPlace = true;
        }
      } catch { inPlace = false; }
    }
    const file = new File([text], item.name, { type: 'text/plain' });
    if (!inPlace) saveBlob(file, item.name);
    if (!item.handle || !inPlace) item.getFile = async () => file;
    item.size = file.size;
    state.dataset.embedded = check.embedded;
    state.profile.source = 'file';
    state.profile.key = configKey();
    if (item.entryId) {
      try { await Store.replaceContent(item.entryId, file); }
      catch (error) { toast('Die gespeicherte Kopie konnte nicht aktualisiert werden: ' + error.message); }
    }
    const learned = !!state.profile.name && learnTemplate(true);
    toast((inPlace ? 'Profil in ' + item.name + ' gespeichert.' : 'Kopie mit Profil heruntergeladen: ' + item.name) + (learned ? ' Vorlage „' + state.profile.name + '“ gelernt.' : ''));
    render();
  } catch (error) {
    toast(error.message);
  }
}

registerActions({
  'learn-template': () => learnTemplate(),
  'match-templates': findTemplates,
  'apply-template': applyTemplate,
  'delete-template': value => { Templates.remove(value); state.profile.matches = state.profile.matches.filter(m => m.tpl.n + '|' + m.tpl.name !== value); renderConfig(); },
});

registerForms({
  'profile-form': saveProfile,
});
