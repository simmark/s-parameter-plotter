// oberflaeche/aktionen – allgemeine Knöpfe (Dialoge, Sprache, Design) und das Einstellungsmenü.
// Die übrigen Aktionen melden die Fachmodule selbst an (registerActions in basis/erweiterung.js).
import { $, openDialog } from '../basis/dom.js';
import { action, registerActions } from '../basis/erweiterung.js';
import { render } from './rahmen.js';

function toggleMenu(force) {
  const menu = $('settings-menu'), button = $('settings-button');
  const open = typeof force === 'boolean' ? force : menu.hidden;
  if (open) $('menu-install').hidden = $('pwa-install').hidden;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.menu-item:not([hidden])')?.focus({ preventScroll: true });
}

// Third-party blocks (<script id="fremd-…">) carry their license texts in a leading /*! … */ comment; the dialog shows them as they are.
function openLicense() {
  const notices = [...document.querySelectorAll('script[id^="fremd-"]')].map(block => block.textContent.match(/\/\*!([\s\S]*?)\*\//)?.[1].trim()).filter(Boolean);
  $('third-party-text').textContent = notices.join('\n\n') || '—';
  openDialog('license-dialog');
}

registerActions({
  'close-dialog': (_, button) => button.closest('dialog').close(),
  lang: () => window.I18N.set(window.I18N.lang === 'de' ? 'en' : 'de'),
  license: openLicense,
  theme: () => { Theme.toggle(); render(); },
  'menu-toggle': () => toggleMenu(),
  'menu-go': value => {
    toggleMenu(false);
    if (value === 'files') action('toggle-sidebar')();
    else if (value === 'lang') action('lang')();
    else if (value === 'packs') action('packs')();
    else if (value === 'storage') action('storage')();
    else if (value === 'license') openLicense();
    else if (value === 'method') $('method-button').click();
    else if (value === 'export') $('export-button').click();
    else if (value === 'install') $('pwa-install').click();
  },
  method: () => openDialog('method-dialog'),
});

document.addEventListener('pointerdown', event => {
  if (!$('settings-menu').hidden && !event.target.closest('#settings-menu, #settings-button')) toggleMenu(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('settings-menu').hidden) { toggleMenu(false); $('settings-button').focus(); }
});
