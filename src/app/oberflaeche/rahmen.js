// oberflaeche/rahmen – Rahmen der Seite: Tabs, Seitentitel, Statuszeile, Ansichtsmodus und der zentrale Neuaufbau.
// Welche Ansichten es gibt, melden die Module über registerView (basis/erweiterung.js) an.
import { renderAnalysis } from '../analyse/darstellung.js';
import { chooseDefaults } from '../analyse/kurven.js';
import { renderControls } from '../analyse/steuerung.js';
import { $, disabled, esc, notice, pressed } from '../basis/dom.js';
import { allViews, hasView, registerActions, tabOf, view } from '../basis/erweiterung.js';
import { LOCALE } from '../basis/sprache.js';
import { state } from '../basis/zustand.js';
import { persistSettings } from '../dateien/einstellungen.js';
import { renderSidebar } from './seitenleiste.js';

const tabButtons = () => Array.from(document.querySelectorAll('[role="tab"]'));

// ---- View modes: normal, reduced (plot, curves, markers) and full screen (plot with marker values). ----
function setViewMode(mode) {
  state.viewMode = mode;
  document.body.classList.toggle('view-focus', mode > 0);
  document.body.classList.toggle('view-full', mode > 1);
  document.querySelectorAll('[data-action="view-mode"]').forEach(button => button.setAttribute('aria-pressed', String(mode > 0)));
  if (mode > 1) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (state.dataset) requestAnimationFrame(() => render());
}

function setTab(tab) {
  if (!hasView(tab)) return;
  // A view may hand over to another one when it is opened (the Z tab reopens CISPR 17 if that was used last).
  const other = view(tab).enter?.();
  if (other && hasView(other)) { tab = other; view(tab).enter?.(); }
  state.tab = tab;
  renderMain();
  const target = $('tab-' + tabOf(tab));
  const parent = target.parentElement;
  if (target.offsetLeft + target.offsetWidth > parent.scrollLeft + parent.clientWidth || target.offsetLeft < parent.scrollLeft) {
    const relative = target.getBoundingClientRect().left - parent.getBoundingClientRect().left;
    if (relative < 0 || relative + target.offsetWidth > parent.clientWidth) parent.scrollLeft += relative - 10;
  }
}

function setBasis(value) {
  if (value === 'mm' && !state.layout.hasMixed) return;
  state.basis = value;
  renderMain();
}

function pageInfo() {
  const context = view(state.tab)?.context;
  return typeof context === 'function' ? context() : context || '';
}

function renderStatus() {
  const text = state.error || (state.busy ? 'Netzwerk wird berechnet …' :
    (state.network?.gaps ? state.network.gaps.toLocaleString(LOCALE) + ' singuläre Punkte im reduzierten Netzwerk. Diese Frequenzen erscheinen als Lücken.' : ''));
  notice('global-status', text);
  $('global-status').classList.toggle('neutral', state.busy);
  const d = state.dataset;
  const scope = (d.demo ? 'Synthetische Beispieldaten' : d.name) + ' · ' + d.n + ' Ports';
  $('status-bar').innerHTML = '<span><span class="status-dot' + (state.error || state.busy ? ' warn' : '') + '"></span>' +
    esc(scope) + '</span><span>' + (state.network?.gaps ? esc((d.freq.length - state.network.gaps).toLocaleString(LOCALE)) + ' gültige Punkte' : 'Berechnung im Browser') + '</span>';
}

function renderMain() {
  if (!state.dataset || !state.layout) return;
  chooseDefaults();
  persistSettings();
  tabButtons().forEach(tab => {
    const current = tab.dataset.value === tabOf(state.tab);
    tab.setAttribute('aria-selected', String(current));
    tab.tabIndex = current ? 0 : -1;
  });
  $('panel').setAttribute('aria-labelledby', 'tab-' + tabOf(state.tab));
  const current = view(state.tab);
  $('page-title').textContent = current.title;
  $('page-context').textContent = pageInfo();
  const showBasis = !!current.basis?.();
  $('basis-control').innerHTML = showBasis
    ? '<div class="segment basis-segment" aria-label="Portbasis">' +
      '<button type="button" data-action="basis" data-value="se"' + pressed(state.basis === 'se') + '><span class="basis-long">Single Ended</span><span class="basis-short">SE</span></button>' +
      '<button type="button" data-action="basis" data-value="mm"' + pressed(state.basis === 'mm') + disabled(!state.layout.hasMixed) +
        (!state.layout.hasMixed ? ' title="Lege zuerst ein Portpaar an"' : ' title="Differential (D), Gleichtakt (C) und Modenkonversion"') +
        '><span class="basis-long">Mixed Mode</span><span class="basis-short">MM</span><span class="mode-dots" aria-hidden="true"><i style="background:var(--mode-d)"></i><i style="background:var(--mode-c)"></i><i style="background:var(--mode-dc)"></i><i style="background:var(--mode-cd)"></i></span></button></div>'
    : '';
  // A view with its own panel draws it itself; all others share the analysis area with the plot.
  for (const other of allViews()) if (other.panel) $(other.panel).hidden = other !== current;
  $('analysis-panel').hidden = !!current.panel;
  renderStatus();
  if (current.panel) {
    state.view = null;
    Plot.set(null);
    current.render();
  } else {
    renderControls();
    renderAnalysis();
  }
}

function render() {
  renderSidebar();
  renderMain();
}

registerActions({
  tab: setTab,
  basis: setBasis,
  'view-mode': () => setViewMode((state.viewMode + 1) % 3),
});

export { tabButtons, setViewMode, setTab, renderMain, render };
