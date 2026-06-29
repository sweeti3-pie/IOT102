/* ═══════════════════════════════════════════════════════════════
   sw.js — SmartHome Dashboard Service Worker
   ─────────────────────────────────────────────────────────────
   PURPOSE OF THIS VERSION: nuke every old cache and force every
   open tab / installed PWA to start using the latest files
   immediately, with no stale leftovers from previous deploys.

   Bump CACHE_VERSION any time you want to force a fresh cache
   cycle again in the future.
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v2-nuke-' + Date.now();

// ─── INSTALL: activate the new worker immediately, don't wait ──
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// ─── ACTIVATE: delete every existing cache bucket, take control ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete ALL caches this service worker (or any previous
      //    version of it) may have created. There should be none
      //    since fetch never wrote to cache, but this guarantees
      //    a clean slate regardless of history.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // 2. Take control of any already-open tabs/PWA windows right
      //    away instead of waiting for the next full reload.
      await self.clients.claim();
    })()
  );
});

// ─── FETCH: always go to the network, never serve from cache ──
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() =>
      // If totally offline, just let the request fail naturally
      // rather than serving a stale cached response.
      new Response('Offline', { status: 503, statusText: 'Offline' })
    )
  );
});

// ─── NOTIFICATION: receive message from app.js ─────────────────
// app.js posts { type: 'SHOW_NOTIFICATION', title, body, tag }
// The service worker shows it — this works even when screen is off
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;
  const { title, body, tag } = event.data;
  self.registration.showNotification(title, {
    body,
    icon:     '/img/dashboard-icon.png',
    badge:    '/img/dashboard-icon.png',
    tag:      tag || 'smarthome',
    renotify: true,
    vibrate:  [200, 100, 200],
  });
});
 
// ─── NOTIFICATION CLICK: open / focus the app ──────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
