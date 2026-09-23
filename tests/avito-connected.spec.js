const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function connected(page){
 const stack=await fullStack(page,'owner');const calls=[];
 let sendCount=0,failSend=false,failChats=false;
 const chat={id:'chat-1',client:'Клиент Авито',client_id:'99',phone:'+79995554433',item_title:'Монтаж карниза',item_id:'10',item_url:'https://www.avito.ru/ad',last_message:'Нужен монтаж',last_message_at:'2026-09-23T10:00:00Z',unread_count:2};
 const messages=[{id:'1',text:'Нужен монтаж',direction:'in',created_at:'2026-09-23T10:00:00Z'}];
 await page.route('**/api/proxy/avito-api',async route=>{
  const body=route.request().postDataJSON();calls.push(body);let data={ok:true},status=200;
  if(body.action==='status')data={ok:true,connected:false,configured:true};
  if(body.action==='chats'){data={ok:true,chats:[chat],next_offset:null};if(failChats){data={ok:false,error:'Авито временно недоступен'};status=502}}
  if(body.action==='messages')data={ok:true,messages:[...messages].reverse(),next_offset:null};
  if(body.action==='sendMessage'){
   sendCount++;await new Promise(r=>setTimeout(r,100));
   if(failSend){status=504;data={ok:false,error:'UPSTREAM_TIMEOUT'}}
   else messages.push({id:String(messages.length+1),text:body.text,direction:'out',created_at:'2026-09-23T10:01:00Z'});
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>window.BUSINESS_OS_CONFIG.AVITO_API_ENABLED=true);
 return {...stack,calls,chat,messages,get sendCount(){return sendCount},failSend:()=>failSend=true,failChats:()=>failChats=true};
}
test('connected inbox sends twice, refreshes without closing draft, and stops polling when closed',async({page})=>{
 const x=await connected(page);await page.clock.install();
 await page.evaluate(()=>openAvitoInbox());await expect(page.locator('.avitoChatRow')).toContainText('Монтаж карниза');await expect(page.locator('#avitoUnreadTotal')).toContainText('2');
 await page.locator('.avitoChatRow').click();await expect(page.locator('.avitoBubble.in')).toContainText('Нужен монтаж');
 const input=page.locator('#avitoSendForm textarea'),send=page.locator('#avitoSendForm button');
 await input.fill('Первый ответ');await send.click();await page.locator('#avitoSendForm').evaluate(f=>f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
 await expect(page.locator('.avitoBubble.out')).toContainText('Первый ответ');expect(x.sendCount).toBe(1);await expect(send).toBeEnabled();
 await input.fill('Второй ответ');await send.click();await expect(page.locator('.avitoBubble.out')).toHaveCount(2);expect(x.sendCount).toBe(2);
 await input.fill('Черновик');x.messages.push({id:'4',text:'Новое входящее',direction:'in',created_at:'2026-09-23T10:02:00Z'});
 await page.clock.runFor(31000);await expect(page.locator('#avitoMessages')).toContainText('Новое входящее');await expect(input).toHaveValue('Черновик');
 await page.evaluate(()=>closeModal());const count=x.calls.length;await page.clock.runFor(65000);expect(x.calls.length).toBe(count);
});
test('Avito draft saves via existing createOrder and returns to linked chat without a duplicate',async({page})=>{
 const x=await connected(page);await page.evaluate(()=>openAvitoInbox());await page.locator('.avitoChatRow').click();await expect(page.locator('.avitoBubble')).toBeVisible();
 await page.locator('#avitoToOrder').click();const form=page.locator('#orderForm');await expect(form.locator('[name=avito_chat_id]')).toHaveValue('chat-1');await expect(form.locator('[name=comment]')).toHaveValue(/ID клиента Авито: 99/);
 await form.locator('[name=address]').fill('Невский 10');
 const service=form.locator('#bosService');await service.selectOption({index:1});
 await form.locator('button[type=submit]').click();await expect(form).toHaveCount(0);
 const order=x.db.tables.orders.find(o=>o.avito_chat_id==='chat-1');expect(order).toBeTruthy();expect(order.external_source).toBe('avito');expect(order.avito_item_id).toBe('10');
 await page.evaluate(id=>openOrder(id),order.id);await page.getByRole('button',{name:'Открыть чат',exact:true}).click();await expect(page.locator('#avitoToOrder')).toHaveText('Открыть заявку');await page.locator('#avitoToOrder').click();expect(x.db.tables.orders).toHaveLength(3);
});
test('timeout keeps draft, prevents blind resend, and stale inbox cannot overwrite another modal',async({page})=>{
 const x=await connected(page);await page.evaluate(()=>openAvitoInbox());await page.locator('.avitoChatRow').click();await expect(page.locator('.avitoBubble')).toBeVisible();x.failSend();
 await page.locator('#avitoSendForm textarea').fill('Не потерять');await page.locator('#avitoSendForm button').click();await expect(page.locator('#avitoSendMsg')).toContainText('проверьте историю');await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Не потерять');
 page.once('dialog',d=>d.dismiss());await page.locator('#avitoSendForm button').click();expect(x.sendCount).toBe(1);
 await page.route('**/api/proxy/avito-api',async route=>{await new Promise(r=>setTimeout(r,200));await route.fulfill({contentType:'application/json',body:'{"ok":true,"chats":[]}'})});
 await page.evaluate(()=>{openAvitoInbox();openAvitoManualLead()});await expect(page.locator('#avitoManualForm')).toBeVisible();await page.waitForTimeout(300);await expect(page.locator('#avitoManualForm')).toBeVisible();
});
test('connection screen uses server secrets, provider data is rendered as text, and errors are readable',async({page})=>{
 const x=await connected(page);await page.evaluate(()=>openAvitoSettings());await expect(page.locator('.modal')).toContainText('Supabase Secrets');await expect(page.locator('[name=client_secret]')).toHaveCount(0);
 x.chat.client='<img src=x onerror=alert(1)>';await page.evaluate(()=>openAvitoInbox());await expect(page.locator('.avitoChatRow')).toContainText('<img');await expect(page.locator('.avitoChatRow img')).toHaveCount(0);
 x.failChats();await page.locator('#avitoRefresh').click();await expect(page.locator('#avitoInboxStatus')).toContainText('временно недоступен');
});

test('429 blocks manual requests and polling until the provider cooldown expires',async({page})=>{
 await connected(page);await page.clock.install();let count=0;
 await page.route('**/api/proxy/avito-api',async route=>{count++;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({ok:false,error:'Подождите',retry_after:90})})});
 await page.evaluate(()=>openAvitoInbox());expect(count).toBe(1);
 await page.locator('#avitoRefresh').click();expect(count).toBe(1);
 await page.clock.runFor(60000);expect(count).toBe(1);
 await page.clock.runFor(31000);await page.locator('#avitoRefresh').click();expect(count).toBe(2);
});
