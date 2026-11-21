// oberflaeche/seitenleiste – Seitenleiste und mobile Schublade: Dateiinfo, Topologie, Öffnen und Schließen.
import { $, esc, icon, mobile } from '../basis/dom.js';
import { registerActions } from '../basis/erweiterung.js';
import { modeMarkup, pairColor } from '../basis/farben.js';
import { complexText, display, freqInput, hz, num, portName } from '../basis/format.js';
import { LOCALE } from '../basis/sprache.js';
import { LOADS, state } from '../basis/zustand.js';
import { renderMain } from './rahmen.js';

// The phone drawer starts closed before the first render, so it never flashes open while the app loads.
$('app-layout').classList.toggle('sidebar-collapsed', state.collapsed);
$('sidebar').inert = mobile.matches && state.collapsed;

function refsSummary(refs) {
  const unique = [...new Set(refs.map(num))];
  return unique.length === 1 ? unique[0] + ' Ω' : 'je Port';
}

function loadName(load) {
  if (load.type === 'join') return '= ' + portName(load.to);
  return LOADS.find(item => item[0] === load.type)?.[1] || '—';
}

function loadDescription(load, ref) {
  if (load.type === 'join') return 'Kurzgeschlossen mit ' + portName(load.to) + ' · gemeinsamer Knoten';
  if (load.type === 'match') return display(ref) + ' Ω · Z₀ Datei';
  if (load.type === 'open') return 'Γ = +1';
  if (load.type === 'short') return 'Γ = −1';
  if (load.type === 'resistor') return display(load.r) + ' Ω';
  if (load.type === 'complex') return complexText([load.r, load.x], 'Ω');
  if (load.type === 'series' || load.type === 'parallel') {
    const r = load.r ? display(load.r) + ' Ω' : '';
    const l = load.l ? display(load.l * 1e9) + ' nH' : '';
    const c = load.c ? display(load.c * 1e12) + ' pF' : '';
    return [r, l, c].filter(Boolean).join(' · ') || (load.type === 'parallel' ? 'Open' : 'Short');
  }
  return '';
}

function topoHtml(full = false) {
  const { dataset, config } = state;
  const paired = new Set(config.pairs.flatMap(p => [p.p, p.q]));
  const groups = config.pairs.map(p => ({
    title: 'D' + p.id + ' / C' + p.id, color: pairColor(p.id),
    ports: [[p.p, '+'], [p.q, '−']]
  }));
  const singles = RF.indices(dataset.n).filter(i => !paired.has(i));
  singles.sort((a, b) => Number(config.loads[b].type === 'active') - Number(config.loads[a].type === 'active') || a - b);
  groups.push(...singles.map(i => ({ title: '', ports: [[i, '']] })));
  const max = full ? groups.length : 8;
  const limited = groups.slice(0, max);
  const group = item => {
    const wires = item.ports.map(([i, sign]) => {
      const load = config.loads[i];
      const term = load.type !== 'active';
      const label = term ? loadName(load) : sign;
      const tooltip = portName(i) + (dataset.portNames[i] ? ' · ' + dataset.portNames[i] : '') +
        (term ? ' · ' + loadDescription(load, dataset.refs[i]) : '');
      return '<div class="net-wire' + (sign ? ' is-paired' : '') + (term ? ' is-load' : '') +
        '" title="' + esc(tooltip) + '"><span class="net-chip">' + portName(i) +
        (label ? '<em>' + esc(label) + '</em>' : '') + '</span></div>';
    }).join('');
    return '<div class="net-group' + (item.color ? ' is-pair' : '') + '"' + (item.color ? ' style="--pc:' + item.color + '"' : '') + '>' +
      (item.title ? '<span class="net-pair"><i class="pc-dot"></i>' + modeMarkup(esc(item.title)) + '</span>' : '') + wires + '</div>';
  };
  const left = limited.filter((_, i) => i % 2 === 0).map(group).join('');
  const right = limited.filter((_, i) => i % 2 === 1).map(group).join('');
  return '<div class="topology-board" aria-label="Portschema des DUT"><div class="net-side">' + left +
    '</div><div class="net-core">DUT</div><div class="net-side right">' + right + '</div></div>' +
    (groups.length > max ? '<p class="net-hidden">+' + (groups.length - max) + ' weitere Gruppen in Ports &amp; Lasten</p>' : '');
}

// On phones the sidebar is a drawer: the back button closes it first, the page behind does not scroll.
let drawerSync = false;
function syncDrawer() {
  const open = mobile.matches && !state.collapsed;
  document.body.classList.toggle('drawer-open', open);
  $('sidebar').inert = mobile.matches && state.collapsed;
  $('drawer-toggle').setAttribute('aria-expanded', String(open));
  if (!mobile.matches || drawerSync) return;
  if (open && !history.state?.spaDrawer) history.pushState({ spaDrawer: true }, '');
  else if (!open && history.state?.spaDrawer) { drawerSync = true; history.back(); }
}
function closeDrawer() {
  if (state.collapsed) return;
  state.collapsed = true;
  renderSidebar();
}

