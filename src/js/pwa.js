'use strict';

(() => {
  if (!('serviceWorker' in navigator)) return;
  const button = document.getElementById('pwa-install');
  const status = document.getElementById('pwa-status');
  const instructions = document.getElementById('pwa-instructions');
  const banner = document.getElementById('update-banner');
  let promptEvent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; });
  button.addEventListener('click', async () => {
    if (!promptEvent) {
      instructions.showModal();
      return;
    }
    const event = promptEvent;
    promptEvent = null;
    try {
      const result = await event.prompt();
      if (result?.outcome === 'accepted') button.hidden = true;
    } catch {
      instructions.showModal();
    }
  });

  // A new service worker takes over immediately; the open page offers a reload instead of switching code mid-session.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) banner.hidden = false;
  });
  document.getElementById('update-reload').addEventListener('click', () => location.reload());

  navigator.serviceWorker.register('./sw.js')
    .then(registration => {
      registration.update().catch(() => {});
      return navigator.serviceWorker.ready;
    })
    .then(() => {
      status.textContent = 'Offline bereit';
      button.hidden = !!standalone;
    })
    .catch(() => { status.textContent = location.protocol === 'file:' ? 'Lokale Datei' : 'Offline-Cache fehlt'; });
})();
