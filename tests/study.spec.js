// Tests for the v1.1 study features: search in slides, thumbnails, page flags,
// flashcards, Anki export and library search/backup.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const APP = '/app/?nosw';

async function openDemo(page) {
  await page.goto(APP);
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
  await expect(page.locator('.page[data-page="1"] .textLayer span').first()).toBeAttached();
}

async function gotoPage(page, n) {
  await page.fill('#pageInput', String(n));
  await page.press('#pageInput', 'Enter');
  await expect(page.locator(`.page[data-page="${n}"] .textLayer span`).first()).toBeAttached();
  await expect(page.locator('#sbPageNum')).toHaveText(String(n));
}

async function noteOn(page, pageNum, needle, note) {
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
  await expect(page.locator('#selToolbar')).toBeVisible();
  await page.click('#selNote');
  await page.locator('.annot.active .annot-note').fill(note);
  await page.keyboard.press('Escape');
}

const download = async (page, kind) => {
  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
  return fs.readFileSync(await dl.path());
};

test('search in the slides finds text on pages that are not rendered yet', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#findInput')).toBeFocused();
  await page.keyboard.type('round robin');
  await expect(page.locator('#findCount')).toHaveText('1 of 3'); // twice on slide 5, once in the exam tip on 6
  await expect(page.locator('#pageInput')).toHaveValue('5');
  await expect(page.locator('.page[data-page="5"] .find-hit.current')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#findCount')).toHaveText('2 of 3');
  await page.keyboard.press('Enter');
  await expect(page.locator('#findCount')).toHaveText('3 of 3');
  await expect(page.locator('#pageInput')).toHaveValue('6');
  await expect(page.locator('.page[data-page="6"] .find-hit.current')).toHaveCount(1);
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#findCount')).toHaveText('2 of 3');
  await page.fill('#findInput', 'nonexistentword');
  await expect(page.locator('#findCount')).toHaveText('No matches');
  await page.keyboard.press('Escape');
  await expect(page.locator('#findBar')).toBeHidden();
  await expect(page.locator('.find-hit')).toHaveCount(0);
});

test('thumbnails show every page, mark the current one and navigate', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('t');
  await expect(page.locator('#thumbs')).toBeVisible();
  await expect(page.locator('.thumb')).toHaveCount(6);
  await expect(page.locator('.thumb[data-page="1"] canvas')).toBeAttached();
  await page.click('.thumb[data-page="4"]');
  await expect(page.locator('#pageInput')).toHaveValue('4');
  await expect(page.locator('.thumb.current')).toHaveAttribute('data-page', '4');
  // panel state is remembered
  await page.reload();
  await expect(page.locator('#thumbs')).toBeVisible();
});