function renderSidebar() {
  $('app-layout').classList.toggle('sidebar-collapsed', state.collapsed);
  syncDrawer();
  const button = $('sidebar-button');
  button.setAttribute('aria-expanded', String(!state.collapsed));
  button.setAttribute('aria-label', state.collapsed ? 'Messnetzwerk ausklappen' : 'Messnetzwerk einklappen');
  button.title = button.getAttribute('aria-label');
  const d = state.dataset;
  if (!d) return;
  $('heading-file').textContent = d.name;
  $('file-chip-name').textContent = d.name;
  $('menu-file-name').textContent = d.name;
  $('file-chip').setAttribute('aria-expanded', String(!state.collapsed));
  $('dataset-summary').innerHTML =
    '<div class="file-title" title="' + esc(d.name) + '">' + icon('file') + '<strong>' + esc(d.name) + '</strong>' +
    (d.demo ? '<span class="demo-tag">Demo</span>' : '') + '</div>' +
    '<dl class="file-meta">' +
    '<div><dt>Frequenz</dt><dd class="mono">' + esc(hz(d.freq[0])) + ' – ' + esc(hz(d.freq.at(-1))) + '</dd></div>' +
    '<div><dt>Punkte</dt><dd class="mono">' + d.freq.length.toLocaleString(LOCALE) + '</dd></div>' +
    '<div><dt>Dateireferenz</dt><dd class="mono">' + esc(refsSummary(d.refs)) + '</dd></div>' +
    '<div><dt>Format</dt><dd class="mono">' + (d.spice ? 'SPICE · ' + d.spice.elements + ' R/L/C' : 'TS ' + esc(d.version) + ' · ' + esc(d.sourceKind + '/' + d.format)) + '</dd></div>' +
    (d.noiseCount ? '<div><dt>Rauschpunkte</dt><dd class="mono">' + d.noiseCount + '</dd></div>' : '') +
    '</dl>' + (d.spice ? '<form id="sweep-form" class="sweep-form"><span>AC-Sweep</span><input class="field-input" name="start" aria-label="Startfrequenz" value="' + esc(freqInput(d.freq[0])) +
      '"><input class="field-input" name="stop" aria-label="Stoppfrequenz" value="' + esc(freqInput(d.freq.at(-1))) + '"><button type="submit" class="quiet-button">Rechnen</button></form>' : '');
  $('topology').innerHTML = topoHtml();
  const active = state.layout?.active.length ?? d.n, loaded = d.n - active;
  $('network-summary').innerHTML = '<span class="badge active">' + active + ' aktiv</span>' +
    (state.config.pairs.length ? '<span class="badge">' + state.config.pairs.length + ' Paare</span>' : '') +
    (loaded ? '<span class="badge loaded">' + loaded + ' abgeschlossen</span>' : '') +
    ({ file: '<span class="badge profile-badge">Profil aus Datei</span>', template: '<span class="badge profile-badge">Vorlage ' + esc(state.profile.name) + '</span>' }[state.profile.source] ?? '');
}

$('drawer-backdrop').addEventListener('click', closeDrawer);
if (history.state?.spaDrawer) history.replaceState(null, '');
window.addEventListener('popstate', () => {
  drawerSync = false;
  if (mobile.matches && !state.collapsed && !history.state?.spaDrawer) closeDrawer();
});
mobile.addEventListener('change', () => { state.collapsed = mobile.matches; renderSidebar(); if (state.dataset) renderMain(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobile.matches && !state.collapsed && !document.querySelector('dialog[open]')) closeDrawer();
});
// Swipe to the left closes the drawer; vertical movement keeps scrolling its content.
let drawerTouch = null;
$('sidebar').addEventListener('touchstart', event => {
  drawerTouch = mobile.matches && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
}, { passive: true });
$('sidebar').addEventListener('touchmove', event => {
  if (!drawerTouch) return;
  const dx = event.touches[0].clientX - drawerTouch.x, dy = event.touches[0].clientY - drawerTouch.y;
  if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) drawerTouch = null;
  else if (dx < -56 && Math.abs(dx) > 2 * Math.abs(dy)) { drawerTouch = null; closeDrawer(); }
}, { passive: true });
$('sidebar').addEventListener('touchend', () => { drawerTouch = null; }, { passive: true });

registerActions({
  'toggle-sidebar': () => {
    state.collapsed = !state.collapsed;
    renderSidebar();
    // The drawer lies over the page; only the desktop sidebar needs the page scrolled to its top.
    if (!state.collapsed && !mobile.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!state.collapsed && mobile.matches) $('drawer-close').focus({ preventScroll: true });
  },
  'drawer-close': closeDrawer,
});

export { loadName, loadDescription, topoHtml, renderSidebar };
