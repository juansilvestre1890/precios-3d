/*
 * Service worker de Precios 3D
 * Para publicar una actualización, sube los archivos y cambia VERSION.
 * Nunca guarda en caché las llamadas a Google Apps Script.
 */
const VERSION = "v1.1.0";
const CACHE = "precios3d-" + VERSION;

const ARCHIVOS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/calc.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./img/logo-app.webp",
  "./img/productos-3d.webp",
  "./img/calculadora.webp",
  "./img/icons/icon-192.png",
  "./img/icons/icon-512.png",
  "./img/icons/maskable-192.png",
  "./img/icons/maskable-512.png",
  "./img/icons/apple-touch-icon.png",
  "./img/icons/favicon-64.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k.startsWith("precios3d-") && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;               // POST a Apps Script: siempre a la red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // otros dominios: sin intervención

  // Imágenes: primero caché.
  if (req.destination === "image") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      }))
    );
    return;
  }

  // Página, estilos y scripts: primero red (para recibir actualizaciones), caché si no hay conexión.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) =>
        hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())
      )
    )
  );
});
