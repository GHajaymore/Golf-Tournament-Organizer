// Service worker: installability and push. Scoped to same-origin GET requests.
//
// IT KEEPS NOBODY'S SCREENS (2026-10-11).
//
// This answered every in-app page request from its cache FIRST, keyed by the
// address alone, and refreshed the cache behind it. So on a phone that changed
// hands — a partner's, a club tablet — the second member tapping Money was
// shown the FIRST member's money, their card, and their "YOU" on the board.
// Measured on the seeded club, three screens of three; and the same person
// opening the app tomorrow was shown yesterday's tab on the first tap.
//
// No test saw it, because tests open a screen by its address (a whole
// document, never answered from the cache) and a player gets there by tapping
// a tab (page data, always answered from it).
//
// What the cache was FOR was moving between tabs with no signal. Measured the
// same day, with the old worker and everything cached: it did not do that
// either — a tab tapped with no signal did not open. So nothing is given up:
//
//   - A page request is not touched. The network answers it, or nothing does.
//   - Only what is nobody's is kept: the icons and the manifest.
//   - Every cache this version does not name is deleted when it first runs,
//     which is how whatever the old one held of the last person to use a
//     phone goes.
//
// Scoring with no signal never depended on this: the card on screen keeps
// working and its strokes wait in the phone's own storage (`usePendingCard`).
// If moving between tabs offline is ever wanted, it has to be built so that a
// kept page is filed under the person it belongs to — not switched back on.
const STATIC_CACHE = "thq-static-v2";
const KEEP = [STATIC_CACHE];
const STATIC = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Web push: show the notification the server sent, and open the app on tap.
// The payload is JSON — { title, body, url, tag } — built server-side in
// services/push.ts. A push with no data still shows something rather than the
// browser's generic "This site was updated in the background".
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || "TourneyHQ";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    // Renotify so a corrected tee time re-alerts rather than silently
    // replacing the earlier one under the same tag.
    renotify: Boolean(data.tag),
    data: { url: data.url || "/me" },
  };
  // URGENT — play suspended (Rule 5.7). A web page cannot choose the sound a
  // locked phone makes, but it can ask for a long buzz, never be silent, and
  // stay on screen until the player has seen it.
  if (data.urgent) {
    options.vibrate = [700, 250, 700, 250, 700, 250, 700];
    options.requireInteraction = true;
    options.silent = false;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/me";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab and take it to the target, rather than piling up
      // new windows every time a player taps a notification.
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// The fetch handler stays, though it now answers only four files: a worker
// with none is not installable on some browsers.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // EXACTLY the files named above. Not "anything ending .png": a club's logo
  // and a card photo are somebody's, and a list is a rule nobody can widen by
  // adding a route.
  if (!STATIC.includes(url.pathname)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      }),
    ),
  );
});
