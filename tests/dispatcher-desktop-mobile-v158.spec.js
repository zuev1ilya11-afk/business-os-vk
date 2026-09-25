const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher desktop keeps attention and selected order visible in compact three-column board',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_DISPATCHER_DESKTOP_MOBILE_V158);
  await page.locator('nav [data-page=orders]').click();

  const layout=page.locator('.dbBoard .dbLayout');
  const attention=page.locator('.dbBoard .dbAttention');
  const detail=page.locator('.dbBoard #dispatchBoardDetail');
  await expect(layout).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(detail).toBeVisible();

  const css=await layout.evaluate(node=>({
    display:getComputedStyle(node).display,
    columns:getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length,
    attention:getComputedStyle(node.querySelector('.dbAttention')).position,
    detail:getComputedStyle(node.querySelector('#dispatchBoardDetail')).position
  }));
  expect(css.display).toBe('grid');
  expect(css.columns).toBeGreaterThanOrEqual(3);
  expect(css.attention).toBe('sticky');
  expect(css.detail).toBe('sticky');
});