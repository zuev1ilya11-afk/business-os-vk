const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

for(const role of ['master']){
  test(`${role} cannot open or create a reclamation`,async({page})=>{
    const {db}=await fullStack(page,role);
    db.tables.orders[0].status='Выполнена';
    await page.goto('/');
    await expect(page.locator('#authGate')).toBeHidden();
    await expect(page.getByRole('heading',{name:'Претензии',exact:true})).toHaveCount(0);
    await page.evaluate(()=>window.openOrder('11'));
    await expect(page.getByRole('button',{name:'Открыть претензию',exact:true})).toHaveCount(0);
    await page.evaluate(()=>window.openReopenClaimForm?.('11'));
    await expect(page.locator('#claimForm')).toHaveCount(0);
  });
}

test('dispatcher can open reclamation form for a completed order',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].status='Выполнена';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const button=page.getByRole('button',{name:'Открыть претензию',exact:true});
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#claimForm')).toBeVisible();
});