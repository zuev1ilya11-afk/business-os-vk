const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('master report submits act and photo through gateway before finalizing',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','test-session-master'));
  await page.route('**/*vk-bridge*',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));

  const master={id:'m1',external_id:'staff_master',vk_user_id:'staff_master',full_name:'Мастер Тест',role:'master',city:'Москва',is_active:true};
  const order={id:'M-1',client:'Клиент',address:'Адрес',work:'Монтаж',status:'В работе',master_staff_id:'m1',master_vk_id:'staff_master',master_name:'Мастер Тест',master_payout:552.5,scheduled_date:'2099-09-10'};
  const bootstrap=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:master,orders:[order],users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{permissions:{can_manage_staff:false}}})});
  await page.route('**/api/proxy/mini-app-api',bootstrap);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',bootstrap);
  const ok=route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"claims":[],"orders":[]}'});
  await page.route('**/api/proxy/claims-api',ok);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',ok);

  const actions=[];
  let directCalls=0;
  let finalizePayload=null;
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-api',route=>{
    directCalls++;
    return route.fulfill({status:500,contentType:'application/json',body:'{"ok":false,"error":"direct endpoint should not be needed"}'});
  });
  await page.route('https://business-os-api-gateway.netlify.app/api/proxy/report-api',async route=>{
    const body=route.request().postDataJSON()||{};
    actions.push(body.action);
    if(body.action==='uploadReportFile'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:`https://files.test/${body.file_kind}-${body.file_index}`})});
    }
    if(body.action==='finalizeMasterReport'){
      finalizePayload=body;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:{id:'M-1',status:'Выполнена',master_payout:552.5},drive_archive_status:'pending'})});
    }
    return route.fulfill({status:400,contentType:'application/json',body:'{"ok":false,"error":"unexpected action"}'});
  });

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>openMasterReportForm('M-1'));
  await expect(page.locator('#masterReportForm')).toBeVisible();

  await page.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('act')});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
  await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'Отправить отчёт и завершить'}).click();

  await expect.poll(()=>actions,{timeout:15000}).toEqual(['uploadReportFile','uploadReportFile','finalizeMasterReport']);
  await expect(page.locator('#masterReportForm')).toHaveCount(0);

  expect(directCalls).toBe(0);
  expect(finalizePayload).toBeTruthy();
  expect(finalizePayload.act_url).toContain('/act-0');
  expect(finalizePayload.photo_urls).toEqual(['https://files.test/photo-1']);
});

test('master report response strips order totals and other-role payouts',async()=>{
  const api=fs.readFileSync(path.join(__dirname,'..','supabase','functions','report-api','index.ts'),'utf8');
  expect(api).toContain("for(const k of ['amount','original_amount','manager_payout','dispatcher_payout'])delete x[k]");
  expect(api.match(/order:masterOrder\(r\.data\)/g)||[]).toHaveLength(2);
  expect(api).not.toContain("order:r.data,drive_archive_status:'pending'");
});

test('master report submit handler is stable and gateway-first',async()=>{
  const uploader=fs.readFileSync(path.join(__dirname,'..','report-chunk-upload-v23.js'),'utf8');
  expect(uploader).toContain("const REPORT_PROXY='https://business-os-api-gateway.netlify.app/api/proxy/report-api'");
  expect(uploader).toContain('window.BOS_MASTER_REPORT_SUBMIT=submit');
  expect(uploader).toContain('form.onsubmit=e=>window.BOS_MASTER_REPORT_SUBMIT(e,id)');
  expect(uploader.indexOf('REPORT_PROXY')).toBeLessThan(uploader.indexOf('REPORT_DIRECT'));
});
