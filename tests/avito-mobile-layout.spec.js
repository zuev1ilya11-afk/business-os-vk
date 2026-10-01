const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test.use({timezoneId:'Europe/Moscow',screenshot:'only-on-failure'});

async function setup(page,{width=390,height=844,role='owner',count=12}={}){
 await page.setViewportSize({width,height});
 const stack=await fullStack(page,role),calls=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const names=['Сергей','Андрей','Марина','Илья','Екатерина'];
 const titles=['Услуги мастера на час','Услуги монтажника, сборщика мебели','Ремонт бытовой техники','Установка карнизов','Ремонт окон'];
 const chats=Array.from({length:count},(_,i)=>({id:'mobile-'+i,client:names[i%5],phone:'+79995554433',item_title:titles[i%5],last_message:i%5===1?'Определились с ремонтом штор?':'Здравствуйте, подскажите, когда сможет приехать мастер?',last_message_at:'2026-10-01T11:20:00Z',unread_count:i===2?2:0}));
 stack.db.tables.orders.push({id:'1709',client:'Сергей',work:titles[0],status:'В работе',source:'Авито',avito_chat_id:chats[0].id,amount:1000,original_amount:1000});
 let fail=false;
 await page.route('**/api/proxy/avito-api',async route=>{
  const b=route.request().postDataJSON();calls.push(b);let d={ok:true},status=200;
  if(b.action==='chats'){
   if(fail){d={ok:false,error:'Нет связи с Авито. Повторите позже.'};status=502}
   else d={ok:true,chats:b.offset?[{id:'page-two',client:'Последний диалог',item_title:'Навеска полок',last_message:'Спасибо'}]:chats,next_offset:b.offset?null:100};
  }
  if(b.action==='messages')d={ok:true,messages:[{id:'m1',text:'Нужен монтаж карниза.',direction:'in',created_at:'2026-10-01T11:20:00Z'}],next_offset:null};
  if(b.action==='status')d={ok:true,configured:true,connected:true,connection:{account_name:'Домашний мастер',avito_user_id:'42'}};
  if(b.action==='read'){const chat=chats.find(c=>c.id===b.chat_id);if(chat)chat.unread_count=0}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.locator('#bosAvitoNav').click();await expect(page.locator('.avitoChatRow')).toHaveCount(count);
 return {...stack,calls,errors,chats,fail:()=>fail=true};
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)}

for(const [role,width,height] of [['owner',320,700],['owner',390,844],['dispatcher',430,932],['manager',375,667]]){
 test(`mobile Avito list uses the page, not a cropped inner box: ${role} ${width}`,async({page},testInfo)=>{
  const x=await setup(page,{role,width,height});
  const root=page.locator('.avitoWorkspace'),head=page.locator('#app>header');
  await expect(root).toHaveAttribute('data-pane','list');
  await expect(head.locator('.bosInstallAppBtn--header')).toBeHidden();
  const brand=head.locator('.brandText h1');
  expect(await brand.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  const geometry=await page.evaluate(()=>({header:document.querySelector('#app>header').getBoundingClientRect().height,inbox:getComputedStyle(document.querySelector('.avitoInbox')).overflowY,desk:getComputedStyle(document.querySelector('.avitoDesk')).overflowY,search:document.querySelector('#avitoSearch').getBoundingClientRect().height}));
  expect(geometry.header).toBeLessThanOrEqual(116);expect(geometry.inbox).toBe('visible');expect(geometry.desk).toBe('visible');expect(geometry.search).toBeGreaterThanOrEqual(44);
  for(const button of await head.locator('button:visible').all()){const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x+box.width).toBeLessThanOrEqual(width+1)}
  await expect(root.locator('.avitoChatRow').first()).toContainText('Заявка №1709');
  const timestamp=root.locator('.avitoRowMeta>small').first();await expect(timestamp).toHaveText('01.10, 14:20');
  expect(await timestamp.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await noOverflow(page);
  if(process.env.BOS_AVITO_CAPTURE)await page.screenshot({path:testInfo.outputPath(`avito-${role}-${width}.png`)});
  expect(x.calls.some(c=>['sendMessage','read','messages'].includes(c.action))).toBe(false);
  const more=root.locator('#avitoMoreChats');await more.scrollIntoViewIfNeeded();
  const b=await more.boundingBox(),nav=await page.locator('#app>nav').boundingBox();expect(b.y+b.height).toBeLessThanOrEqual(nav.y+1);
  await more.click();await expect(root.locator('.avitoChatRow')).toHaveCount(13);await expect(more).toBeHidden();
  expect(x.calls.filter(c=>c.action==='chats'&&c.offset===100)).toHaveLength(1);expect(x.errors).toEqual([]);
 });
}

test('mobile return preserves list scroll, drafts, search and inline order workflow',async({page})=>{
 const x=await setup(page,{count:40});
 const row=page.locator('.avitoChatRow').nth(25);await row.scrollIntoViewIfNeeded();const scroll=await page.evaluate(()=>scrollY);expect(scroll).toBeGreaterThan(1000);
 await row.click();await expect(page.locator('.avitoBubble')).toHaveCount(1);await expect(page.locator('.modal')).toHaveCount(0);
 await page.locator('#avitoSendForm textarea').fill('Черновик ответа');
 await page.locator('.avitoShowLead').click();await page.locator('#avitoLeadForm [name=address]').fill('Невский проспект, 24');
 await page.locator('.avitoBackChat').click();await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Черновик ответа');
 await page.locator('.avitoBackList').click();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(scroll-2);
 expect(await page.evaluate(()=>scrollY)).toBeLessThanOrEqual(scroll+2);
 await page.locator('.avitoChatRow').nth(25).click();await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Черновик ответа');
 await page.locator('.avitoShowLead').click();await expect(page.locator('#avitoLeadForm [name=address]')).toHaveValue('Невский проспект, 24');
 await page.evaluate(()=>reloadData(true));await expect(page.locator('#avitoLeadForm [name=address]')).toHaveValue('Невский проспект, 24');
 await page.locator('.avitoBackChat').click();await page.locator('.avitoBackList').click();
 await page.locator('#avitoSearch').fill('ремонтом штор');await expect(page.locator('.avitoChatRow')).toHaveCount(8);
 await page.locator('.avitoChatRow').last().click();await page.locator('.avitoBackList').click();await expect(page.locator('#avitoSearch')).toHaveValue('ремонтом штор');
 await page.locator('#avitoSearch').fill('ничего не найдено');await expect(page.locator('.avitoNoResults')).toHaveText('Диалоги не найдены.');
 expect(x.calls.some(c=>c.action==='sendMessage')).toBe(false);expect(x.errors).toEqual([]);
});

test('mobile composer remains above navigation when the visible viewport shrinks',async({page},testInfo)=>{
 const x=await setup(page);await page.locator('.avitoChatRow').nth(1).click();await expect(page.locator('.avitoBubble')).toHaveCount(1);
 await page.locator('#avitoSendForm textarea').fill('Сохранить при изменении высоты');
 for(const height of [500,420,844]){
  await page.setViewportSize({width:390,height});
  await expect.poll(async()=>{const composer=await page.locator('#avitoSendForm').boundingBox(),nav=await page.locator('#app>nav').boundingBox();return composer.y+composer.height<=Math.min(nav.y,height)+1}).toBe(true);
  await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Сохранить при изменении высоты');
  await expect(page.locator('#avitoSendForm button')).toBeVisible();
  await page.locator('#avitoSendForm button').click({trial:true});
  if(process.env.BOS_AVITO_CAPTURE&&height===420)await page.screenshot({path:testInfo.outputPath('avito-chat-short.png')});
  await noOverflow(page);
 }
 await page.locator('.avitoBackList').click();await expect(page.locator('#app>header')).toBeVisible();
 expect(x.errors).toEqual([]);
});

test('mobile errors stay near search and returning to another tab restores its header',async({page})=>{
 const x=await setup(page);
 x.fail();await page.locator('#avitoRefresh').click();await expect(page.locator('#avitoInboxStatus')).toContainText('Нет связи');
 const error=await page.locator('#avitoInboxStatus').boundingBox(),first=await page.locator('.avitoChatRow').first().boundingBox();expect(error.y).toBeLessThan(first.y);
 await expect(page.locator('.avitoChatRow')).toHaveCount(12);
 await page.locator('#avitoSettings').click();await expect(page.locator('.modal')).toContainText('Домашний мастер');await page.locator('.modalClose').click();
 await page.locator('nav [data-page=orders]').click();await expect(page.locator('.avitoWorkspace')).toHaveCount(0);
 await expect(page.locator('#app>header .bosInstallAppBtn--header')).toBeVisible();
 expect(await page.locator('#app>header').evaluate(e=>getComputedStyle(e).flexWrap)).toBe('wrap');expect(x.errors).toEqual([]);
});

for(const width of [900,1440])test(`desktop/tablet Avito keeps inline split panes at ${width}`,async({page})=>{
 const x=await setup(page,{width});
 expect(await page.locator('.avitoDesk').evaluate(e=>getComputedStyle(e).display)).toBe('grid');
 await page.locator('.avitoChatRow').nth(1).click();await expect(page.locator('#avitoSendForm')).toBeVisible();await expect(page.locator('.avitoQueue')).toBeVisible();
 if(width===1440)await expect(page.locator('#avitoLeadForm')).toBeVisible();
 await noOverflow(page);expect(x.errors).toEqual([]);
});
