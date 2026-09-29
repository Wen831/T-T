/*
 * Web Push handlers for TT's service worker.
 *
 * Loaded via `importScripts` from the Workbox-generated sw.js (see
 * `importScripts` in vite.config.js). The generated worker keeps the whole
 * offline precache/runtime-cache strategy; this file adds only the two event
 * listeners Web Push needs:
 *
 *   `push`              — a payload arrived from TT's server; show it.
 *   `notificationclick` — the user tapped it; focus TT or open the deep link.
 *
 * The payload is the JSON the PushService sends:
 *   { title, body, navigateTarget?, event? }
 * Title/body are already rendered in the recipient's language server-side, so
 * this file never needs i18n — one reason it is plain JS outside the bundle.
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A text-only payload (or garbage): show what there is to show.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const origin = self.location.origin;
  const target = payload.navigateTarget
    ? origin + payload.navigateTarget
    : payload.url || origin + '/';

  event.waitUntil(
    self.registration.showNotification(payload.title || 'TT', {
      body: payload.body || '',
      // Collapses bursts of the same event (ten chat messages → one tile that
      // updates in place) instead of stacking the lock screen.
      tag: payload.event || 'tt',
      icon: origin + '/icons/icon-192x192.png',
      badge: origin + '/icons/icon-192x192.png',
      data: { url: target },
      // The click target is in `data.url`; actions would need i18n here, and
      // the notification itself already deep-links.
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.location.origin + '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an existing TT window that is already on the target (or any TT
      // window, navigated there) before opening a new one — tapping a push
      // should not fork a second instance of the app.
      for (const client of clientList) {
        if (!('focus' in client)) continue;
        if (url.startsWith(client.url)) {
          await client.focus();
          if ('navigate' in client && !client.url.startsWith(url)) await client.navigate(url);
          return;
        }
      }
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
