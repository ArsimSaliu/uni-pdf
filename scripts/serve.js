#!/usr/bin/env node
/* Minimal static file server for local development and tests.
 *   node scripts/serve.js [port] [root]    (defaults: 8080, repo root)
 * Open http://localhost:8080/app/ for the app, / for the homepage (site/). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || process.env.PORT || 8080);
const repo = path.join(__dirname, '..');
const roots = process.argv[3] ? [path.resolve(process.argv[3])] : [path.join(repo, 'site'), repo];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

function resolve(urlPath) {
  for (const root of roots) {
    let p = path.join(root, decodeURIComponent(urlPath));
    if (!p.startsWith(root)) return null;
    try {
      if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (fs.statSync(p).isFile()) return p;
    } catch (_) { /* try next root */ }
  }
  return null;
}

http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  if (/\/[^/.]+$/.test(urlPath) && resolve(urlPath + '/')) { res.writeHead(301, { Location: urlPath + '/' }); res.end(); return; }
  const file = resolve(urlPath);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`uni-pdf: http://localhost:${port}/app/  (homepage: http://localhost:${port}/)`));
