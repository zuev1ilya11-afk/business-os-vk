const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

for(const role of ['owner','manager','dispatcher'])test(`${role} gets dispatcher v190 horizontal schedule on desktop`,async({page})=>{
  await fullStack(page,role);
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root.dh190Root:visible')).toBeVisible();
  await expect(page.locator('#content .dbBoard')).toHaveClass(/dh190Board/);
  await expect(page.locator('.dh190Title')).toContainText('Расписание дня');
});

test('master cannot activate dispatcher workspace',async({page})=>{
  await fullStack(page,'master');
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  expect(await page.evaluate(()=>window.BOS_PERMISSIONS.canUseDispatcherWorkspace(state.user))).toBe(false);
  await expect(page.locator('.dbBoard,.du187Root')).toHaveCount(0);
  expect(await page.evaluate(()=>!!window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190)).toBe(false);
});

test('owner can still preview master orders',async({page})=>{
  const {master}=await fullStack(page,'owner');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(master=>{previewRole='master';previewUser=master;show('orders')},master);
  expect(await page.evaluate(()=>window.BOS_PERMISSIONS.isDispatcherWorkspaceActive(state.user))).toBe(false);
  await expect(page.locator('.dbBoard,.du187Root')).toHaveCount(0);
});
