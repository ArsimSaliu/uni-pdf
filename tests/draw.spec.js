// Tests for drawing mode (pen, highlighter, eraser).
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const APP = '/app/?nosw';

async function openDemoAt(page, n) {
  await page.goto(APP);
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
  await page.fill('#pageInput', String(n));
  await page.press('#pageInput', 'Enter');
  await expect(page.locator(`.page[data-page="${n}"] .textLayer span`).first()).toBeAttached();
}

async function stroke(page, n, from, to) {
  const box = await page.locator(`.page[data-page="${n}"]`).boundingBox();
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

const inkStrokes = (page, n) => page.evaluate((n) => [...document.querySelectorAll(`.page[data-page="${n}"] .inkLayer g`)].map((g) => g.children.length), n);

test('draw strokes, they join into one drawing and survive a reload', async ({ page }) => {
  await openDemoAt(page, 3);
  await page.keyboard.press('d');
  await expect(page.locator('#drawBar')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/draw-mode/);
  await stroke(page, 3, [0.2, 0.5], [0.4, 0.6]);
  await stroke(page, 3, [0.2, 0.6], [0.4, 0.5]);
  expect(await inkStrokes(page, 3)).toEqual([2]); // same tool/colour/size → one drawing
  await page.click('.dcolor[data-color="red"]');
  await stroke(page, 3, [0.5, 0.5], [0.7, 0.5]);
  expect(await inkStrokes(page, 3)).toEqual([2, 1]);
  // text is not selected while drawing
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawBar')).toBeHidden();
  await expect(page.locator('#saveState')).toHaveText('Saved ✓');

  await page.reload();
  await expect(page.locator('#pageCount')).toHaveText('6');
  await expect.poll(() => inkStrokes(page, 3)).toEqual([2, 1]);
  // the drawing tool and colour are remembered
  await page.keyboard.press('d');
  await expect(page.locator('.dcolor[data-color="red"]')).toHaveClass(/active/);
});

test('eraser removes a stroke and undo brings it back', async ({ page }) => {
  await openDemoAt(page, 3);
  await page.click('#btnDraw');
  await stroke(page, 3, [0.2, 0.5], [0.6, 0.5]);
  await stroke(page, 3, [0.2, 0.7], [0.6, 0.7]);
  expect(await inkStrokes(page, 3)).toEqual([2]);
  await page.click('.dtool[data-tool="eraser"]');
  await stroke(page, 3, [0.4, 0.45], [0.4, 0.55]);
  expect(await inkStrokes(page, 3)).toEqual([1]);
  await stroke(page, 3, [0.4, 0.65], [0.4, 0.75]);
  expect(await inkStrokes(page, 3)).toEqual([]); // drawing removed completely
  await page.keyboard.press('Control+z');
  expect(await inkStrokes(page, 3)).toEqual([1]);
  await page.click('#drawUndo');
  expect(await inkStrokes(page, 3)).toEqual([2]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await inkStrokes(page, 3)).toEqual([]);
  await expect(page.locator('#drawUndo')).toBeDisabled();
});

test('a drawing can get a note, becomes a flashcard and is exported', async ({ page }) => {
  await openDemoAt(page, 3);
  await page.keyboard.press('d');
  await page.click('.dtool[data-tool="marker"]');
  await stroke(page, 3, [0.1, 0.5], [0.7, 0.5]);
  await page.keyboard.press('Escape');
  // click on the stroke opens its card
  const box = await page.locator('.page[data-page="3"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.locator('.annot.active .annot-quote')).toHaveText('✏ Drawing on page 3');
  await page.locator('.annot.active .annot-note').fill('state diagram, know it by heart');
  await page.keyboard.press('Escape');

  await page.keyboard.press('s');
  await page.selectOption('#studyScope', 'all');
  await page.click('#studyStart');
  await expect(page.locator('#cardFront img')).toHaveAttribute('src', /^data:image\/png/);
  await page.keyboard.press(' ');
  await expect(page.locator('#cardBack')).toContainText('state diagram');
  await page.keyboard.press('Escape');

  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="md"]')]);
  expect(fs.readFileSync(await dl.path()).toString()).toContain('> _(drawing)_');
  await page.click('#btnExport');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf-edit"]')]);
  const pdf = fs.readFileSync(await dl2.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  // the editable PDF carries the drawing back into the app
  const json = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const att = await doc.getAttachments();
    return JSON.parse(new TextDecoder().decode(att['lecture-notes.json'].content));
  }, pdf.toString('base64'));
  const ink = json.annotations.find((a) => a.type === 'ink');
  expect(ink.tool).toBe('marker');
  expect(ink.strokes[0].length).toBeGreaterThan(4);
});

test('drawing mode and area mode switch each other off', async ({ page }) => {
  await openDemoAt(page, 2);
  await page.keyboard.press('d');
  await page.keyboard.press('a');
  await expect(page.locator('body')).toHaveClass(/area-mode/);
  await expect(page.locator('body')).not.toHaveClass(/draw-mode/);
  await page.keyboard.press('d');
  await expect(page.locator('body')).toHaveClass(/draw-mode/);
  await expect(page.locator('body')).not.toHaveClass(/area-mode/);
});
