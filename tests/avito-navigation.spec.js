const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page,role,width){
 const stack=await fullStack(page,role);const calls=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});
 await page.route('**/api/proxy/avito-api',route=>{
  calls.push(route.request().postDataJSON());
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,chats:[{id:'nav-chat',client:'Клиент Авито',item_title:'Установка карниза'}],next_offset:null})});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>typeof pages.avito==='function');
 return {...stack,calls,errors};
}
for(const role of ['owner','manager','dispatcher'])for(const width of [320,1440]){
 test(role+' has a one-click Avito entry at '+width+'px',async({page})=>{
  const x=await setup(page,role,width),nav=page.locator('#app > nav'),entry=nav.getByRole('button',{name:'Авито',exact:true});
  await expect(entry).toBeVisible();await expect(entry).toHaveAttribute('aria-controls','content');
  const keys=await nav.locator(':scope > *').evaluateAll(els=>els.filter(el=>el.id==='bosAvitoNav'||el.dataset.page).map(el=>el.id==='bosAvitoNav'?'avito':el.dataset.page));
  expect(keys).toEqual(['home','orders','avito','dispatch','team',...(['owner','manager'].includes(role)?['finance']:[])]);
  await expect(nav.locator('[data-page=dispatch]')).toHaveText('График');
  await expect(nav.locator('[data-page=team]')).toHaveText(role==='dispatcher'?'Мастера':'Команда');
  const geometry=await nav.evaluate(n=>{
   const vw=document.documentElement.clientWidth;
   const rects=[...n.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
   return {touch:rects.every(r=>r.width>=44&&r.height>=44),inside:rects.every(r=>r.left>=-1&&r.right<=vw+1),sameRow:rects.every(r=>Math.abs(r.top-rects[0].top)<2)};
  });
  expect(geometry.touch).toBe(true);expect(geometry.inside).toBe(true);
  if(width<1024){expect(geometry.sameRow).toBe(true);await expect(nav.locator('[data-action=profile]')).toBeHidden();}
  expect(x.calls).toHaveLength(0);
  await entry.click();await expect(page.locator('.avitoChatRow')).toContainText('Установка карниза');
  expect(x.calls.map(c=>c.action)).toEqual(['chats']);
  expect(await page.evaluate(()=>state.page)).toBe('avito');
  await expect(entry).toHaveAttribute('aria-current','page');await expect(page.locator('.modal')).toHaveCount(0);
  for(const pageName of ['orders','dispatch','home']){
   await nav.locator('[data-page='+pageName+']').click();
   await expect.poll(()=>page.evaluate(()=>state.page)).toBe(pageName);await expect(entry).toHaveCount(1);
  }
  await expect(nav.locator('[data-page=dispatch]')).toHaveText('График');
  expect(x.errors).toEqual([]);
 });
}
test('Avito is absent for a live master and during owner master preview',async({page})=>{
 await setup(page,'master',390);await expect(page.locator('#bosAvitoNav')).toHaveCount(0);
 await page.locator('nav [data-page=orders]').click();await expect(page.locator('#bosAvitoNav')).toHaveCount(0);
});
test('owner preview, keyboard activation and Android back preserve the working page',async({page})=>{
 const x=await setup(page,'owner',390),entry=page.locator('#bosAvitoNav');
 await expect(entry).toBeVisible();
 await page.evaluate(()=>{previewRole='master';previewUser=state.users.find(u=>u.role==='master');show('home')});
 await expect(entry).toHaveCount(0);
 await page.evaluate(()=>exitMasterPreview());await expect(entry).toHaveCount(1);
 await page.locator('nav [data-page=orders]').click();await expect.poll(()=>page.evaluate(()=>state.page)).toBe('orders');
 await entry.focus();await page.keyboard.press('Space');await expect(page.locator('.avitoChatRow')).toBeVisible();
 await page.goBack();await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>state.page)).toBe('orders');await expect(entry).toHaveCount(1);
 await entry.focus();await page.keyboard.press('Enter');await expect(page.locator('.avitoChatRow')).toBeVisible();
 await page.evaluate(()=>show('orders'));
 await page.evaluate(()=>{window.BUSINESS_OS_CONFIG.AVITO_API_ENABLED=false;show('home')});
 await expect(entry).toHaveCount(0);expect(x.errors).toEqual([]);
});
