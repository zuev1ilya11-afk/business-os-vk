const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test.use({isMobile:true,hasTouch:true,serviceWorkers:'block'});

const actions=['ownerToolsBtn','bosManualRefresh','bosNotificationBell','profileBtn'];
const widths=[320,360,375,390,414,430];
const scenarios=[
 {name:'mobile browser',insets:{top:0,left:0,right:0}},
 {name:'PWA safe area',insets:{top:59,left:0,right:0}},
 {name:'side safe areas',insets:{top:59,left:24,right:24}}
];

async function boot(page,browserName,width,insets,standalone=false){
 await page.setViewportSize({width,height:900});
 // Only synthetic API fixtures; no requests reach the production server.
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await fullStack(page,'owner');
 if(standalone)await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
 if(browserName==='chromium'){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets});
 }else{
  // Desktop WebKit has no notch override. Substitute only environment values
  // in the real CSS, leaving its layout rules intact. This is not device QA.
  await page.route('**/*.css*',async route=>{
   const response=await route.fetch();
   const body=(await response.text()).replace(/env\(safe-area-inset-(top|left|right)(?:,\s*0px)?\)/g,(_,side)=>`${insets[side]}px`);
   await route.fulfill({response,body});
  });
 }
 await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 for(const id of actions)await expect(page.locator('#'+id)).toBeVisible();
 await expect(page.locator('#bosNotificationBell .bosNB')).toBeVisible();
}

async function geometry(page){
 return page.evaluate(ids=>{
  const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const buttons=ids.map(id=>{const el=document.getElementById(id),box=rect(el),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return {id,...box,reachable:hit===el||el.contains(hit)}});
  const role=document.getElementById('roleBadge');
  return {buttons,role:rect(role),roleFits:role.scrollWidth<=role.clientWidth+1,header:rect(document.querySelector('#app > header')),content:rect(document.getElementById('content')),badge:rect(document.querySelector('#bosNotificationBell .bosNB')),bellPosition:getComputedStyle(document.getElementById('bosNotificationBell')).position,overflow:document.documentElement.scrollWidth-innerWidth};
 },actions);
}

for(const {name,insets} of scenarios)for(const width of widths){
 test(`${name} ${width}: role and all actions fit below system chrome`,async({page,browserName},info)=>{
  await boot(page,browserName,width,insets,name==='PWA safe area');
  await expect(page.locator('#roleBadge')).toBeVisible();
  const g=await geometry(page);
  await info.attach('header-geometry',{body:JSON.stringify(g,null,2),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('header.png'),clip:{x:0,y:0,width,height:200}});
  expect(g.roleFits).toBe(true);
  expect(g.role.width).toBeGreaterThan(50);
  expect(g.role.bottom).toBeLessThanOrEqual(g.header.bottom);
  expect(g.role.left).toBeGreaterThanOrEqual(Math.max(12,insets.left));
  expect(g.role.top).toBeGreaterThanOrEqual(insets.top+8);
  expect(g.buttons[0].left-g.role.right).toBeGreaterThanOrEqual(6);
  for(const [index,b] of g.buttons.entries()){
   expect(b.top).toBeGreaterThanOrEqual(insets.top+8);
   expect(b.width).toBeGreaterThanOrEqual(44);
   expect(b.width).toBeLessThanOrEqual(48);
   expect(b.height).toBe(b.width);
   expect(b.right).toBeLessThanOrEqual(width-Math.max(12,insets.right));
   expect(b.reachable).toBe(true);
   if(index)expect(b.left-g.buttons[index-1].right).toBeGreaterThanOrEqual(6);
  }
  const bell=g.buttons.find(b=>b.id==='bosNotificationBell');
  expect(g.bellPosition).toBe('relative');
  expect(g.badge.top).toBeGreaterThanOrEqual(bell.top);
  expect(g.badge.right).toBeLessThanOrEqual(bell.right);
  expect(g.badge.left).toBeGreaterThanOrEqual(bell.left);
  expect(g.badge.bottom).toBeLessThanOrEqual(bell.bottom);
  expect(g.content.top).toBeGreaterThanOrEqual(g.header.bottom);
  expect(g.overflow).toBeLessThanOrEqual(1);
  const install=page.locator('#app > header > .bosInstallAppBtn--header');
  if(name==='PWA safe area')await expect(install).toBeHidden();
  else{
   await expect(install).toBeVisible();
   const box=await install.boundingBox();
   expect(box.y).toBeGreaterThanOrEqual(g.buttons[3].bottom+6);
   expect(box.x).toBeGreaterThanOrEqual(Math.max(12,insets.left));
   expect(box.x+box.width).toBeLessThanOrEqual(width-Math.max(12,insets.right));
  }
  await expect(page.locator('meta[name=viewport]')).toHaveCount(1);
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content',/viewport-fit=cover/);
 });
}

for(const width of [320,430,1440])test(`header actions ${width}: native tools, refresh, notifications and profile`,async({page,browserName})=>{
 await boot(page,browserName,width,{top:0,left:0,right:0});
 await page.locator('#ownerToolsBtn').click();
 await expect(page.locator('#modalRoot .modal')).toContainText('Инструменты владельца');
 await page.locator('.modalClose').click();
 await page.evaluate(()=>{window.__headerRefreshSeen=false;window.addEventListener('bos:employee-data-refreshed',e=>{if(e.detail.reason==='manual')window.__headerRefreshSeen=true})});
 await page.locator('#bosManualRefresh').click();
 await expect.poll(()=>page.evaluate(()=>window.__headerRefreshSeen)).toBe(true);
 await page.locator('#bosNotificationBell').click();
 const panel=page.getByRole('region',{name:'Центр уведомлений'});
 await expect(panel).toBeVisible();
 await expect(panel).toContainText('Без мастера');
 await panel.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.locator('#profileBtn').click();
 await expect(page.locator('#modalRoot .modal')).toContainText('Профиль владельца');
});
