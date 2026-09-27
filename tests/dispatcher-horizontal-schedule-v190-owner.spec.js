const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('owner gets dispatcher v190 horizontal schedule on desktop',async({page})=>{
  await fullStack(page,'owner');
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root.dh190Root:visible')).toBeVisible();
  await expect(page.locator('#content .dbBoard')).toHaveClass(/dh190Board/);
  await expect(page.locator('.dh190Title')).toContainText('Горизонтальное расписание дня');
});
