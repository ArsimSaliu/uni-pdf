/* uni-pdf service worker: caches the app so it works offline once installed.
 * CACHE must change on every release (scripts/bump-version.js does this). */
'use strict';
const CACHE = 'uni-pdf-1.1.0';
const CORE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
];
// Only needed for exporting or the demo; cached in the background.
const LAZY = [
  'export-pdf.js',
  'sample-lecture.js',
  'vendor/pdf-lib.min.js',
  'vendor/fontkit.umd.min.js',
  'vendor/dejavu-fonts.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    c.addAll(LAZY).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('uni-pdf-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await c.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
