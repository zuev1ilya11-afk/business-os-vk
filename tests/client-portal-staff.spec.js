const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {fullStack}=require('./helpers/full-stack.cjs');

async function portalFixture(page,role='owner'){
  await fullStack(page,role);
  const calls=[];
  let version=1;
  const order=()=>({id:'12',number:'К-12',version,created_at:'2026-11-05T10:00:00Z',internal_status:'Новая',status:'new',status_label:'Заявка получена',address:'Тестовая улица, 1',description:'Монтаж',client:{id:'c-1',name:'Тестовый клиент',phone:'+79990000001'},preliminary:{total:null},master_staff_id:null,work_items:[{name:'Работа',quantity:2,unit:'шт.',unit_price:null}],attachments:[],requests:[],events:[]});
  let messages=[{id:1,sender:'client',body:'<img src=x onerror="window.clientXss=1">',created_at:'2026-11-05T10:00:00Z'}];
  await page.route('**/client-api/staff/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),endpoint=url.pathname.slice('/client-api/staff/'.length),body=request.postDataJSON();
    calls.push({endpoint,method,body,headers:request.headers()});
    let result={ok:true};
    if(endpoint==='orders')result={ok:true,orders:[order()],total:1};
    else if(endpoint==='orders/12'&&method==='GET')result={ok:true,order:order()};
    else if(endpoint==='orders/12'&&method==='PATCH'){version++;result={ok:true,order:order()}}
    else if(endpoint==='masters')result={ok:true,masters:[{id:'m',name:'Тестовый мастер'}]};
    else if(endpoint==='messages'&&method==='GET')result={ok:true,messages:messages.filter(x=>x.id>Number(url.searchParams.get('after')||0))};
    else if(endpoint==='messages'&&method==='POST'){messages.push({id:messages.length+1,sender:'company',body:body.body,created_at:new Date().toISOString()});result={ok:true,message:messages.at(-1)}}
    else if(endpoint==='messages/read')result={ok:true};
    else if(endpoint==='catalog'&&method==='GET')result={ok:true,services:[]};
    else if(endpoint==='catalog'&&method==='POST')result={ok:true,service:{id:'s-1',...body}};
    else if(endpoint==='orders/12/estimates'){version++;result={ok:true,order:order()}}
    else return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({ok:false,error:'Неожиданный тестовый endpoint: '+endpoint})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.BOS_CLIENT_PORTAL_CONFIG={enabled:true,apiBase:'/client-api/'});
  await page.addScriptTag({path:path.resolve('client-portal-staff.js')});
  return calls;
}

test('staff conversation escapes customer text, preserves typed reply and uses employee credentials',async({page})=>{
  const calls=await portalFixture(page,'dispatcher');
  await page.evaluate(()=>openClientPortalInbox());
  await page.getByRole('button',{name:'Открыть переписку и согласование'}).click();
  await expect(page.locator('.cpStaffBubble')).toContainText('<img src=x onerror="window.clientXss=1">');
  expect(await page.evaluate(()=>window.clientXss)).toBeUndefined();
  await page.getByLabel('Ответ клиенту',{exact:true}).fill('Договорились на завтра.');
  await page.getByRole('button',{name:'Отправить клиенту',exact:true}).click();
  await expect(page.locator('.cpStaffBubble.company')).toHaveText(/Договорились на завтра/);
  const sent=calls.find(x=>x.endpoint==='messages'&&x.method==='POST');
  expect(sent.body).toMatchObject({order_id:'12',body:'Договорились на завтра.'});
  expect(sent.body.request_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(sent.headers['x-bos-session']).toBeTruthy();
  expect(sent.headers.cookie).toBeUndefined();
  await page.getByRole('button',{name:'Все клиентские заявки'}).click();
  await expect(page.getByRole('button',{name:'Каталог услуг',exact:true})).toHaveCount(0);
});

test('owner can save confirmed catalog fields without losing FormData',async({page})=>{
  const calls=await portalFixture(page);
  await page.evaluate(()=>openClientPortalInbox());
  await page.getByRole('button',{name:'Каталог услуг',exact:true}).click();
  await page.getByRole('button',{name:'Добавить услугу',exact:true}).click();
  await page.getByLabel('Название',{exact:true}).fill('Синтетическая услуга');
  await page.getByLabel('Категория',{exact:true}).fill('Тест');
  await page.getByLabel('Тип цены',{exact:true}).selectOption('unit');
  await page.getByLabel('Цена, ₽',{exact:true}).fill('250');
  await page.getByLabel('Цена сверена и подтверждена').check();
  await page.getByLabel('Опубликовать в клиентском каталоге').check();
  await page.getByRole('button',{name:'Сохранить услугу',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Каталог услуг',exact:true})).toBeVisible();
  expect(calls.find(x=>x.endpoint==='catalog'&&x.method==='POST').body).toMatchObject({name:'Синтетическая услуга',category:'Тест',price_type:'unit',price:250,published:true,confirmed:true,available:true});
});

test('staff estimate sends version and line inputs, narrow layout stays scrollable',async({page})=>{
  await page.setViewportSize({width:360,height:780});const calls=await portalFixture(page);
  await page.evaluate(()=>openClientPortalInbox());await page.getByRole('button',{name:'Открыть переписку и согласование'}).click();
  await page.getByLabel('Цена за единицу, ₽',{exact:true}).fill('300');
  await page.getByLabel('Условия сметы',{exact:true}).fill('Тестовые условия');
  await page.getByRole('button',{name:'Отправить смету на согласование',exact:true}).click();
  await expect.poll(()=>calls.filter(x=>x.endpoint==='orders/12/estimates').length).toBe(1);
  expect(calls.find(x=>x.endpoint==='orders/12/estimates').body).toMatchObject({version:1,items:[{name:'Работа',unit:'шт.',quantity:2,unit_price:300}],conditions:'Тестовые условия'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
