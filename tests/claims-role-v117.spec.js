const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master cannot open claim from completed order',async({page})=>{
  const {db}=await fullStack(page,'master');
  Object.assign(db.tables.orders[0],{status:'Выполнена',completed_at:new Date().toISOString()});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.getByRole('button',{name:'Открыть рекламацию',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.openReopenClaimForm?.('11'));
  await expect(page.locator('#claimForm')).toHaveCount(0);
});

test('dispatcher can open claim from completed order',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{status:'Выполнена',completed_at:new Date().toISOString()});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const button=page.locator('#modalRoot').getByRole('button',{name:'Открыть рекламацию',exact:true});
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#claimForm')).toBeVisible();
});
