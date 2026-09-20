const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

test('master can open an order during slow workflow script delivery', async ({page}) => {
  await page.setViewportSize({width: 430, height: 900});
  await fullStack(page, 'master');
  await page.route('**/master-workflow-v25.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto('/', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page="orders"]').click();
  await page.locator('.bosHandsMiniCard').first().click();
  await expect(page.locator('.bosMasterWorkflow')).toHaveCount(1);
  await page.getByRole('button', {name: 'Выехал', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Я на месте', exact: true})).toBeVisible();
});
