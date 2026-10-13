const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher mobile controls keep usable touch targets and compact filters',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('#bosOrderList')).toBeVisible();

  await page.locator('.bosOpsSecondaryActions summary').first().click();await page.locator('.bosOpsSecondaryActions summary').last().click();
  const touchTargets=[page.getByRole('button',{name:'+ Новая',exact:true}),page.getByRole('button',{name:'Фильтры',exact:true}),page.locator('.bosOrderFilters button').first(),page.locator('.dmShortcuts button').first(),page.locator('#bosOrderList .bosOpsListOpen').first(),page.locator('.dmCardActions .secondary').first(),page.locator('.dmAssignAction').first(),page.locator('.dmDateTimeAction').first()];
  for(const target of touchTargets){
    await expect.poll(async()=>(await target.boundingBox())?.height||0).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button',{name:'Фильтры',exact:true}).click();const master=await page.locator('[data-original-id=bosOrderMaster]').boundingBox();
  const source=await page.locator('[data-original-id=bosOrderSource]').boundingBox();
  expect(master).not.toBeNull();
  expect(source).not.toBeNull();
  expect(source.y).toBeGreaterThan(master.y);

  await page.getByRole('button',{name:'Отмена',exact:true}).click();const searchFont=await page.locator('#bosOrderSearch').evaluate(el=>getComputedStyle(el).fontSize);
  expect(parseFloat(searchFont)).toBeGreaterThanOrEqual(16);
});

test('very narrow dispatcher screen stacks advanced selects without overflow',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:320,height:700});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('#bosOrderList')).toBeVisible();

  await page.getByRole('button',{name:'Фильтры',exact:true}).click();const master=await page.locator('[data-original-id=bosOrderMaster]').boundingBox();
  const source=await page.locator('[data-original-id=bosOrderSource]').boundingBox();
  expect(master).not.toBeNull();
  expect(source).not.toBeNull();
  expect(source.y).toBeGreaterThan(master.y);

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
