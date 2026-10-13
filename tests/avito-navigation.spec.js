const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page,role,width){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
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
for(const role of ['owner','manager','dispatcher'])for(const width of [320,900,1440]){
 test(role+' reaches Avito through approved navigation at '+width+'px',async({page},testInfo)=>{
  const x=await setup(page,role,width),nav=page.locator('#app > nav'),entry=nav.locator('#bosAvitoNav');
  if(width<=600){await expect(entry).toBeHidden();await expect(nav.locator('[data-page=more]')).toBeVisible();}
  else await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-controls','content');
  const keys=await nav.locator(':scope > *').evaluateAll(els=>els.filter(el=>el.id==='bosAvitoNav'||el.dataset.page).map(el=>el.id==='bosAvitoNav'?'avito':el.dataset.page));
  expect(keys.filter(key=>key!=='more')).toEqual(['home','orders','avito','dispatch','team',...(['owner','manager'].includes(role)?['finance']:[])]);
  expect(keys.filter(key=>key==='more')).toHaveLength(1);
  await expect(nav.locator('[data-page=dispatch]')).toHaveText('Расписание');
  await expect(nav.locator('[data-page=team]')).toHaveText('Команда');
  const geometry=await nav.evaluate(n=>{
   const vw=document.documentElement.clientWidth;
   const rects=[...n.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
   return {touch:rects.every(r=>r.width>=44&&r.height>=44),inside:rects.every(r=>r.left>=-1&&r.right<=vw+1),sameRow:rects.every(r=>Math.abs(r.top-rects[0].top)<2)};
  });
  expect(geometry.touch).toBe(true);expect(geometry.inside).toBe(true);
  if(width<=600){expect(geometry.sameRow).toBe(true);await expect(nav.locator('[data-action=profile]')).toBeHidden();}
  if(width===900){
   await expect(nav.locator('[data-action=profile]')).toBeVisible();
   for(const intermediate of [601,850,851,900,1023]){
    await page.setViewportSize({width:intermediate,height:900});
    await expect(nav.locator('[data-action=profile]')).toBeVisible();
    const row=await entry.evaluate(el=>{
     const css=getComputedStyle(el),peer=el.parentElement.querySelector('[data-page="orders"]'),p=getComputedStyle(peer),r=el.getBoundingClientRect(),pr=peer.getBoundingClientRect();
     return {direction:css.flexDirection,font:css.fontSize,gap:css.columnGap,padding:css.padding,peerDirection:p.flexDirection,peerFont:p.fontSize,peerGap:p.columnGap,peerPadding:p.padding,width:r.width,peerWidth:pr.width,height:r.height,peerHeight:pr.height};
    });
    expect(row.direction).toBe('row');expect(row.font).toBe(intermediate<=850?'0px':'14px');expect(row.gap).toBe(intermediate<=850?'0px':'13px');
    expect(row.direction).toBe(row.peerDirection);expect(row.font).toBe(row.peerFont);expect(row.gap).toBe(row.peerGap);expect(row.padding).toBe(row.peerPadding);
    expect(row.width).toBe(row.peerWidth);expect(row.height).toBe(row.peerHeight);
    expect((await nav.boundingBox()).width).toBe(intermediate<=850?76:190);
    expect((await page.locator('#content').boundingBox()).x).toBeGreaterThanOrEqual(intermediate<=850?102:215);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
   }
   await page.setViewportSize({width,height:900});
   await page.screenshot({path:testInfo.outputPath(`${role}-${width}-shell.png`),fullPage:true});
  }
  expect(x.calls).toHaveLength(0);
  if(width<=600){await nav.locator('[data-page=more]').click();await page.locator('[data-bos-destination=avito]').click();}else await entry.click();
  await expect(page.locator('.avitoChatRow')).toContainText('Установка карниза');
  expect(x.calls.map(c=>c.action)).toEqual(['chats']);
  expect(await page.evaluate(()=>state.page)).toBe('avito');
  await expect(entry).toHaveAttribute('aria-current','page');await expect(page.locator('.modal')).toHaveCount(0);
  if(width>600){await expect(entry).toHaveCSS('background-color','rgb(36, 54, 78)');await expect(entry).toHaveCSS('color','rgb(237, 242, 248)');}
  for(const pageName of ['orders','dispatch','home']){
   await nav.locator('[data-page='+pageName+']').click();
   await expect.poll(()=>page.evaluate(()=>state.page)).toBe(pageName);await expect(entry).toHaveCount(1);
  }
  await expect(nav.locator('[data-page=dispatch]')).toHaveText('Расписание');
  if(width===900){await nav.locator('[data-action=profile]').click();await expect(page.locator('.modal')).toBeVisible();}
  expect(x.errors).toEqual([]);
 });
}
test('Avito is absent for a live master and during owner master preview',async({page})=>{
 await setup(page,'master',390);await expect(page.locator('#bosAvitoNav')).toHaveCount(0);
 await page.locator('nav [data-page=orders]').click();await expect(page.locator('#bosAvitoNav')).toHaveCount(0);
});
test('owner preview, keyboard activation and Android back preserve the working page',async({page})=>{
 const x=await setup(page,'owner',390),entry=page.locator('#bosAvitoNav');
 await expect(entry).toBeHidden();
 await page.evaluate(()=>{previewRole='master';previewUser=state.users.find(u=>u.role==='master');show('home')});
 await expect(entry).toHaveCount(0);
 await page.evaluate(()=>exitMasterPreview());await expect(entry).toHaveCount(1);
 await page.locator('nav [data-page=orders]').click();await expect.poll(()=>page.evaluate(()=>state.page)).toBe('orders');
 await page.locator('nav [data-page=more]').click();await page.locator('[data-bos-destination=avito]').focus();await page.keyboard.press('Space');await expect(page.locator('.avitoChatRow')).toBeVisible();
 await page.goBack();await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>state.page)).toBe('more');await expect(entry).toHaveCount(1);
 await page.locator('[data-bos-destination=avito]').focus();await page.keyboard.press('Enter');await expect(page.locator('.avitoChatRow')).toBeVisible();
 await page.evaluate(()=>show('orders'));
 await page.evaluate(()=>{window.BUSINESS_OS_CONFIG.AVITO_API_ENABLED=false;show('home')});
 await expect(entry).toHaveCount(0);expect(x.errors).toEqual([]);
});
