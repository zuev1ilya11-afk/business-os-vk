const { test, expect } = require('@playwright/test');

test('master price memo patch is loaded and contains clear price layout', async ({ page }) => {
  await page.route('https://**/*',r=>r.request().url().includes('vk-bridge')
    ?r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'})
    :r.fulfill({status:401,json:{ok:false,error:'Требуется вход'}}));
  await page.goto('/');
  const asset=await page.evaluate(()=>BOS_ASSET_URL('master-price-memo-v131.js'));
  expect(asset).toContain('startup-shell.bundle.js?build=');
  await expect(page.locator('script[src*="startup-shell.bundle.js"]')).toHaveCount(1);
  expect((await page.locator('style').allTextContents()).join('\n')).toContain('.bosPriceImportantText');

  const js = await (await page.request.get(asset)).text();
  expect(js).toContain("kind!=='price'");
  expect(js).toContain('bosPriceRow');
  expect(js).toContain('Выберите вид работы');
  expect(js).toContain('Не удалось загрузить прайс');
});
