#!/usr/bin/env node
/* Generates the marketing screenshots and the demo video in site/assets/ from
 * the real app, using the demo lecture.  npm run screenshots
 * (needs Playwright and, for the .mp4/.gif, ffmpeg) */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'assets');
const PORT = 8137;
const BASE = `http://localhost:${PORT}/app/?nosw`;
fs.mkdirSync(OUT, { recursive: true });

function startServer() {
  const { spawn } = require('child_process');
  const p = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  return new Promise((resolve) => {
    const ping = () => http.get(BASE, () => resolve(p)).on('error', () => setTimeout(ping, 100));
    ping();
  });
}

async function selectText(page, pageNum, needle) {
  await page.evaluate(({ pageNum, needle }) => {
    const s = [...document.querySelectorAll(`.page[data-page="${pageNum}"] .textLayer span`)].find((x) => x.textContent.includes(needle));
    const t = s.firstChild;
    const i = t.data.indexOf(needle);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + needle.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { pageNum, needle });
  await page.waitForSelector('#selToolbar:not([hidden])');
}

const hideToast = (page) => page.evaluate(() => { document.querySelector('#toast').hidden = true; });

async function gotoPage(page, n) {
  await page.fill('#pageInput', String(n));
  await page.press('#pageInput', 'Enter');
  await page.waitForSelector(`.page[data-page="${n}"] .textLayer span`);
  await page.waitForTimeout(300);
}

async function typeSlow(page, loc, text, delay) {
  if (delay) await page.locator(loc).pressSequentially(text, { delay });
  else await page.locator(loc).fill(text);
}

// Build up a realistic set of notes on the demo lecture.
async function annotate(page, { slow = 0 } = {}) {
  const pause = (ms) => (slow ? page.waitForTimeout(ms) : null);
  await gotoPage(page, 2);
  await pause(600);
  await selectText(page, 2, 'program in execution');
  await pause(700);
  await page.click('#selToolbar .swatch[data-color="yellow"]');
  await pause(500);
  await selectText(page, 2, 'Process Control Block (PCB)');
  await pause(700);
  await page.click('#selNote');
  await typeSlow(page, '.annot.active .annot-note', 'PCB = the OS\'s "ID card" for a process. Saved on every context switch.', slow ? 35 : 0);
  await pause(500);
  await selectText(page, 2, 'context switch');
  await page.click('#selToolbar .swatch[data-color="pink"]');
  await page.click('.annot-quote >> nth=-1').catch(() => {});
  await page.locator('#pageNote').click();
  await typeSlow(page, '#pageNote', 'Prof said: context switches are pure overhead, no useful work happens. Likely exam question!', slow ? 25 : 0);
  await pause(800);

  await gotoPage(page, 3);
  await pause(500);
  await page.keyboard.press('Escape');
  await page.click('#btnArea');
  const box = await page.locator('.page[data-page="3"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.075, box.y + box.height * 0.315);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.975, box.y + box.height * 0.86, { steps: slow ? 25 : 4 });
  await page.mouse.up();
  await typeSlow(page, '.annot.active .annot-note', 'Memorise all 5 states + the 6 arrows. Waiting → Ready, never straight to Running.', slow ? 30 : 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('e'); // ⭐ exam-relevant
  await pause(900);

  await gotoPage(page, 5);
  await selectText(page, 5, 'Optimal average waiting time.');
  await page.click('#selNote');
  await typeSlow(page, '.annot.active .annot-note', 'Only optimal if burst times are known in advance (they usually aren\'t).', slow ? 30 : 0);
  await selectText(page, 5, 'fixed time quantum');
  await page.click('#selToolbar .swatch[data-color="green"]');
  await page.keyboard.press('Escape');
  await page.keyboard.press('q'); // ❓ question for the tutorial
  // circle the second time slice (P2) in the Gantt chart with the red pen
  await page.keyboard.press('d');
  await page.click('.dtool[data-tool="pen"]');
  await page.click('.dcolor[data-color="red"]');
  await page.click('.dsize[data-size="1"]');
  {
    const g = await page.locator('.page[data-page="5"]').boundingBox();
    const cx = 0.385, cy = 0.705, rx = 0.06, ry = 0.095;
    await page.mouse.move(g.x + g.width * (cx + rx), g.y + g.height * cy);
    await page.mouse.down();
    for (let i = 1; i <= 36; i++) {
      const t = (i / 36) * Math.PI * 2.1;
      await page.mouse.move(g.x + g.width * (cx + rx * Math.cos(t)), g.y + g.height * (cy + ry * Math.sin(t)));
      if (slow) await page.waitForTimeout(12);
    }
    await page.mouse.up();
  }
  await page.keyboard.press('Escape');
  await page.locator('.tab[data-tab="doc"]').click();
  await page.locator('#docNote').fill('Summary\n- Process = program + state (PCB)\n- 5 states, know the transitions\n- FCFS / SJF / RR: practise waiting-time calculations\n\nQuestions for the tutorial\n- What happens to the PCB when a process terminates?');
  await page.locator('.tab[data-tab="page"]').click();
  await page.keyboard.press('Escape');
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    // ---------- Stills (2x for crisp marketing images)
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await page.goto(BASE);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'start.png') });
    await page.click('#btnSample');
    await page.waitForSelector('.page canvas');
    await page.waitForTimeout(6500); // let the demo toast disappear
    await annotate(page);

    await gotoPage(page, 2);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.locator('.annot').first().click({ position: { x: 4, y: 4 } }).catch(() => {});
    await page.mouse.click(5, 5);
    await page.waitForTimeout(400);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'reader.png') });

    await gotoPage(page, 3);
    await page.locator('.annot .annot-quote').first().click();
    await page.waitForTimeout(1300);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'area-note.png') });

    await page.locator('.tab[data-tab="all"]').click();
    await page.fill('#searchInput', 'exam');
    await page.waitForTimeout(300);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'search.png') });
    await page.fill('#searchInput', '');
    await page.locator('.tab[data-tab="page"]').click();

    // Search in the slides + thumbnails
    await page.click('#btnThumbs');
    await gotoPage(page, 1);
    await page.keyboard.press('Control+f');
    await page.keyboard.type('waiting');
    await page.waitForTimeout(1200);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'find.png') });
    await page.keyboard.press('Escape');
    await page.click('#btnThumbs');

    // Study mode
    await page.mouse.click(5, 300);
    await page.keyboard.press('s');
    await page.selectOption('#studyScope', 'all');
    await page.click('#studyStart');
    for (let i = 0; i < 4; i++) {
      if (await page.locator('#cardFront img').count()) break;
      await page.keyboard.press(' ');
      await page.keyboard.press('2');
    }
    await page.waitForTimeout(500);
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'study.png') });
    await page.keyboard.press('Escape');

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await gotoPage(page, 5);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(400);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, 'dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

    // Export and render page 2 of the annotated PDF by opening it in the app.
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf"]')]);
    const exported = fs.readFileSync(await dl.path());
    fs.writeFileSync(path.join(OUT, 'example-export.pdf'), exported);
    const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
    await p2.addInitScript(() => { localStorage.setItem('theme', 'light'); localStorage.setItem('sidebarHidden', '1'); });
    await p2.goto(BASE);
    await p2.setInputFiles('#fileInput2', { name: 'Lecture 3 - with notes.pdf', mimeType: 'application/pdf', buffer: exported });
    await p2.waitForSelector('.page[data-page="2"] canvas');
    await gotoPage(p2, 2);
    await p2.waitForTimeout(500);
    const pg = p2.locator('.page[data-page="2"]');
    await pg.screenshot({ path: path.join(OUT, 'export-page.png') });
    await gotoPage(p2, 3);
    await p2.locator('.page[data-page="3"]').screenshot({ path: path.join(OUT, 'export-page-3.png') });

    // Mobile
    const m = await (await browser.newContext({ ...require('playwright').devices['iPhone 13'] })).newPage();
    await m.addInitScript(() => localStorage.setItem('theme', 'light'));
    await m.goto(BASE);
    await m.click('#btnSample');
    await m.waitForSelector('.page canvas');
    await m.waitForTimeout(6500);
    await annotate(m);
    await gotoPage(m, 2);
    await m.evaluate(() => document.activeElement && document.activeElement.blur());
    await m.waitForTimeout(400);
    await hideToast(m);
    await m.screenshot({ path: path.join(OUT, 'mobile.png') });

    // Social preview card (1200x630)
    const og = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
    const shot = fs.readFileSync(path.join(OUT, 'reader.png')).toString('base64');
    const icon = fs.readFileSync(path.join(ROOT, 'app', 'icons', 'icon.svg')).toString('base64');
    await og.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:linear-gradient(135deg,#eef3fd,#f7f5ef);">
      <div style="position:absolute;left:64px;top:70px;width:470px">
        <div style="display:flex;align-items:center;gap:14px"><img src="data:image/svg+xml;base64,${icon}" width="64"><span style="font-size:40px;font-weight:800;letter-spacing:-.02em;color:#1b2333">uni-pdf</span></div>
        <div style="font-size:52px;line-height:1.08;font-weight:800;letter-spacing:-.03em;color:#1b2333;margin-top:34px">Your lecture notes, <span style="background:linear-gradient(transparent 55%,#ffd60099 55%)">right on the slides.</span></div>
        <div style="font-size:23px;line-height:1.4;color:#545c6b;margin-top:24px">Highlight, annotate, export.<br>Free, offline, nothing uploaded.</div>
      </div>
      <img src="data:image/png;base64,${shot}" style="position:absolute;left:580px;top:80px;width:820px;border-radius:14px;box-shadow:0 20px 60px rgba(20,40,90,.25);border:1px solid #d6dbe6">
    </body></html>`);
    await og.waitForTimeout(300);
    await og.screenshot({ path: path.join(OUT, 'og-image.png') });

    // ---------- Demo video
    const vdir = path.join(OUT, '.video');
    fs.rmSync(vdir, { recursive: true, force: true });
    const vctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, recordVideo: { dir: vdir, size: { width: 1280, height: 760 } } });
    const v = await vctx.newPage();
    await v.addInitScript(() => localStorage.setItem('theme', 'light'));
    await v.goto(BASE);
    await v.waitForTimeout(1200);
    await v.click('#btnSample');
    await v.waitForSelector('.page canvas');
    await v.waitForTimeout(1500);
    await annotate(v, { slow: 1 });
    await gotoPage(v, 2);
    await v.waitForTimeout(800);
    await v.locator('.tab[data-tab="all"]').click();
    await v.waitForTimeout(600);
    await v.locator('#searchInput').pressSequentially('exam', { delay: 120 });
    await v.waitForTimeout(1800);
    await v.click('#btnExport');
    await v.waitForTimeout(1500);
    await v.keyboard.press('Escape');
    await v.waitForTimeout(500);
    const vpath = await v.video().path();
    await vctx.close();

    try {
      const mp4 = path.join(OUT, 'demo.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.6', '-i', vpath, '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', mp4]);
      const gif = path.join(OUT, 'demo.gif');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.6', '-i', vpath, '-vf', 'fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', gif]);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-4', '-i', mp4, '-frames:v', '1', path.join(OUT, 'demo-poster.jpg')]);
    } catch (e) {
      console.warn('ffmpeg not available or failed; kept the raw .webm', e.message);
      fs.copyFileSync(vpath, path.join(OUT, 'demo.webm'));
    }
    fs.rmSync(vdir, { recursive: true, force: true });
    console.log('screenshots written to', OUT);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
