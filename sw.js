// מטמון לעבודה גם בלי רשת. נתונים: קודם רשת, ואם אין — העותק האחרון.
const CACHE = "vti-shell-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "bot.js", "icons/logo.svg", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const key = url.origin + url.pathname; // בלי ?t=
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then((m) => m || caches.match("index.html")))
  );
});
