const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher mobile controls keep usable touch targets and compact filters',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.bosDispatcherMobile')).toBeVisible();

  const touchTargets=[
    page.locator('.dmNewOrder'),
    page.locator('.dmMetrics button').first(),
    page.locator('.dmShortcuts button').first(),
    page.locator('.dmCardActions .secondary').first(),
    page.locator('.dmAssignAction').first(),
    page.locator('.dmDateTimeAction').first()
  ];
  for(const target of touchTargets){
    const box=await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const master=await page.locator('#bosOrderMaster').boundingBox();
  const source=await page.locator('#bosOrderSource').boundingBox();
  expect(master).not.toBeNull();
  expect(source).not.toBeNull();
  expect(Math.abs(master.y-source.y)).toBeLessThan(2);
  expect(source.x).toBeGreaterThan(master.x);

  const searchFont=await page.locator('#bosOrderSearch').evaluate(el=>getComputedStyle(el).fontSize);
  expect(parseFloat(searchFont)).toBeGreaterThanOrEqual(16);
});

test('very narrow dispatcher screen stacks advanced selects without overflow',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:320,height:700});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.bosDispatcherMobile')).toBeVisible();

  const master=await page.locator('#bosOrderMaster').boundingBox();
  const source=await page.locator('#bosOrderSource').boundingBox();
  expect(master).not.toBeNull();
  expect(source).not.toBeNull();
  expect(source.y).toBeGreaterThan(master.y);

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
