const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

async function boot(page,role,width,options={}){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const stack=await fullStack(page,role);
 if(options.financeCapability)await page.route(/\/mini-app-api(?:\?|$)/,async r=>{
  const action=r.request().postDataJSON()?.action;
  if(action!=='bootstrap')return r.fallback();
  const tables=stack.db.tables;
  await r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,user:stack.me,orders:tables.orders,users:tables.business_staff,masters:[stack.master],masterSchedule:[],claims:[],sources:[],settings:{permissions:{can_manage_orders:true,can_manage_schedule:true,can_manage_staff:false,can_review_reports:true,can_view_finance:true}}})});
 });
 await page.setViewportSize({width,height:900});
 await page.route('**/api/proxy/avito-api',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,chats:[{id:'foundation-chat',client:'Клиент',item_title:'Монтаж карниза'}],next_offset:null})}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await expect(page.locator('#roleBadge')).toContainText({owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[role]);
 return stack;
}

async function expectEqualMobileDestinations(nav,count=4){
 const geometry=await nav.evaluate(n=>{
  const s=getComputedStyle(n),r=n.getBoundingClientRect();
  const left=r.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft);
  const usable=n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
  const entries=[...n.children].filter(el=>el.matches('[data-page],[data-action]')&&getComputedStyle(el).display!=='none');
  return {tracks:s.gridTemplateColumns.split(/\s+/).length,padding:[s.paddingLeft,s.paddingRight],usable,left,
   rects:entries.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}).sort((a,b)=>a.left-b.left)};
 });
 expect(geometry.tracks).toBe(count);
 expect(geometry.padding).toEqual(['7px','7px']);
 expect(geometry.rects).toHaveLength(count);
 for(const [index,r] of geometry.rects.entries()){
  expect(Math.abs(r.width-geometry.usable/count)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.left-(geometry.left+index*geometry.usable/count))).toBeLessThanOrEqual(1);
 }
 expect(Math.abs(geometry.rects[count-1].right-(geometry.left+geometry.usable))).toBeLessThanOrEqual(1);
}

for(const role of ['dispatcher','manager','owner'])test(`approved mobile quarters ${role} with permitted finance visibility`,async({page})=>{
 await boot(page,role,360);
 const nav=page.locator('#app > nav');
 await expect(nav.locator('#bosAvitoNav')).toHaveCount(1);
 await expect(nav.locator('[data-page="finance"]')).toHaveCount(role==='dispatcher'?0:1);
 for(const width of [360,390,430]){
  await page.setViewportSize({width,height:900});
  await nav.locator('[data-page="more"]').click();
  await expect(page.locator('[data-bos-destination="finance"]')).toHaveCount(0);
  await expectEqualMobileDestinations(nav,role==='dispatcher'?4:5);
 }
 if(role!=='dispatcher'){
  await page.evaluate(()=>{state.settings.permissions.can_view_finance=false;show('home')});
  await nav.locator('[data-page="more"]').click();
  await expect(page.locator('[data-bos-destination="finance"]')).toHaveCount(0);
  await expectEqualMobileDestinations(nav);
 }
});

for(const role of ['master','dispatcher','manager','owner'])for(const width of [390,1440]){
 test(`approved shell ${role} at ${width}px`,async({page},testInfo)=>{
  await boot(page,role,width);
  await expect(page.locator('body')).toHaveClass(/bos-approved-ui/);
  const palette=await page.evaluate(()=>{
   const s=getComputedStyle(document.body);
   return {bg:s.backgroundColor,text:s.color,primary:s.getPropertyValue('--bos-ui-primary').trim(),radius:s.getPropertyValue('--bos-ui-radius').trim()};
  });
  expect(palette).toEqual({bg:'rgb(14, 20, 28)',text:'rgb(237, 242, 248)',primary:'#a8ceff',radius:'16px'});
  const nav=page.locator('#app > nav');
  if(width===1440&&role!=='master')await expect(nav.getByRole('button',{name:'Авито',exact:true})).toHaveCount(1);
  const labels=await nav.locator(':scope > [data-page]:visible, :scope > [data-action]:visible').evaluateAll(es=>es.map(e=>({label:e.textContent,left:e.getBoundingClientRect().left})).sort((a,b)=>a.left-b.left).map(x=>x.label));
  if(width<=600){const expected=['Главная',role==='master'?'Мои заявки':'Заявки','Расписание',...(['manager','owner'].includes(role)?['Финансы']:[]),role==='master'?'Профиль':'Ещё'];expect(labels).toEqual(expected);}
  else{
   expect(labels).toContain('Расписание');expect(labels).toContain(role==='master'?'Профиль':'Команда');
   if(role!=='master'){expect(labels).toContain('Авито');expect(labels).toContain('Профиль');}
   expect(labels.includes('Финансы')).toBe(['owner','manager'].includes(role));
   expect(labels.includes('Инструменты')).toBe(role==='owner');
  }
  const geometry=await nav.evaluate(n=>{
   const vw=document.documentElement.clientWidth;
   const rects=[...n.children].filter(el=>el.matches('[data-page],[data-action]')&&getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
   const r=n.getBoundingClientRect(),content=document.querySelector('#content').getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth-vw,touch:rects.every(r=>r.height>=44&&r.width>=44),width:r.width,left:r.left,contentLeft:content.left};
  });
  expect(geometry.overflow).toBe(0);expect(geometry.touch).toBe(true);
  if(width===390){await expectEqualMobileDestinations(nav,['manager','owner'].includes(role)?5:4);expect((await page.locator('#app > header').boundingBox()).height).toBeLessThanOrEqual(74);}
  if(width===1440){expect(geometry.width).toBe(222);expect(geometry.left).toBe(0);expect(geometry.contentLeft).toBeGreaterThanOrEqual(260);}
  await page.screenshot({path:testInfo.outputPath(`${role}-${width}-shell.png`),fullPage:true});
  if(role!=='master'&&width===390){
   await nav.locator('[data-page="more"]').click();
   await expect(page.locator('#content h1')).toHaveText('Ещё');
   const menu=page.locator('.bosMore');
   expect(await menu.locator('[data-bos-destination] .bosMoreText').allTextContents()).toEqual(['КомандаМастера и их загрузка','АвитоДиалоги клиентов','Мой профильЛичные данные и помощь',...(role==='owner'?['ИнструментыАдминистрирование']:[])]);
   await page.screenshot({path:testInfo.outputPath(`${role}-${width}-more.png`),fullPage:true});
   await menu.locator('[data-bos-destination="team"]').click();await expect.poll(()=>page.evaluate(()=>state.page)).toBe('team');
   await nav.locator('[data-page="more"]').click();
   await menu.locator('[data-bos-destination="avito"]').click();await expect(page.locator('.avitoChatRow')).toContainText('Монтаж карниза');
   await nav.locator('[data-page="more"]').click();await menu.locator('[data-bos-destination="profile"]').click();await expect(page.locator('.modal')).toBeVisible();
  }
 });
}

