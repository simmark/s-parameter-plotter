'use strict';

// CACHE_VERSION is replaced by build.py with a hash of the app files.
const CACHE_VERSION = '8d74be1a435944ab';
const CACHE_PREFIX = 's-parameter-analyzer:' + self.registration.scope + ':';
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const SHARED = 's-parameter-analyzer:shared';
const app = new URL('index.html', self.registration.scope);
const shareTarget = new URL('share-target', self.registration.scope);
const shell = ['index.html', 'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png'];
const staticUrls = new Set(shell.map(path => new URL(path, app).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...staticUrls].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Android "Teilen → S-Analyzer": the file is parked in a cache and the app picks it up after the redirect.
async function receiveShare(request) {
  const redirect = new URL('index.html?shared=1', self.registration.scope).href;
  try {
    const form = await request.formData();
    const file = form.getAll('file').find(item => item && typeof item === 'object' && 'size' in item);
    if (file) {
      const cache = await caches.open(SHARED);
      await cache.put('shared-file', new Response(file, {
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'Geteilt.snp') }
      }));
    }
  } catch { /* the app opens normally */ }
  return Response.redirect(redirect, 303);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.href.split('?')[0] === shareTarget.href) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== app.origin) return;
  const atApp = url.pathname === app.pathname || url.pathname === new URL('./', app).pathname;
  const navigation = event.request.mode === 'navigate' && atApp;
  if (!navigation && !staticUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(navigation ? app.href : event.request) ?? await fetch(event.request);
  })());
});
