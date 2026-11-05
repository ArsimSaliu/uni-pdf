#!/usr/bin/env node
/* Assembles the deployable website in _site/:
 *   _site/          the homepage (site/)
 *   _site/app/      the app (app/)
 * and the offline download dist/uni-pdf.zip (just the app folder).
 *   npm run build */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
const dist = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.cpSync(path.join(root, 'app'), path.join(out, 'app'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const base = 'https://arsimsaliu.github.io/uni-pdf/';
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
fs.writeFileSync(path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}</loc></url>\n  <url><loc>${base}app/</loc></url>\n</urlset>\n`);

// Offline download: a folder with the app + a short readme, zipped.
fs.rmSync(dist, { recursive: true, force: true });
const pkg = path.join(dist, 'uni-pdf');
fs.mkdirSync(pkg, { recursive: true });
fs.cpSync(path.join(root, 'app'), pkg, { recursive: true });
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(pkg, 'LICENSE'));
fs.writeFileSync(path.join(pkg, 'START HERE.txt'),
  'uni-pdf: offline version\r\n\r\nDouble-click index.html. It opens in your browser (Chrome or Edge recommended)\r\n'
  + 'and works without an internet connection.\r\n\r\nYour notes are saved in that browser. Keep opening this same index.html with the\r\n'
  + 'same browser, or your notes will not show up. Use Export > Backup to keep a copy.\r\n\r\n'
  + 'Online version and help: ' + base + '\r\n');
try {
  execFileSync('zip', ['-qr', 'uni-pdf.zip', 'uni-pdf'], { cwd: dist });
  console.log('built _site/ and dist/uni-pdf.zip');
} catch (e) {
  console.log('built _site/ (zip not available, skipped dist/uni-pdf.zip)');
}
