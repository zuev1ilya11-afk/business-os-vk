const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test.setTimeout(60000);

async function installOwnerBootstrap(page, createHandler){
  await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','test-session-owner'));
  const master={id:'master-1',vk_user_id:'master_vk_1',external_id:'master_vk_1',full_name:'Мастер Тест',role:'master',city:'Москва'};
  const mini=async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    if(body.action==='bootstrap'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Владелец',role:'owner',city:'Москва',vk_user_id:'owner-test'},orders:[],users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    if(body.action==='createOrder'&&createHandler)return createHandler(route,body);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  };
  await page.route('**/api/proxy/mini-app-api',mini);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',mini);
  const ok=route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  await page.route('**/api/proxy/claims-api',ok);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',ok);
  await page.route('**/api/proxy/order-meta-api',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"order":{"order_type":"work"}}'}));
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"order":{"order_type":"work"}}'}));
}

test('master payout is 35% of the amount remaining after 15% deduction',async({page})=>{
  await installOwnerBootstrap(page);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  const values=await page.evaluate(()=>[1000,5000,10000,25000,100000].map(v=>payout(v)));
  expect(values).toEqual([297.5,1487.5,2975,7437.5,29750]);
});

test('retrying a failed create-order submission reuses the same request_id',async({page})=>{
  const seen=[];
  let attempts=0;
  await installOwnerBootstrap(page,async(route,body)=>{
    seen.push(body.request_id);
    attempts++;
    if(attempts===1){
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'Временная ошибка сохранения'})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:{id:'IDEMP-1',status:'В работе',client:body.client,address:body.address,work:body.work,amount:Number(body.amount||body.original_amount||0),master_vk_id:body.master_vk_id||'',master_name:'Мастер Тест'}})});
  });

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  await page.getByRole('button',{name:'+ Новая'}).click();
  await page.locator('input[name="client"]').fill('Идемпотентный тест');
  const phone=page.locator('#bosPhone');if(await phone.count())await phone.fill('9991234567');
  else await page.locator('input[name="phone"]').fill('9991234567');
  await page.locator('input[name="address"]').fill('Тестовый адрес');
  const service=page.locator('#bosService');
  if(await service.count())await service.selectOption('4');
  else await page.locator('input[name="work"]').fill('Монтаж');
  const original=page.locator('input[name="original_amount"]');
  if(await original.count())await original.fill('1000');
  else await page.locator('input[name="amount"]').fill('1000');

  await page.getByRole('button',{name:'Сохранить'}).click();
  await expect(page.getByText('Временная ошибка сохранения')).toBeVisible();
  await page.getByRole('button',{name:'Сохранить'}).click();
  await expect(page.getByText('IDEMP-1')).toBeVisible();

  expect(seen).toHaveLength(2);
  expect(seen[0]).toBeTruthy();
  expect(seen[1]).toBe(seen[0]);
});

test('tracked mini-app API enforces corrected payout and request idempotency',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  expect(source).toContain('master_payout:has?round(x*.85*.35):0');
  expect(source).not.toContain('master_payout:has?round(x*.85*.65):0');
  expect(source).toContain('const requestId=a===\'createOrder\'?safeRequestId(b.request_id):\'\'');
  expect(source).toContain(".eq('external_id',createExternalId).maybeSingle()");
  expect(source).toContain('if(prior.data)return j({ok:true,order:prior.data,idempotent:true})');
});