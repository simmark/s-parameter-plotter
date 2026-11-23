// basis/erweiterung – Erweiterungspunkte der App. Fachmodule melden sich hier an, statt in zentralen Tabellen zu stehen:
//   registerView        Ansicht mit Tab (eigenes Panel oder Teil des Analysebereichs)
//   registerActions     Knöpfe mit data-action="name" (Klick)
//   registerForms       Formulare mit id (submit)
//   registerChanges     Auswahllisten mit data-change="name"
//   registerFileState   Zustand, der zu einer Datei gehört: Grundwert, Speichern und Wiederherstellen
//   registerSlot        Beitrag zu einer benannten Stelle der Oberfläche, z. B. ein Knopf in der Markerleiste ('marker-tools')
// Ein Name darf nur einmal angemeldet werden; ein doppelter Name bricht beim Laden mit einer klaren Meldung ab.
import { state } from './zustand.js';

const actions = new Map(), forms = new Map(), changes = new Map(), views = new Map(), fileStates = new Map(), slots = new Map();

function add(map, kind, table, extra = {}) {
  for (const [name, handler] of Object.entries(table)) {
    if (map.has(name)) throw new Error(kind + ' doppelt angemeldet: ' + name);
    if (typeof handler !== 'function') throw new Error(kind + ' ' + name + ': Handler fehlt');
    map.set(name, { handler, ...extra });
  }
}

// ---- Aktionen: handler(value, button) ----
const registerActions = table => add(actions, 'Aktion', table);
const action = name => actions.get(name)?.handler;

// ---- Formulare: handler(form) ----
const registerForms = table => add(forms, 'Formular', table);
const formHandler = id => forms.get(id)?.handler;

// ---- Auswahllisten: handler(value, select). Danach baut der Rahmen die Ansicht neu auf, außer bei { rerender: false }. ----
const registerChanges = (table, { rerender = true } = {}) => add(changes, 'Auswahlliste', table, { rerender });
const changeHandler = key => changes.get(key);

// ---- Ansichten ----
// { id, title, short?, icon?, hint?,
//   panel?   id eines eigenen Panels; render() füllt es. Ohne panel gehört die Ansicht zum Analysebereich (Diagramm).
//   render?  zeichnet das eigene Panel,
//   basis?   () => true, wenn der Umschalter Single Ended / Mixed Mode gezeigt wird,
//   button?  id einer anderen Ansicht, deren Tab-Knopf diese Ansicht mit vertritt (CISPR 17 liegt unter „Impedanz“),
//   enter?   () => andere Ansicht oder nichts; läuft beim Wechsel auf diese Ansicht,
//   after?   id der Ansicht, hinter deren Tab der neue Tab steht (sonst am Ende),
//   iconPath? Pfad (viewBox 0 0 24 24) für ein eigenes Symbol, statt icon aus der Symbolsammlung }
// Fehlen Tab-Knopf oder Panel im HTML, werden sie angelegt; neue Ansichten brauchen also keine Änderung am HTML.
function registerView(view) {
  if (!view?.id || !view.title) throw new Error('Ansicht braucht id und title');
  if (views.has(view.id)) throw new Error('Ansicht doppelt angemeldet: ' + view.id);
  if (view.panel && typeof view.render !== 'function') throw new Error('Ansicht ' + view.id + ': render fehlt');
  views.set(view.id, view);
  if (!view.button) ensureTab(view);
  if (view.panel) ensurePanel(view);
}
const view = id => views.get(id);
const hasView = id => views.has(id);
const allViews = () => [...views.values()];
const tabOf = id => views.get(id)?.button || id;

function ensureTab(view) {
  if (document.getElementById('tab-' + view.id)) return;
  const list = document.querySelector('nav.tabs[role="tablist"]');
  const button = document.createElement('button');
  Object.assign(button, { className: 'tab', type: 'button', id: 'tab-' + view.id });
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', 'panel');
  button.setAttribute('aria-selected', 'false');
  button.dataset.action = 'tab';
  button.dataset.value = view.id;
  if (view.hint) button.title = view.hint;
  const esc = text => String(text).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  let icon = view.icon || 'wave';
  if (view.iconPath) {
    // The module brings its own symbol; it joins the page's symbol bank like the built-in ones.
    icon = view.id;
    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    symbol.id = 'i-' + icon;
    symbol.setAttribute('viewBox', '0 0 24 24');
    symbol.innerHTML = '<path d="' + esc(view.iconPath) + '"/>';
    document.querySelector('svg.symbol-bank').append(symbol);
  }
  button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + esc(icon) + '"/></svg>' +
    '<span class="tab-long">' + esc(view.title) + '</span><span class="tab-short">' + esc(view.short || view.title) + '</span>';
  const anchor = view.after && document.getElementById('tab-' + view.after);
  if (anchor) anchor.after(button); else list.append(button);
}

function ensurePanel(view) {
  if (document.getElementById(view.panel)) return;
  const panel = document.createElement('div');
  panel.id = view.panel;
  panel.hidden = true;
  document.getElementById('analysis-panel').before(panel);
}

// ---- Stellen der Oberfläche, an denen Module etwas beitragen: render() → HTML (leer = nichts) ----
function registerSlot(name, render) {
  if (typeof render !== 'function') throw new Error('Beitrag zu ' + name + ': render fehlt');
  if (!slots.has(name)) slots.set(name, []);
  slots.get(name).push(render);
}
const slot = name => (slots.get(name) || []).map(render => render() || '').join('');

// ---- Zustand pro Datei ----
// registerFileState(key, { blank, save?, load? }): state[key] bekommt beim Öffnen einer Datei blank(). save(value) liefert
// den Teil, der mit den Einstellungen der Datei gespeichert wird (oder null), load(saved, dataset) den wiederhergestellten
// Zustand (oder undefined = Grundwert behalten). saved ist ungeprüft und muss in load geprüft werden.
function registerFileState(key, def) {
  if (fileStates.has(key)) throw new Error('Dateizustand doppelt angemeldet: ' + key);
  if (typeof def?.blank !== 'function') throw new Error('Dateizustand ' + key + ': blank fehlt');
  fileStates.set(key, def);
}
function resetFileStates() {
  for (const [key, def] of fileStates) state[key] = def.blank();
}
function saveFileStates() {
  const out = {};
  for (const [key, def] of fileStates) if (def.save) out[key] = state[key] ? def.save(state[key]) : null;
  return out;
}
function loadFileStates(saved, dataset) {
  for (const [key, def] of fileStates) {
    if (!def.load || saved[key] === undefined || saved[key] === null) continue;
    const value = def.load(saved[key], dataset);
    if (value !== undefined) state[key] = value;
  }
}

export { registerActions, action, registerForms, formHandler, registerChanges, changeHandler, registerView, view,
  hasView, allViews, tabOf, registerSlot, slot, registerFileState, resetFileStates, saveFileStates, loadFileStates };
