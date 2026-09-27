const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

test('master can open an order during slow workflow script delivery', async ({page}) => {
  await page.setViewportSize({width: 430, height: 900});
  const {db}=await fullStack(page, 'master');
  db.tables.orders[0].phone='+79991234567';
  await page.route('**/master-workflow-v25.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto('/', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page="orders"]').click();
  await page.locator('.bosHandsMiniCard').first().click();
  const workflow=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(workflow).toHaveCount(1);
  await expect(workflow.getByRole('button',{name:/Договориться|Выехал/})).toBeVisible();
  await expect(workflow.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Я на месте', exact: true})).toHaveCount(0);
});
