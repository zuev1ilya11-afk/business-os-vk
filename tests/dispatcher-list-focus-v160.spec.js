const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('desktop dispatcher highlights attention orders and supports compact focus mode',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_LIST_FOCUS_V160?.version==='160');
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();

  const list=page.locator('.dbV94ListItems');
  const normal=page.locator('.dbV94ListCard[data-order-id="11"]');
  const attention=page.locator('.dbV94ListCard[data-order-id="12"]');
  await expect(page.locator('.dlf160Tools')).toBeVisible();
  await expect(list).toHaveClass(/dlf160Compact/);
  await expect(attention).toHaveClass(/dlf160NeedsAttention/);
  await expect(attention).toHaveClass(/dlf160MissingDate/);
  await expect(attention.locator('.dlf160Badges')).toContainText('Без даты');
  await expect(normal).not.toHaveClass(/dlf160NeedsAttention/);

  await page.locator('[data-dlf160-filter="attention"]').click();
  await expect(attention).toBeVisible();
  await expect(normal).toBeHidden();
  await expect(page.locator('.dq159DesktopActions[data-order-id="11"]')).toBeHidden();

  await page.locator('[data-dlf160-compact]').click();
  await expect(list).not.toHaveClass(/dlf160Compact/);
  await expect(page.locator('[data-dlf160-compact]')).toContainText('Компактно');
  expect(await page.evaluate(()=>localStorage.getItem('bos_dispatcher_compact_v160'))).toBe('comfortable');
});
