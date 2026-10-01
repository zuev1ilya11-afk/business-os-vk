const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test('direct draft amount editing keeps the persisted source and server net amount after save',async({page})=>{
 const {db}=await fullStack(page,'owner');
 Object.assign(db.tables.orders[0],{source:'Телефон',external_source:'mini_app',original_amount:1000,amount:800,uncompleted_work_amount:200,master_payout:442,phone:'+79991234567',work:'Установка карниза'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrderForm('11'));
 const form=page.locator('#orderForm');
 // The existing edit form preserves source; channel selection belongs to creation.
 await expect(form.locator('[name="source"]')).toHaveCount(0);
 await expect(form.locator('#bosMasterPay')).toContainText('480');
 await expect(form.locator('#bosPricingRule')).toContainText('Компания 40%');
 await form.locator('#bosPhone').fill('9991234567');
 await form.locator('[name="original_amount"]').fill('1200');await expect(form.locator('#bosMasterPay')).toContainText('600');
 await form.locator('button[type="submit"]').click();await expect(form).toHaveCount(0);
 expect(db.tables.orders[0].source).toBe('Телефон');
 expect(db.tables.orders[0].amount).toBe(1000);expect(db.tables.orders[0].master_payout).toBe(600);
 expect(await page.evaluate(()=>state.orders.find(o=>String(o.id)==='11').amount)).toBe(1000);
});
