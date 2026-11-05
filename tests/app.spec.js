// End-to-end tests for the uni-pdf app. Run: npm test
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', 'app', 'sample-lecture.pdf');
const APP = '/app/?nosw';

async function openDemo(page) {
  await page.goto(APP);
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
  await expect(page.locator('.page[data-page="1"] .textLayer span').first()).toBeVisible();
}

async function gotoPage(page, n) {
  await page.fill('#pageInput', String(n));
  await page.press('#pageInput', 'Enter');
  await expect(page.locator(`.page[data-page="${n}"] .textLayer span`).first()).toBeAttached();
  await expect(page.locator('#sbPageNum')).toHaveText(String(n));
}

// Select the text of the first text-layer span on a page containing `needle`.
async function selectText(page, pageNum, needle) {
  await page.evaluate(({ pageNum, needle }) => {
    const spans = [...document.querySelectorAll(`.page[data-page="${pageNum}"] .textLayer span`)];
    const s = spans.find((x) => x.textContent.includes(needle));
    if (!s) throw new Error('text not found: ' + needle);
    const t = s.firstChild;
    const i = t.data.indexOf(needle);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + needle.length);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { pageNum, needle });
  await expect(page.locator('#selToolbar')).toBeVisible();
}

test('start screen shows onboarding and opens the demo lecture', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await expect(page.locator('#libEmpty')).toBeVisible();
  await expect(page.locator('#appVersion')).toContainText('uni-pdf v');
  await page.click('#btnSample');
  await expect(page.locator('#docTitle')).toContainText('Processes & Scheduling');
  await expect(page.locator('.page')).toHaveCount(6);
  await expect(page.locator('.page[data-page="1"] canvas')).toBeAttached();
  expect(errors).toEqual([]);
});

test('opening a PDF through the file picker works and it appears in the library', async ({ page }) => {
  await page.goto(APP);
  await page.setInputFiles('#fileInput2', SAMPLE);
  await expect(page.locator('#pageCount')).toHaveText('6');
  await page.keyboard.press('l');
  await expect(page.locator('.lib-item')).toHaveCount(1);
  await expect(page.locator('.lib-item .lib-meta')).toContainText('6 pages');
});

test('rejects files that are not PDFs', async ({ page }) => {
  await page.goto(APP);
  await page.setInputFiles('#fileInput2', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('#toastMsg')).toHaveText('That is not a PDF file.');
});

test('highlight, note, page note and lecture note persist across reloads', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 2);

  await selectText(page, 2, 'program in execution');
  await page.click('#selToolbar .swatch[data-color="green"]');
  await expect(page.locator('.page[data-page="2"] .hl.green')).toHaveCount(1);

  await selectText(page, 2, 'context switch');
  await page.keyboard.press('n');
  const note = page.locator('.annot.active .annot-note');
  await expect(note).toBeFocused();
  await note.fill('Saving and restoring CPU registers. Costs time!');

  await page.locator('#pageNote').fill('Lecturer: PCB questions are always on the exam.');
  await page.locator('.tab[data-tab="doc"]').click();
  await page.locator('#docNote').fill('Read chapter 3 before Thursday.');
  await expect(page.locator('#saveState')).toHaveText('Saved ✓');

  await page.reload();
  await expect(page.locator('#pageCount')).toHaveText('6');
  await gotoPage(page, 2);
  await expect(page.locator('.page[data-page="2"] .hl')).toHaveCount(2);
  await page.locator('.tab[data-tab="page"]').click();
  await expect(page.locator('#pageNote')).toHaveValue('Lecturer: PCB questions are always on the exam.');
  await expect(page.locator('.annot-note')).toHaveValue('Saving and restoring CPU registers. Costs time!');
  await page.locator('.tab[data-tab="doc"]').click();
  await expect(page.locator('#docNote')).toHaveValue('Read chapter 3 before Thursday.');

  // Search across all notes
  await page.locator('.tab[data-tab="all"]').click();
  await page.fill('#searchInput', 'registers');
  await expect(page.locator('#allList mark')).toHaveText('registers');
  await expect(page.locator('#allList .all-item')).toHaveCount(1);
});

test('area note on a diagram', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 3);
  await page.keyboard.press('a');
  const box = await page.locator('.page[data-page="3"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.page[data-page="3"] .hl.area')).toHaveCount(1);
  await expect(page.locator('body')).not.toHaveClass(/area-mode/); // one box per use
  const note = page.locator('.annot.active .annot-note');
  await expect(note).toBeFocused();
  await note.fill('Draw this in the exam');
  await expect(page.locator('.annot.active .annot-quote')).toContainText('Ready');
});

