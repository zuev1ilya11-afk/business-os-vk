const { test, expect } = require('@playwright/test');

test('master price memo patch is loaded and contains clear price layout', async ({ page }) => {
  await page.goto('/');
  const source = await page.locator('html').evaluate(() => document.documentElement.innerHTML);
  expect(source).toContain('master-price-memo-v131.js');

  const js = await (await page.request.get('/master-price-memo-v131.js')).text();
  expect(js).toContain("kind!=='price'");
  expect(js).toContain('bosPriceRow');
  expect(js).toContain('Выберите вид работы');
  expect(js).toContain('Не удалось загрузить прайс');
});
