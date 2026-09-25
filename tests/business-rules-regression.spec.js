const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test.setTimeout(60000);

async function installOwnerBootstrap(page, createHandler){
  await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','test-session-owner'));
  const storedOrders=[];
  const master={id:'master-1',vk_user_id:'master_vk_1',external_id:'master_vk_1',full_name:'Мастер Тест',role:'master',city:'Москва'};
  const mini=async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    if(body.action==='bootstrap'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Владелец',role:'owner',city:'Москва',vk_user_id:'owner-test'},orders:storedOrders,users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    if(body.action==='createOrder'&&createHandler)return createHandler(route,body,storedOrders);
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

test('master payout subtracts 15% and then subtracts 35% from the remainder',async({page})=>{
  await installOwnerBootstrap(page);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  const values=await page.evaluate(()=>[1000,4458,5000,10000,25000,100000].map(v=>payout(v)));
  expect(values).toEqual([552.5,2463.05,2762.5,5525,13812.5,55250]);
});

test('retrying a failed create-order submission reuses the same request_id',async({page})=>{
  const seen=[];
  let attempts=0;
  await installOwnerBootstrap(page,async(route,body,storedOrders)=>{
    seen.push(body.request_id);
    attempts++;
    if(attempts===1){
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'Временная ошибка сохранения'})});
    }
    const order={id:'IDEMP-1',status:'В работе',client:body.client,address:body.address,work:body.work,amount:Number(body.amount||body.original_amount||0),master_vk_id:body.master_vk_id||'',master_name:'Мастер Тест'};
    storedOrders.push(order);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order})});
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
  // Simulate a cached server result already present locally before the retry.
  await page.evaluate(()=>state.orders.push({id:'IDEMP-1',status:'В работе',client:'Cached order',address:'Тестовый адрес',work:'Монтаж',amount:1000}));
  await page.getByRole('button',{name:'Сохранить'}).click();
  await expect.poll(()=>seen.length).toBe(2);

  expect(seen[0]).toBeTruthy();
  expect(seen[1]).toBe(seen[0]);
});

test('tracked APIs and fallbacks enforce corrected master payout',async()=>{
  const mini=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  const report=fs.readFileSync(path.join(__dirname,'..','supabase','functions','report-api','index.ts'),'utf8');
  const hands=fs.readFileSync(path.join(__dirname,'..','supabase','functions','hands-api','index.ts'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','app-public.js'),'utf8');
  const sheets=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
  expect(mini).toContain('master_payout:has?round(x*.85*.65):0');
  expect(mini).not.toContain('master_payout:has?round(x*.85*.35):0');
  expect(report).toContain('master_payout:round(x*.85*.65)');
  expect(hands).toContain('const masterPayout=(v:any)=>Math.round(money(v)*.85*.65*100)/100');
  expect(app).toContain('const payout=a=>Math.round(Number(a||0)*.85*.65*100)/100');
  expect(sheets).toContain('return round2_(n*0.85*0.65)');
});

test('master API and master order UI do not expose order totals',async()=>{
  const mini=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  const compact=fs.readFileSync(path.join(__dirname,'..','master-order-compact-v71.js'),'utf8');
  const handsLayout=fs.readFileSync(path.join(__dirname,'..','master-order-hands-layout-v72.js'),'utf8');
  expect(mini).toContain("for(const k of ['amount','original_amount','manager_payout','dispatcher_payout'])delete x[k]");
  expect(compact).toContain('Выплата: ${money(pay(o))}');
  expect(handsLayout).toContain('Выплата: ${money(pay(o))}');
  expect(compact).not.toContain('money(o.amount||0)');
  expect(handsLayout).not.toContain('money(o.amount||0)');
});

test('old formula-derived payouts are backfilled without overwriting manual adjustments',async()=>{
  const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260914145500_fix_master_payout_formula.sql'),'utf8');
  expect(migration).toContain('0.85 * 0.65');
  expect(migration).toContain('0.85 * 0.35');
  expect(migration).toContain('<= 0.01');
});

test('tracked mini-app API keeps request idempotency',async()=>{
  const mini=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  expect(mini).toContain('const requestId=a===\'createOrder\'?safeRequestId(b.request_id):\'\'');
  expect(mini).toContain(".eq('external_id',createExternalId).maybeSingle()");
  expect(mini).toContain('if(prior.data)return j({ok:true,order:prior.data,idempotent:true})');
});