test('deleting a highlight can be undone', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 2);
  await selectText(page, 2, 'context switch');
  await page.keyboard.press('n');
  await page.locator('.annot.active .annot-note').fill('important');
  await page.locator('.annot .annot-del').click();
  await expect(page.locator('.page[data-page="2"] .hl')).toHaveCount(0);
  await page.locator('#toastAction').click();
  await expect(page.locator('.page[data-page="2"] .hl')).toHaveCount(1);
  await expect(page.locator('.annot-note')).toHaveValue('important');
});

test('exports: annotated PDF, Markdown and JSON backup', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 2);
  await selectText(page, 2, 'context switch');
  await page.keyboard.press('n');
  await page.locator('.annot.active .annot-note').fill('Unicode check: λ ≤ π ∑ äöü');
  await page.locator('#pageNote').fill('Page two note');

  const exportAs = async (kind) => {
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
    return fs.readFileSync(await dl.path());
  };

  const pdf = await exportAs('pdf');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(fs.statSync(SAMPLE).size);

  const md = (await exportAs('md')).toString();
  expect(md).toContain('## Page 2');
  expect(md).toContain('> context switch');
  expect(md).toContain('Unicode check: λ ≤ π ∑ äöü');
  expect(md).toContain('Page two note');

  const json = JSON.parse((await exportAs('json')).toString());
  expect(json.app).toBe('lecture-pdf-notes');
  expect(json.annotations).toHaveLength(1);
});

test('editable PDF round-trip restores notes on a fresh browser', async ({ page, browser }) => {
  await openDemo(page);
  await gotoPage(page, 2);
  await selectText(page, 2, 'context switch');
  await page.keyboard.press('n');
  await page.locator('.annot.active .annot-note').fill('travels with the PDF');
  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf-edit"]')]);
  const file = await dl.path();

  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  await fresh.goto(APP);
  await fresh.setInputFiles('#fileInput2', { name: 'exported.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(file) });
  await expect(fresh.locator('#pageCount')).toHaveText('6'); // the clean original, not the annotated pages
  await expect(fresh.locator('#docTitle')).toContainText('Processes & Scheduling');
  await gotoPage(fresh, 2);
  await expect(fresh.locator('.annot-note')).toHaveValue('travels with the PDF');
  await ctx.close();
});

test('backup restore replaces notes', async ({ page }) => {
  await openDemo(page);
  await page.locator('#pageNote').fill('original');
  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="json"]')]);
  const backup = fs.readFileSync(await dl.path());
  await page.locator('#pageNote').fill('changed');
  await page.click('#btnExport');
  await page.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('#askDialog')).toBeVisible();
  await expect(page.locator('#askTitle')).toHaveText('Restore this backup?');
  await page.click('#askOk');
  await expect(page.locator('#pageNote')).toHaveValue('original');
});

test('keyboard: navigation, zoom and help dialog', async ({ page }) => {
  await openDemo(page);
  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#pageInput')).toHaveValue('2');
  const before = await page.locator('#btnZoomLabel').textContent();
  await page.keyboard.press('+');
  await expect(page.locator('#btnZoomLabel')).not.toHaveText(before);
  await page.keyboard.press('0');
  await expect(page.locator('#btnZoomLabel')).toHaveText(before);
  await page.keyboard.press('?');
  await expect(page.locator('#helpDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpDialog')).toBeHidden();
});

test('works offline after the first visit (service worker)', async ({ page, context }) => {
  await page.goto('/app/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await page.evaluate(async () => {
    // wait until lazy assets are cached too
    for (let i = 0; i < 50; i++) {
      const c = await caches.open((await caches.keys())[0]);
      if (await c.match('vendor/dejavu-fonts.js')) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf"]')]);
  expect(fs.readFileSync(await dl.path()).subarray(0, 5).toString()).toBe('%PDF-');
  await context.setOffline(false);
});

test('works when index.html is opened straight from disk (file://)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
  await expect(page.locator('.page[data-page="1"] canvas')).toBeAttached();
  await selectText(page, 1, 'Processes');
  await page.click('#selToolbar .swatch[data-color="yellow"]');
  await expect(page.locator('.page[data-page="1"] .hl')).toHaveCount(1);
  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf"]')]);
  expect(fs.readFileSync(await dl.path()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(errors).toEqual([]);
});
