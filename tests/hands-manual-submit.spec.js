const {test,expect}=require('@playwright/test');
const path=require('node:path');
const forms={
 assign:{open:'openHandsAssign',id:'handsAssignForm',message:'handsAssignMsg',action:'assignSpecialist',success:'Мастер назначен в Hands'},
 report:{open:'openHandsReport',id:'handsReportForm',message:'handsReportMsg',action:'sendReport',success:'Отчёт принят Hands'},
 file:{open:'openHandsFile',id:'handsFileForm',message:'handsFileMsg',action:'uploadFile',success:'Файл загружен в Hands'}
};
async function setup(page,kind,{network=false}={}){
 await page.setContent('<div class="modal"></div>');
 await page.evaluate(()=>{
  window.state={orders:[{id:'12',external_source:'hands',external_id:'hands:1234'}],masters:[{full_name:'Тестовый мастер'}],user:{role:'dispatcher'}};
  window.esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.openModal=html=>{document.querySelector('.modal').innerHTML=html};
  window.closeModal=()=>{window.closes++;document.querySelector('.modal').innerHTML=''};
  window.openOrder=id=>{window.openedOrder=id};window.closes=0;
  window.calls=[];window.responseMode='pending';window.attempts=0;
  window.fetch=async(url,init)=>{
   const body=JSON.parse(init.body);window.calls.push({url:String(url),body});
   if(body.action==='getHandsReportDelivery')return Response.json({ok:true,delivery:window.delivery||null});
   window.attempts++;
   const response=()=>{
    if(window.responseMode==='network')throw new TypeError('Failed to fetch');
    if(window.responseMode==='malformed')return new Response('<html>upstream failed</html>',{status:200});
    if(window.responseMode==='server')return Response.json({ok:false,error:'upstream failed'},{status:500});
    if(window.responseMode==='provider-server')return Response.json({ok:false,error:'HANDS_503: upstream failed'},{status:500});
    if(window.responseMode==='provider-rejection')return Response.json({ok:false,error:'HANDS_422: rejected'},{status:500});
    if(window.responseMode==='rejection')return Response.json({ok:false,error:'Не указан специалист'},{status:400});
    if(window.responseMode==='missing-order')return Response.json({ok:false,error:'ORDER_NOT_FOUND'},{status:404});
    if(window.responseMode==='routing'&&window.attempts===1)return Response.json({ok:false,error:'SERVICE_NOT_ALLOWED'},{status:404});
    return Response.json({ok:true,result:{}});
   };
   if(window.responseMode==='pending')return new Promise(resolve=>{window.resolveHands=()=>resolve(Response.json({ok:true,result:{}}))});
   return response();
  };
 });
 if(network)await page.addScriptTag({path:path.join(__dirname,'../network-direct-v86.js')});
 await page.addScriptTag({path:path.join(__dirname,'../hands-integration-v69.js')});
 await page.evaluate(open=>window[open]('12'),forms[kind].open);
 if(kind==='assign')await page.locator('[name=specialist]').selectOption('Тестовый мастер');
 if(kind==='file')await page.locator('#handsFileInput').setInputFiles({name:'photo.txt',mimeType:'text/plain',buffer:Buffer.from('test file')});
}
async function submit(page,kind,count=1){
 await page.evaluate(({id,count})=>{for(let i=0;i<count;i++)document.getElementById(id).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))},{id:forms[kind].id,count});
}
async function sendCount(page){return page.evaluate(()=>window.calls.filter(c=>c.body.action!=='getHandsReportDelivery').length)}
for(const kind of Object.keys(forms)){
 test(`${kind}: repeated submit makes one pending send and cannot replay success`,async({page})=>{
  await setup(page,kind);await submit(page,kind,2);
  await expect.poll(()=>sendCount(page)).toBe(1);
  const payload=await page.evaluate(()=>window.calls[0].body);
  expect(payload).toMatchObject({action:forms[kind].action,order_id:'1234'});
  if(kind==='assign')expect(payload.specialist).toBe('Тестовый мастер');
  if(kind==='report')expect(payload).toMatchObject({kind:'AGREED',outcome:'SUCCESS'});
  if(kind==='file')expect(payload).toMatchObject({file_name:'photo.txt',mime_type:'text/plain',relation:'SPECIALIST_PHOTO',base64:Buffer.from('test file').toString('base64')});
  await expect(page.locator(`#${forms[kind].id} button`)).toBeDisabled();
  await page.evaluate(()=>window.resolveHands());
  await expect(page.locator(`#${forms[kind].message}`)).toHaveText(forms[kind].success);
  await submit(page,kind);expect(await sendCount(page)).toBe(1);
 });
 test(`${kind}: explicit rejection permits a deliberate corrected retry`,async({page})=>{
  await setup(page,kind);await page.evaluate(()=>window.responseMode='rejection');await submit(page,kind);
  await expect(page.locator(`#${forms[kind].message}`)).toHaveText('Не указан специалист');
  await expect(page.locator(`#${forms[kind].id} button`)).toBeEnabled();
  await page.evaluate(()=>window.responseMode='success');await submit(page,kind);
  await expect(page.locator(`#${forms[kind].message}`)).toHaveText(forms[kind].success);
  expect(await sendCount(page)).toBe(2);
 });
}
test('file: lock starts before preprocessing and a read failure is recoverable without a send',async({page})=>{
 await setup(page,'file');
 await page.evaluate(()=>{
  window.fileReads=0;
  File.prototype.arrayBuffer=function(){window.fileReads++;return new Promise((resolve,reject)=>{window.rejectFile=()=>reject(new Error('Не удалось прочитать файл'));window.resolveFile=()=>resolve(new TextEncoder().encode('test').buffer)})};
 });
 await submit(page,'file',2);
 expect(await page.evaluate(()=>window.fileReads)).toBe(1);
 await expect(page.locator('#handsFileForm button')).toBeDisabled();expect(await sendCount(page)).toBe(0);
 await page.evaluate(()=>window.rejectFile());await expect(page.locator('#handsFileMsg')).toHaveText('Не удалось прочитать файл');
 await expect(page.locator('#handsFileForm button')).toBeEnabled();
 await page.evaluate(()=>window.responseMode='success');await submit(page,'file');await page.evaluate(()=>window.resolveFile());
 await expect(page.locator('#handsFileMsg')).toHaveText(forms.file.success);expect(await sendCount(page)).toBe(1);
});
for(const [mode,network] of [['network',false],['network',true],['malformed',false],['server',false],['provider-server',false]]){
 test(`report: uncertain ${mode} response${network?' with production routing':''} never replays`,async({page})=>{
  await setup(page,'report',{network});await page.evaluate(mode=>window.responseMode=mode,mode);await submit(page,'report');
  await expect(page.locator('#handsReportMsg')).toContainText('Проверьте результат в Hands');
  await expect(page.locator('#handsReportForm button')).toBeDisabled();
  await submit(page,'report');expect(await sendCount(page)).toBe(1);
 });
}
test('a provider 4xx wrapped by the backend is a known rejection and can be corrected',async({page})=>{
 await setup(page,'report');await page.evaluate(()=>window.responseMode='provider-rejection');await submit(page,'report');
 await expect(page.locator('#handsReportMsg')).toHaveText('HANDS_422: rejected');
 await expect(page.locator('#handsReportForm button')).toBeEnabled();
 await page.evaluate(()=>window.responseMode='success');await submit(page,'report');await expect(page.locator('#handsReportMsg')).toHaveText(forms.report.success);
 expect(await sendCount(page)).toBe(2);
});
for(const network of [false,true])test(`explicit routing denial can fail over safely${network?' with production routing':''}`,async({page})=>{
 await setup(page,'report',{network});await page.evaluate(()=>window.responseMode='routing');await submit(page,'report');
 await expect(page.locator('#handsReportMsg')).toHaveText(forms.report.success);expect(await sendCount(page)).toBe(2);
});
test('an application 404 is shown without automatic fallback replay',async({page})=>{
 await setup(page,'report');await page.evaluate(()=>window.responseMode='missing-order');await submit(page,'report');
 await expect(page.locator('#handsReportMsg')).toHaveText('ORDER_NOT_FOUND');expect(await sendCount(page)).toBe(1);
});
test('queued completed report is still protected before any manual Hands send',async({page})=>{
 await setup(page,'report');await page.evaluate(()=>window.delivery={state:'processing'});await page.locator('[name=kind]').selectOption('COMPLETED');await submit(page,'report');
 await expect(page.locator('#handsReportMsg')).toContainText('отправляется автоматически');expect(await sendCount(page)).toBe(0);
 await expect(page.locator('#handsReportForm button')).toBeEnabled();
});
test('assignment completion does not close a newer modal',async({page})=>{
 await page.clock.install();
 await setup(page,'assign');await page.evaluate(()=>window.responseMode='success');await submit(page,'assign');
 await expect(page.locator('#handsAssignMsg')).toHaveText(forms.assign.success);
 await page.evaluate(()=>window.openModal('<h2>Другая заявка</h2>'));
 await page.clock.runFor(700);await expect(page.locator('.modal')).toContainText('Другая заявка');
 expect(await page.evaluate(()=>window.closes)).toBe(0);
});
