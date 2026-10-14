const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {fullStack}=require('./helpers/full-stack.cjs');

const runtime=path.join(__dirname,'..','mobile-viewport.js');
const desktopUA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const notice=page=>page.locator('#bosMobileViewportNotice');

async function fixture(page,meta='width=device-width,initial-scale=1,viewport-fit=cover'){
 await page.route('**/mobile-viewport-regression-fixture',route=>route.fulfill({
  contentType:'text/html',
  body:`<!doctype html><html lang="ru"><head><meta charset="UTF-8">${meta===null?'':`<meta name="viewport" content="${meta}">`}<style>html,body{margin:0}#app{width:100%;box-sizing:border-box}input{font-size:16px}</style></head><body><div id="app"><input aria-label="Черновик" value="Не потерять"><main>Рабочий экран</main></div></body></html>`
 }));
 await page.goto('/mobile-viewport-regression-fixture');
}

test('phone with an ignored viewport shows readable Chrome recovery without discarding the working screen',async({browser,baseURL})=>{
 // A desktop layout viewport on a physically narrow touch screen models the
 // observed failure. Changing the UA alone would still honor mobile metadata.
 const context=await browser.newContext({baseURL,viewport:{width:980,height:2121},screen:{width:390,height:844},hasTouch:true,isMobile:false,userAgent:desktopUA});
 try{
  const page=await context.newPage();await fullStack(page,'master');await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  expect(await page.evaluate(()=>({layout:innerWidth,screen:screen.width,coarse:matchMedia('(pointer:coarse)').matches}))).toEqual({layout:980,screen:390,coarse:true});
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(/Версия для ПК|Desktop site/i);
  const geometry=await notice(page).evaluate(node=>{
   const ratio=innerWidth/screen.width,box=node.getBoundingClientRect();
   const text=node.querySelector('p')||node;
   const button=node.querySelector('button'),buttonBox=button.getBoundingClientRect();
   return {textSize:parseFloat(getComputedStyle(text).fontSize)/ratio,buttonWidth:buttonBox.width/ratio,buttonHeight:buttonBox.height/ratio,left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
  });
  expect(geometry.textSize).toBeGreaterThanOrEqual(14);
  expect(geometry.buttonWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await notice(page).getByRole('button').click();await expect(notice(page)).toHaveCount(0);
  await expect(page.locator('#content')).toBeVisible();
  await page.locator('#app > nav [data-page=orders]').click();await expect(page.locator('#content')).toContainText('Мои заявки');
 }finally{await context.close()}
});

for(const device of [
 {name:'ordinary phone',viewport:{width:390,height:844},screen:{width:390,height:844},isMobile:true,hasTouch:true},
 {name:'touch tablet',viewport:{width:768,height:1024},screen:{width:768,height:1024},isMobile:true,hasTouch:true},
 {name:'desktop',viewport:{width:1440,height:900},screen:{width:1920,height:1080},isMobile:false,hasTouch:false},
 {name:'touch laptop',viewport:{width:1440,height:900},screen:{width:1920,height:1080},isMobile:false,hasTouch:true},
 {name:'landscape phone',viewport:{width:844,height:390},screen:{width:844,height:390},isMobile:true,hasTouch:true}
]){
 test(`${device.name} keeps its normal viewport without a recovery notice`,async({browser,baseURL})=>{
  const {name,...options}=device,context=await browser.newContext({baseURL,...options});
  try{
   const page=await context.newPage();await fixture(page);
   const before=await page.evaluate(()=>({width:innerWidth,meta:document.querySelector('meta[name=viewport]').content}));
   await page.addScriptTag({path:runtime});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await expect(notice(page)).toHaveCount(0);
   expect(await page.evaluate(()=>({width:innerWidth,meta:document.querySelector('meta[name=viewport]').content}))).toEqual(before);
   await expect(page.getByRole('textbox',{name:'Черновик'})).toHaveValue('Не потерять');
  }finally{await context.close()}
 });
}

for(const meta of [null,'width=980']){
 test(`real mobile viewport restores ${meta===null?'missing':'incorrect'} metadata without browser recovery`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},screen:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
   const page=await context.newPage();await fixture(page,meta);
   // Prove this fixture actually begins with the reported desktop breakpoint.
   expect(await page.evaluate(()=>innerWidth)).toBeGreaterThan(600);
   await page.addScriptTag({path:runtime});
   await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(390);
   await expect(notice(page)).toHaveCount(0);
   expect(await page.evaluate(()=>document.querySelector('meta[name=viewport]').content)).toContain('width=390');
   await expect(page.getByRole('textbox',{name:'Черновик'})).toHaveValue('Не потерять');
  }finally{await context.close()}
 });
}

test('pinch zoom and resize events preserve zoom and viewport metadata',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},screen:{width:390,height:844},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();await fixture(page);await page.addScriptTag({path:runtime});
  const meta=await page.locator('meta[name=viewport]').getAttribute('content');
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
  await expect.poll(()=>page.evaluate(()=>visualViewport.scale)).toBeGreaterThanOrEqual(1.9);
  await page.evaluate(()=>{dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('resize'))});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toBe(meta);
  expect(await page.evaluate(()=>visualViewport.scale)).toBeGreaterThanOrEqual(1.9);
  await expect(notice(page)).toHaveCount(0);
 }finally{await context.close()}
});

test('overflowing phone content is not mistaken for a desktop layout viewport',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},screen:{width:390,height:844},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();await fixture(page);
  await page.locator('#app').evaluate(node=>node.style.width='980px');
  expect(await page.evaluate(()=>innerWidth)).toBeGreaterThan(600);
  expect(await page.evaluate(()=>matchMedia('(min-width:601px)').matches)).toBe(false);
  const meta=await page.locator('meta[name=viewport]').getAttribute('content');
  await page.addScriptTag({path:runtime});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toBe(meta);
  await expect(notice(page)).toHaveCount(0);
 }finally{await context.close()}
});

test('recovery dialog contains keyboard focus and restores the focused draft when dismissed',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:980,height:2121},screen:{width:390,height:844},hasTouch:true,isMobile:false});
 try{
  const page=await context.newPage();await fixture(page);
  const draft=page.getByRole('textbox',{name:'Черновик'});await draft.focus();
  await page.addScriptTag({path:runtime});await expect(notice(page)).toBeVisible();
  const button=notice(page).getByRole('button',{name:'Понятно'});await expect(button).toBeFocused();
  await page.keyboard.press('Tab');await expect(button).toBeFocused();
  await page.keyboard.press('Escape');await expect(notice(page)).toHaveCount(0);
  await expect(draft).toBeFocused();await expect(draft).toHaveValue('Не потерять');
 }finally{await context.close()}
});
