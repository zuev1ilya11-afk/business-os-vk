const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page,delivery){
 const {db}=await fullStack(page,'dispatcher');const order=db.tables.orders.find(x=>x.id==='12');
 Object.assign(order,{external_source:'hands',external_id:'hands:1234',status:'Выполнена',report_review_status:'approved',report_upload_token:'r1'});
 const calls=[];db.rpc=async(name,p)=>{calls.push({name,p});if(name==='bos_hands_report_retry'){delivery.state=p.p_received?'sent':'queued';delivery.uncertain=false;return {data:true}}return {data:structuredClone(delivery)}};
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106);
 await page.evaluate(()=>openOrder('12'));return calls;
}
test('accepted Hands report shows automatic delivery receipt inside order at mobile width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{state:'sent',step:3,sent_at:'2026-09-30T19:00:00Z'});
 const card=page.locator('#handsOrderActions');await expect(card).toContainText('Отчёт и файлы отправлены в Hands');
 await expect(card.locator('[data-hands-manual-report]')).toBeHidden();
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
test('uncertain delivery needs an explicit Hands check and preserves the queue version',async({page})=>{
 const version='00000000-0000-4000-8000-000000000001';const calls=await setup(page,{state:'attention',step:2,step_label:'Отчёт о выполнении',uncertain:true,version,error:'Hands не подтвердил отправку.'});
 const card=page.locator('#handsOrderActions');await expect(card).toContainText('Не подтверждено: Отчёт о выполнении');
 const retry=card.locator('[data-hands-retry]'),received=card.locator('[data-hands-received]');
 await expect(retry).toBeDisabled();await expect(received).toBeDisabled();
 await card.locator('[data-hands-not-received]').check();await received.click();
 await expect(card).toContainText('Отчёт и файлы отправлены в Hands');
 expect(calls.find(x=>x.name==='bos_hands_report_retry').p).toEqual({p_order:'12',p_version:version,p_confirm:true,p_received:true});
});
