const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
for(const comment of ['', 'Delivery tomorrow', 'Доставка завтра'])test(`contact submission preserves comment ${JSON.stringify(comment)}`,async({page},info)=>{
 const requests=[],failures=[],errors=[];
 page.on('request',r=>{if(r.url().includes('master-workflow-api'))requests.push({url:r.url(),method:r.method(),body:r.postData()})});
 page.on('requestfailed',r=>{if(r.url().includes('master-workflow-api'))failures.push({url:r.url(),failure:r.failure()})});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const native=window.fetch;window.__contactNativeFailures=[];window.fetch=async function(input,init){try{return await native.call(this,input,init)}catch(e){window.__contactNativeFailures.push({url:String(input),body:init?.body,keepalive:init?.keepalive,name:e.name,message:e.message});throw e}}});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const {db}=await fullStack(page,'master');Object.assign(db.tables.orders[0],{phone:'+79990000002',scheduled_date:null,scheduled_time:null,time_slot:null});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 await page.locator('.bosCompactClient a[aria-label^="Позвонить клиенту"]').first().dispatchEvent('click');
 const form=page.locator('#masterContactResultForm');await expect(form).toBeVisible();await expect.poll(()=>db.tables.orders[0].master_contact_history?.length).toBe(1);
 await form.locator('input[value="waiting_delivery"]').check();if(comment)await form.locator('[name=comment]').fill(comment);
 try{
  await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();
  await expect(form).toHaveCount(0);expect(db.tables.orders[0].master_contact_comment||'').toBe(comment);expect(db.tables.orders[0].master_contact_history).toHaveLength(1);
 }finally{
  const native=await page.evaluate(()=>window.__contactNativeFailures),message=await form.count()?await form.locator('.bosContactResultMsg').textContent():'closed';
  const diagnostic=JSON.stringify({requests,failures,errors,native,message},null,2);console.log(diagnostic);await info.attach('contact-transport.json',{body:diagnostic,contentType:'application/json'});
 }
});