test('desktop sidebar presents the signed-in identity and approved brand',async({page})=>{
 const {me}=await boot(page,'manager',1440);
 await expect(page.locator('#app > nav .bosNavBrand')).toHaveText('BBusiness OS');
 await expect(page.locator('#app > nav .bosNavIdentity')).toContainText(me.full_name);
 await expect(page.locator('#app > nav .bosNavIdentity')).toContainText(me.city);
 await expect(page.locator('#app > header .brandText h1')).toBeHidden();
 await expect(page.locator('#roleBadge')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(page.locator('#app > nav [data-action="profile"]')).toHaveAccessibleName('Профиль');
});

test('More respects a denied finance capability and owner master preview',async({page})=>{
 const {master}=await boot(page,'owner',390);
 await page.evaluate(()=>{state.settings.permissions.can_view_finance=false;show('home')});
 await page.locator('#app > nav [data-page="more"]').click();
 await expect(page.locator('[data-bos-destination="finance"]')).toHaveCount(0);
 await page.evaluate(id=>enterMasterPreview(id),master.external_id);
 await expect(page.locator('#app > nav [data-page="more"]')).toBeHidden();
 await expect(page.locator('#app > nav [data-page="team"]')).toHaveText('Профиль');
 await page.locator('#app > nav [data-page="team"]').click();
 await expect(page.getByRole('button',{name:/Вернуться.*владельц/})).toBeVisible();
 await page.getByRole('button',{name:/Вернуться.*владельц/}).click();
 await expect(page.locator('#roleBadge')).toHaveText('Владелец');
});

test('More delegates granted dispatcher finance to its original navigation handler',async({page})=>{
 await boot(page,'dispatcher',390,{financeCapability:true});
 await expect(page.locator('#app > nav [data-page="finance"]')).toHaveCount(1);
 await page.locator('#app > nav [data-page="more"]').click();
 await expect(page.locator('[data-bos-destination="finance"]')).toBeVisible();
 await page.evaluate(()=>{const entry=document.querySelector('#app > nav [data-page="finance"]'),handler=entry.onclick;window.__financeNavigationCalls=0;entry.onclick=function(event){window.__financeNavigationCalls++;return handler.call(this,event)}});
 await page.locator('[data-bos-destination="finance"]').click();
 expect(await page.evaluate(()=>window.__financeNavigationCalls)).toBe(1);
 await expect.poll(()=>page.evaluate(()=>state.page)).toBe('finance');
});

test('approved foundation preserves breakpoint geometry and keeps inputs legible',async({page})=>{
 await boot(page,'dispatcher',360);
 for(const width of [360,430,600,601,768,850,851,1190,1191]){
  await page.setViewportSize({width,height:900});
  await page.locator(`#app > nav [data-page="${width<=600?'more':'home'}"]`).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
  if(width<=600)await expectEqualMobileDestinations(page.locator('#app > nav'));
  else{await expect(page.locator('#bosAvitoNav')).toBeVisible();expect((await page.locator('#app > nav').boundingBox()).width).toBe(width<=850?76:width<=1190?190:222);}
 }
 await page.setViewportSize({width:390,height:900});
 await page.evaluate(()=>openModal('<h2>Проверка формы</h2><input name="foundation" value="Черновик"><button class="primary">Сохранить</button>'));
 await expect(page.locator('.modal input')).toHaveCSS('font-size','16px');
 await expect(page.locator('.modal button.primary')).toHaveCSS('background-color','rgb(168, 206, 255)');
 expect((await page.locator('.modal button.primary').boundingBox()).height).toBeGreaterThanOrEqual(44);
 await expect(page.locator('.modal input')).toHaveValue('Черновик');
});