test('page flags: mark, filter, persist and export', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 3);
  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('e');
  await expect(page.locator('#flagExam')).toHaveAttribute('aria-pressed', 'true');
  await gotoPage(page, 5);
  await page.click('#flagAsk');
  await expect(page.locator('#flagAsk')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.tab[data-tab="all"]').click();
  await page.click('.chip[data-filter="exam"]');
  await expect(page.locator('#allList h4')).toHaveText(['Page 3']);
  await expect(page.locator('#allList h4 .flag-ic.exam')).toHaveCount(1);
  await page.click('.chip[data-filter="ask"]');
  await expect(page.locator('#allList h4')).toHaveText(['Page 5']);
  await expect(page.locator('#allList h4 .flag-ic.ask')).toHaveCount(1);

  await expect(page.locator('#saveState')).toHaveText('Saved ✓');
  await page.reload();
  await gotoPage(page, 3);
  await page.locator('.tab[data-tab="page"]').click();
  await expect(page.locator('#flagExam')).toHaveAttribute('aria-pressed', 'true');

  const md = (await download(page, 'md')).toString();
  expect(md).toContain('**⭐ Exam-relevant:** page 3');
  expect(md).toContain('**❓ Questions to ask:** page 5');
  expect(md).toContain('## Page 3 ⭐');
  const pdf = await download(page, 'pdf');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('study mode: review cards, grade them, and the schedule is saved', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('s');
  await expect(page.locator('#studySummary')).toContainText('No cards yet');
  await page.keyboard.press('Escape');

  await gotoPage(page, 2);
  await noteOn(page, 2, 'context switch', 'saving and restoring CPU state');
  await noteOn(page, 2, 'program in execution', 'definition of a process');
  // an area card on the diagram
  await gotoPage(page, 3);
  await page.click('#btnArea');
  const box = await page.locator('.page[data-page="3"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.33);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.85, { steps: 4 });
  await page.mouse.up();
  await page.locator('.annot.active .annot-note').fill('the 5 process states');
  await page.keyboard.press('Escape');

  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('s');
  await expect(page.locator('#studySummary')).toContainText('3 cards in this lecture · 3 due');
  await page.click('#studyStart');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('#cardBack')).toBeHidden();
    const img = page.locator('#cardFront img');
    if (await img.count()) await expect(img).toHaveAttribute('src', /^data:image\/png/);
    await page.keyboard.press(' ');
    await expect(page.locator('#cardBack')).toBeVisible();
    seen.push(await page.locator('#cardBack').textContent());
    await page.keyboard.press(i === 0 ? '1' : '2'); // first card: "again"
  }
  // the "again" card comes back once more
  await expect(page.locator('#studyCard')).toBeVisible();
  await page.keyboard.press(' ');
  await page.keyboard.press('3');
  await expect(page.locator('#studyDoneText')).toContainText('You reviewed 4 cards (1 needed another try)');
  expect(seen.sort()).toEqual(['definition of a process', 'saving and restoring CPU state', 'the 5 process states']);
  await page.click('#studyFinish');

  await expect(page.locator('#saveState')).toHaveText('Saved ✓');
  await page.reload();
  await expect(page.locator('#pageCount')).toHaveText('6');
  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('s');
  await expect(page.locator('#studySummary')).toContainText('3 cards in this lecture · 0 due');
  await expect(page.locator('#studyScope')).toHaveValue('all');
});

test('Anki export contains one card per note', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 2);
  await noteOn(page, 2, 'context switch', 'saving\nand restoring');
  const txt = (await download(page, 'anki')).toString();
  const lines = txt.trim().split('\n');
  expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3']);
  expect(lines).toHaveLength(4);
  const [front, back, tags] = lines[3].split('\t');
  expect(front).toContain('context switch');
  expect(back).toBe('saving<br>and restoring');
  expect(tags).toContain('page_2');
});

test('library search finds notes in every lecture and opens the right page', async ({ page }) => {
  await openDemo(page);
  await gotoPage(page, 5);
  await noteOn(page, 5, 'fixed time quantum', 'usually 10 to 100 ms');
  await page.keyboard.press('l');
  await page.fill('#libSearch', '100 ms');
  await expect(page.locator('.lib-hit')).toHaveCount(1);
  await expect(page.locator('.lib-hit-where')).toContainText('page 5');
  await page.fill('#libSearch', 'zzz-nothing');
  await expect(page.locator('.lib-item')).toHaveCount(0);
  await page.fill('#libSearch', '100 ms');
  await page.click('.lib-hit');
  await expect(page.locator('#pageInput')).toHaveValue('5');
});

test('full backup restores PDFs and notes into an empty browser', async ({ page, browser }) => {
  await openDemo(page);
  await gotoPage(page, 2);
  await noteOn(page, 2, 'context switch', 'kept in the backup');
  await page.keyboard.press('e');
  await page.keyboard.press('l');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackupAll')]);
  const backup = fs.readFileSync(await dl.path());
  expect(JSON.parse(backup.toString()).docs).toHaveLength(1);

  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  await fresh.goto(APP);
  await fresh.click('#btnSample'); // need at least one lecture for the library tools to show
  await expect(fresh.locator('#pageCount')).toHaveText('6');
  await fresh.keyboard.press('l');
  await fresh.click('#btnRestoreAll');
  await fresh.setInputFiles('#restoreAllInput', { name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(fresh.locator('#askTitle')).toHaveText('Some lectures are already here');
  await fresh.click('#askOk');
  await expect(fresh.locator('#toastMsg')).toContainText('Backup restored: 0 added, 1 updated');
  await fresh.click('.lib-item');
  await gotoPage(fresh, 2);
  await expect(fresh.locator('.annot-note')).toHaveValue('kept in the backup');
  await expect(fresh.locator('#flagExam')).toHaveAttribute('aria-pressed', 'true');
  await ctx.close();
});
