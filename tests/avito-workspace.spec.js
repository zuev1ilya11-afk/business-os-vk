const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page,width=1440){
 await page.setViewportSize({width,height:900});
 const x=await fullStack(page,'owner'),calls=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const chats=[{id:'u2i:ABC+def/ghi==',client:'Сергей',client_id:'99',phone:'+79995554433',item_title:'Установка карниза',item_id:'10',item_url:'https://www.avito.ru/ad',last_message:'Два карниза, стены бетонные',unread_count:2},{id:'second',client:'Анна',phone:'+79991112233',item_title:'Замена смесителя',last_message:'Когда приедет мастер?',unread_count:1}];
 const history=[{id:'1',text:'Здравствуйте! Нужно установить карнизы.',direction:'in',created_at:'2026-09-30T12:38:00Z'},{id:'2',text:'Здравствуйте! Установка карниза — от 1 500 ₽. Сколько карнизов и какие стены?',direction:'out',created_at:'2026-09-30T12:39:00Z'},{id:'3',text:'Два карниза, стены бетонные. Можно завтра после 15:00?',direction:'in',created_at:'2026-09-30T12:40:00Z'}];
 let more=false;
 await page.route('**/api/proxy/avito-api',async route=>{
  const b=route.request().postDataJSON();calls.push(b);let d={ok:true};
  if(b.action==='chats')d={ok:true,chats:b.offset?[{id:'third',client:'Марина',item_title:'Навеска полок',unread_count:0}]:chats,next_offset:more&&!b.offset?100:null};
  if(b.action==='messages')d={ok:true,messages:history,next_offset:null};
  if(b.action==='read'){const c=chats.find(c=>c.id===b.chat_id);if(c)c.unread_count=0}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('#bosAvitoNav').click();await expect(page.locator('.avitoChatRow')).toHaveCount(2);
 return {...x,chats,history,calls,errors,enableMore:()=>more=true};
}
for(const width of [320,390,900,1440])test('Avito workspace fits '+width+'px and uses inline panes',async({page})=>{
 const x=await setup(page,width);
 await page.locator('.avitoChatRow').first().click();await expect(page.locator('.avitoBubble')).toHaveCount(3);
 await expect(page.locator('.modal')).toHaveCount(0);await expect(page.locator('#avitoSendForm')).toBeVisible();
 if(width<1260)await page.locator('.avitoShowLead').click();
 const form=page.locator('#avitoLeadForm');await expect(form).toBeVisible();await form.locator('[name=address]').fill('Невский проспект, 24');await form.locator('[name=desired_time]').fill('Завтра после 15:00');
 await page.evaluate(()=>reloadData(true));await expect(form).toBeVisible();await expect(form.locator('[name=address]')).toHaveValue('Невский проспект, 24');
 for(const target of ['.avitoWorkspace','#avitoToOrder']){
  const box=await page.locator(target).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
 if(width<1260){await page.locator('.avitoBackChat').click();await expect(page.locator('#avitoSendForm')).toBeVisible()}
 if(width<768){await page.locator('.avitoBackList').click();await expect(page.locator('#avitoSearch')).toBeVisible();await page.locator('.avitoChatRow').first().click()}
 if(width<1024){const composer=await page.locator('#avitoSendForm').boundingBox(),nav=await page.locator('#app > nav').boundingBox();expect(composer.y+composer.height).toBeLessThanOrEqual(nav.y)}
 await expect(page.locator('.avitoBubble')).toHaveCount(3);
 if(process.env.BOS_CAPTURE){await page.screenshot({path:'/workspace/scratch/5af1b07488a7/avito-workspace-'+width+'.png',fullPage:true})}
 expect(x.errors).toEqual([]);
});
test('filters, paginated refresh and navigation preserve separate message/order drafts',async({page})=>{
 const x=await setup(page);x.enableMore();await page.locator('#avitoRefresh').click();await expect(page.locator('#avitoMoreChats')).toBeVisible();await page.locator('#avitoMoreChats').click();await expect(page.locator('.avitoChatRow')).toHaveCount(3);
 await page.locator('#avitoRefresh').click();await expect(page.locator('.avitoChatRow')).toHaveCount(3);await expect(page.locator('#avitoMoreChats')).toBeHidden();
 await page.locator('#avitoSearch').fill('смесителя');await expect(page.locator('.avitoChatRow')).toHaveCount(1);await expect(page.locator('.avitoChatRow')).toContainText('Анна');await page.locator('#avitoSearch').fill('');
 await page.locator('.avitoChatRow').first().click();await page.locator('#avitoSendForm textarea').fill('Черновик Сергею');await page.locator('#avitoLeadForm [name=address]').fill('Адрес Сергея');
 await page.locator('.avitoChatRow').nth(1).click();await page.locator('#avitoSendForm textarea').fill('Черновик Анне');await page.locator('#avitoLeadForm [name=address]').fill('Адрес Анны');
 await page.locator('.avitoChatRow').first().click();await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Черновик Сергею');await expect(page.locator('#avitoLeadForm [name=address]')).toHaveValue('Адрес Сергея');
 await page.locator('nav [data-page=orders]').click();await page.locator('#bosAvitoNav').click();await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Черновик Сергею');
 await page.locator('#avitoRefresh').click();await expect(page.locator('#avitoLeadForm [name=address]')).toHaveValue('Адрес Сергея');
 await page.locator('[data-avito-filter=unread]').click();await expect(page.locator('.avitoChatRow')).toHaveCount(0);
 expect(x.errors).toEqual([]);
});
test('failed inline create retains fields and retry creates one linked order',async({page})=>{
 const x=await setup(page);await page.locator('.avitoChatRow').first().click();const form=page.locator('#avitoLeadForm');await form.locator('[name=address]').fill('Адрес');await form.locator('[name=comment]').fill('Сохранить детали');
 let first=true;
 await page.route('**/api/proxy/mini-app-api',async route=>{const b=route.request().postDataJSON();if(b.action==='createOrder'&&first){first=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Временная ошибка'})});return}await route.fallback()});
 await page.locator('#avitoToOrder').click();await expect(page.locator('#avitoOrderMsg')).toContainText('Временная ошибка');await expect(form.locator('[name=comment]')).toHaveValue('Сохранить детали');await page.locator('#avitoToOrder').click();await expect(page.locator('#avitoToOrder')).toHaveText('Открыть заявку');expect(x.db.tables.orders.filter(o=>o.avito_chat_id===x.chats[0].id)).toHaveLength(1);
});
