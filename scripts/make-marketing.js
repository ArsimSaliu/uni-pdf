#!/usr/bin/env node
/* Renders the marketing images from the screenshots in site/assets/:
 *   marketing/assets/flyer-en.pdf, flyer-de.pdf   printable A4 flyers
 *   marketing/assets/square.png                   1080x1080 for Instagram/LinkedIn
 *   marketing/assets/story.png                    1080x1920 for stories/TikTok/Reels
 *   marketing/assets/product-hunt-*.png           1270x760 gallery images
 * Run `npm run screenshots` first if the app UI changed.  node scripts/make-marketing.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'marketing', 'assets');
const A = (f) => 'data:image/' + (f.endsWith('.svg') ? 'svg+xml' : 'png') + ';base64,' + fs.readFileSync(path.join(ROOT, f)).toString('base64');
fs.mkdirSync(OUT, { recursive: true });

const base = `<style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:#1b2333}
.mark{background:linear-gradient(transparent 58%,rgba(255,214,0,.7) 58%)}
.shot{border-radius:16px;border:1px solid #d6dbe6;box-shadow:0 24px 70px rgba(20,40,90,.25);display:block}</style>`;

function card({ w, h, title, sub, shot, shotStyle, badge, size = 0.066 }) {
  return `<!doctype html><html><body style="width:${w}px;height:${h}px;overflow:hidden;position:relative;background:linear-gradient(150deg,#e9f0fd,#f8f6ef)">${base}
  <div style="position:absolute;left:${w * 0.07}px;top:${h * 0.06}px;right:${w * 0.07}px">
    <div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:${w * 0.034}px;letter-spacing:-.02em"><img src="${A('app/icons/icon.svg')}" width="${w * 0.05}"> uni-pdf ${badge ? `<span style="margin-left:auto;font-size:${w * 0.02}px;font-weight:600;color:#2f6fde;background:#fff;border-radius:99px;padding:6px 16px">${badge}</span>` : ''}</div>
    <div style="font-size:${w * size}px;line-height:1.06;font-weight:800;letter-spacing:-.035em;margin-top:${h * 0.035}px">${title}</div>
    <div style="font-size:${w * 0.029}px;line-height:1.4;color:#4a5263;margin-top:${h * 0.02}px">${sub}</div>
  </div>
  <img class="shot" src="${A(shot)}" style="position:absolute;${shotStyle}">
  </body></html>`;
}

(async () => {
  const b = await chromium.launch();
  const page = async (w, h) => b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });

  // Flyers (A4 PDF)
  for (const lang of ['en', 'de']) {
    const p = await b.newPage();
    await p.goto(pathToFileURL(path.join(ROOT, 'marketing', 'flyer.html')).href + (lang === 'de' ? '?lang=de' : ''));
    await p.waitForLoadState('networkidle');
    await p.pdf({ path: path.join(OUT, `flyer-${lang}.pdf`), format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    await p.close();
  }

  const jobs = [
    ['square.png', 1080, 1080, { title: 'Your lecture notes,<br><span class="mark">right on the slides.</span>', sub: 'Free · offline · nothing uploaded', shot: 'site/assets/reader.png', shotStyle: 'left:80px;top:470px;width:1240px' }],
    ['story.png', 1080, 1920, { title: 'Stop copying slides into your notes.', sub: 'Highlight, annotate, and export one PDF<br>with your notes next to every slide.', shot: 'site/assets/mobile.png', shotStyle: 'left:225px;top:660px;width:630px', badge: 'free' }],
    ['product-hunt-1.png', 1270, 760, { title: 'Notes anchored to <span class="mark">the exact sentence</span>', sub: '', size: 0.042, shot: 'site/assets/reader.png', shotStyle: 'left:90px;top:200px;width:1090px' }],
    ['product-hunt-2.png', 1270, 760, { title: 'Box a diagram, <span class="mark">pin a note</span>', sub: '', size: 0.042, shot: 'site/assets/area-note.png', shotStyle: 'left:90px;top:200px;width:1090px' }],
    ['product-hunt-3.png', 1270, 760, { title: 'Export one PDF, <span class="mark">notes beside every slide</span>', sub: '', size: 0.042, shot: 'site/assets/export-page.png', shotStyle: 'left:90px;top:220px;width:1090px' }],
    ['product-hunt-4.png', 1270, 760, { title: 'Search everything <span class="mark">before the exam</span>', sub: '', size: 0.042, shot: 'site/assets/search.png', shotStyle: 'left:90px;top:200px;width:1090px' }],
  ];
  for (const [file, w, h, opts] of jobs) {
    const p = await page(w, h);
    await p.setContent(card({ w, h, ...opts }));
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, file) });
    await p.close();
  }
  await b.close();
  console.log('marketing assets written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
