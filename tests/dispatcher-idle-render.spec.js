const {test,expect}=require('@playwright/test');const {fullStack}=require('./helpers/full-stack.cjs');
test('mobile orders settle without self-triggered DOM writes and tomorrow count still updates',async({page})=>{
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.setViewportSize({width:390,height:844});const {db}=await fullStack(page,'dispatcher');db.tables.orders[0].scheduled_date='2026-10-02';
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_DISPATCHER_ORDERS_V3);await page.locator('nav [data-page=orders]').click();
 await expect(page.locator('.dmv3TomorrowFilter')).toContainText('Завтра 1');
 const settled=()=>expect.poll(()=>page.evaluate(async()=>{
  let records=0;const observer=new MutationObserver(xs=>records+=xs.length);observer.observe(document.getElementById('content'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  await new Promise(resolve=>setTimeout(resolve,400));observer.disconnect();return records;
 }),{timeout:5000}).toBe(0);
 await settled();
 await page.evaluate(()=>{state.orders.find(o=>o.id==='12').scheduled_date='2026-10-02';show('orders')});await expect(page.locator('.dmv3TomorrowFilter')).toContainText('Завтра 2');await settled();
 for(let i=0;i<3;i++){await page.locator('nav [data-page=home]').click();await page.locator('nav [data-page=orders]').click()}
 await expect(page.locator('.dmv3TomorrowFilter')).toHaveCount(1);await settled();
 await page.locator('.dmv3TomorrowShortcut').click();await expect(page.locator('#bosOrderList .opsCompactOrder:visible')).toHaveCount(2);
});
