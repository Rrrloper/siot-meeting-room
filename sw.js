/* 회의실 예약 시연판 — 오프라인 캐시 (_mobile.cjs가 만든다 · 직접 고치지 않는다) */
const VERSION = 'spacekey-01151f5d';
const PRECACHE = ["./","index.html","manifest.webmanifest","logo/dy.gif","assets/tokens.css?v=3f78436d","assets/components.css?v=d5e23542","assets/app.css?v=7e597efd","assets/mobile.css?v=1b2e2fbe","assets/mock.js?v=ec453ef3","assets/accounts.js?v=1af3b984","assets/app.js?v=2b338bd6","assets/demo.js?v=070119a6","assets/icons/icon-192.png","assets/icons/icon-512.png","assets/icons/icon-maskable-512.png","assets/icons/apple-touch-icon.png","assets/icons/favicon-32.png"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 페이지 이동은 늘 index.html — 해시 · 쿼리(?join=)가 붙어도 */
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('index.html', c)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net')) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
    return r;
  })));
});
