// Tests for the refreshed UI: tool switcher, menus, theme, command palette,
// library cards and courses, custom dialogs.
const { test, expect } = require('@playwright/test');

const APP = '/app/?nosw';

async function openDemo(page) {
  await page.goto(APP);
  await page.click('#btnSample');
  await expect(page.locator('#pageCount')).toHaveText('6');
}

test('tool switcher shows Select, Area or Draw as active', async ({ page }) => {
  await openDemo(page);
  await expect(page.locator('#btnSelect')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btnArea');
  await expect(page.locator('#btnArea')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btnSelect')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#btnDraw');
  await expect(page.locator('#btnDraw')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).not.toHaveClass(/area-mode/);
  await page.click('#btnSelect');
  await expect(page.locator('body')).not.toHaveClass(/draw-mode/);
  await expect(page.locator('#btnSelect')).toHaveAttribute('aria-pressed', 'true');
});

test('theme can be light, dark or follow the device, and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(APP);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // system default
  await page.click('#btnMore');
  await page.click('[data-theme-set="light"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#moreMenu')).toBeVisible(); // stays open while choosing
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.click('#btnMore');
  await page.click('[data-theme-set="system"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('command palette runs actions and opens lectures', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#cmdk')).toBeVisible();
  await page.keyboard.type('study');
  await expect(page.locator('.cmdk-item.sel .t')).toHaveText('Study flashcards');
  await page.keyboard.press('Enter');
  await expect(page.locator('#studyDialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('l');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('processes');
  await expect(page.locator('.cmdk-item.sel .t')).toContainText('Processes & Scheduling');
  await page.keyboard.press('Enter');
  await expect(page.locator('#reader')).toBeVisible();
});

test('library cards show a preview, progress, badges and can be grouped by course', async ({ page }) => {
  await openDemo(page);
  await page.fill('#pageInput', '3');
  await page.press('#pageInput', 'Enter');
  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('e');
  await expect(page.locator('#saveState')).toHaveText('Saved ✓');
  await page.keyboard.press('l');
  const card = page.locator('.lib-item').first();
  await expect(card.locator('.lib-thumb img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(card.locator('.lib-progress i')).toHaveAttribute('style', /width: 50%/);
  await expect(card.locator('.badge.exam')).toHaveText('1');

  await card.hover();
  await card.locator('.lib-course').click();
  await expect(page.locator('#askTitle')).toHaveText('Course');
  await page.fill('#askInput', 'Operating Systems');
  await page.click('#askOk');
  await expect(page.locator('.lib-group-head')).toContainText('Operating Systems');
  await expect(page.locator('#courseChips .chip')).toHaveText(['All courses', 'Operating Systems']);
});

test('removing a lecture asks first, in the app’s own dialog', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('l');
  const card = page.locator('.lib-item').first();
  await card.hover();
  await card.locator('.lib-del').click();
  await expect(page.locator('#askTitle')).toContainText('Remove');
  await page.click('#askCancel');
  await expect(page.locator('.lib-item')).toHaveCount(1);
  await card.hover();
  await card.locator('.lib-del').click();
  await page.click('#askOk');
  await expect(page.locator('.lib-item')).toHaveCount(0);
  await expect(page.locator('#libEmpty')).toBeVisible();
});

test('selection toolbar can copy the text and search for it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDemo(page);
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.page[data-page="1"] .textLayer span')].find((x) => x.textContent.includes('Scheduling'));
    const t = s.firstChild;
    const i = t.data.indexOf('Scheduling');
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 10);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.click('#selCopy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Scheduling');
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.page[data-page="1"] .textLayer span')].find((x) => x.textContent.includes('Scheduling'));
    const r = document.createRange();
    r.selectNodeContents(s);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.click('#selFind');
  await expect(page.locator('#findBar')).toBeVisible();
  await expect(page.locator('#findCount')).toHaveText(/of/);
});
