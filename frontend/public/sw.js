// Service worker de Bodegueando. A propósito no guarda la app en caché: los saldos, el fiado y
// los pagos tienen que leerse siempre en vivo, y una versión vieja de la app en caché podría
// firmar transacciones con lógica desactualizada. Solo hace una cosa: si se abre una página sin
// internet, muestra /offline.html en vez del error del navegador.
const CACHE = "bodegueando-offline-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  // Lo que usa la página sin conexión; todo lo demás va directo a la red, sin pasar por acá.
  const url = new URL(request.url);
  if (request.method === "GET" && url.origin === self.location.origin && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
