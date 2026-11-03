const CODE = 'ps-code-v1', ART = 'ps-art-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CODE).then(c => c.addAll(['./', './index.html', './css/style.css', './manifest.webmanifest'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CODE && k !== ART).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const art = /\/assets\/(pokemon|icons|fonts)\//.test(url.pathname) && !/\/k-[a-z0-9-]+\//.test(url.pathname);
  if (art) {
    e.respondWith(caches.open(ART).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // La página del juego ("/" o "/index.html", con o sin ?...) se guarda también como
  // ./index.html: el respaldo sin conexión es siempre la última que se abrió. Antes
  // era la de cuando se instaló el service worker, que podía ser de una versión
  // muy anterior.
  const scope = new URL(self.registration.scope).pathname;
  const game = req.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html');
  e.respondWith(fetch(req).then(res => {
    if (res.ok && !res.redirected) {
      const copy = res.clone(), copy2 = game ? res.clone() : null;
      caches.open(CODE).then(c => { c.put(req, copy); if (copy2) c.put('./index.html', copy2); });
    }
    return res;
  }).catch(async () => {
    // Sin red: la copia guardada. La página de inicio sólo sirve de respaldo
    // al abrir la web (nunca en lugar de un script o una imagen).
    if (game) { const page = await caches.match('./index.html'); if (page) return page; }
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
