#!/usr/bin/env node
/* Renders the PNG app icons from app/icons/*.svg (needs Playwright).  node scripts/make-icons.js */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const dir = path.join(__dirname, '..', 'app', 'icons');
const jobs = [['icon.svg', 'icon-180.png', 180], ['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['maskable.svg', 'maskable-512.png', 512]];
(async () => {
  const b = await chromium.launch();
  for (const [svg, png, size] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const src = fs.readFileSync(path.join(dir, svg), 'utf8');
    await p.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}" width="${size}" height="${size}">`);
    await p.screenshot({ path: path.join(dir, png), omitBackground: true });
    await p.close();
  }
  await b.close();
  console.log('icons written');
})();
