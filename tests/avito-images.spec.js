const {test,expect}=require('@playwright/test');
const fixtureCors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-bos-session,x-vk-launch-params,authorization,apikey','access-control-allow-methods':'GET,POST,OPTIONS'};
const {fullStack}=require('./helpers/full-stack.cjs');
const preview='https://img.k.avito.ru/chat/640x480/example.jpg',original='https://img.k.avito.ru/chat/1280x960/example.jpg';
const fixture='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><rect width="1280" height="960" fill="#bdcddc"/><rect x="160" y="240" width="960" height="480" rx="28" fill="#53728c"/><path d="M200 600h880M340 280v400M640 280v400M940 280v400" stroke="#e6edf4" stroke-width="24"/></svg>';
async function setup(page,width=1440,broken=false){
 await page.setViewportSize({width,height:900});const x=await fullStack(page,'owner'),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const messages=[{id:'text',type:'text',text:'Фото кровати',direction:'in',created_at:'2026-09-30T15:41:00Z'},{id:'image',type:'image',text:'Нужно закрепить каркас',image:{url:original,preview_url:preview},direction:'in',created_at:'2026-09-30T15:42:00Z'},{id:'reply',type:'text',text:'Посмотрю крепления',direction:'out',created_at:'2026-09-30T15:43:00Z'}];
 await page.route('https://img.k.avito.ru/**',route=>broken?route.abort():route.fulfill({headers:fixtureCors,contentType:'image/svg+xml',body:fixture}));
 await page.route('**/api/proxy/avito-api',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:fixtureCors,body:''});const b=route.request().postDataJSON();calls.push(b);return route.fulfill({headers:fixtureCors,contentType:'application/json',body:JSON.stringify(b.action==='chats'?{ok:true,chats:[{id:'photo-chat',client:'Клиент',item_title:'Ремонт кровати',last_message:'Фото',unread_count:1}],next_offset:null}:b.action==='messages'?{ok:true,messages,next_offset:null}:{ok:true})})});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('#bosAvitoNav').click();await page.locator('.avitoChatRow').click();await expect(page.locator('.avitoBubble')).toHaveCount(3);
 return {...x,messages,calls,errors};
}
for(const width of [320,1440])test('Avito photos render inline and open a keyboard-accessible viewer at '+width+'px',async({page})=>{
 const x=await setup(page,width),button=page.getByRole('button',{name:'Открыть фото из Авито'}),photo=button.locator('img');
 await expect.poll(()=>photo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);await expect(photo).toHaveAttribute('src',preview);await expect(page.locator('#avitoMessages')).toContainText('Нужно закрепить каркас');await expect(page.locator('#avitoMessages')).not.toContainText('[image]');
 await page.locator('#avitoSendForm textarea').fill('Сохранить черновик');const before=x.db.tables.orders.length;
 await button.click();const viewer=page.getByRole('dialog',{name:'Фото из Авито'});await expect(viewer).toBeVisible();await expect(viewer.locator('img')).toHaveAttribute('src',original);await expect.poll(()=>viewer.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await expect(page.getByRole('button',{name:'Закрыть фото'})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('link',{name:'Открыть оригинал'})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Закрыть фото'})).toBeFocused();
 const box=await viewer.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.y+box.height).toBeLessThanOrEqual(901);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
 if(process.env.BOS_CAPTURE)await page.screenshot({path:'/workspace/scratch/5af1b07488a7/avito-photo-viewer-'+width+'.png'});
 await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Сохранить черновик');await expect(button).toBeFocused();
 await button.click();await page.goBack();await expect(viewer).toHaveCount(0);await expect(page.locator('.avitoWorkspace')).toBeVisible();await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Сохранить черновик');
 expect(x.calls.some(c=>c.action==='sendMessage')).toBe(false);expect(x.db.tables.orders).toHaveLength(before);expect(x.errors).toEqual([]);
});
test('unchanged polling keeps loaded photos and draft in place; unsafe URLs stay inert',async({page})=>{
 const x=await setup(page),photo=page.locator('.avitoImageButton img');await expect.poll(()=>photo.evaluate(img=>img.naturalWidth>0)).toBe(true);
 await photo.evaluate(img=>img.dataset.retained='yes');await page.locator('#avitoSendForm textarea').fill('Черновик');await page.locator('#avitoRefresh').click();await expect(photo).toHaveAttribute('data-retained','yes');await expect(page.locator('#avitoSendForm textarea')).toHaveValue('Черновик');
 const unsafe=['javascript:alert(1)','data:image/svg+xml,unsafe','https://avito.ru.evil.test/a.jpg','https://user:password@img.k.avito.ru/a.jpg'];
 x.messages.push(...unsafe.map((url,i)=>({id:'bad'+i,type:'image',image:{url,preview_url:url},text:'<img src=x onerror=alert(1)>',created_at:'2026-09-30T15:44:00Z'})),{id:'missing',type:'image',created_at:'2026-09-30T15:45:00Z'});
 await page.locator('#avitoRefresh').click();await expect(page.locator('.avitoBubble')).toHaveCount(8);await expect(page.locator('.avitoImageButton')).toHaveCount(1);await expect(page.locator('#avitoMessages img')).toHaveCount(1);await expect(page.locator('#avitoMessages')).toContainText('Фото недоступно');await expect(page.locator('#avitoMessages')).toContainText('<img src=x onerror=alert(1)>');expect(x.errors).toEqual([]);
});
test('failed image downloads leave readable fallbacks and a working conversation',async({page})=>{
 const x=await setup(page,390,true),button=page.getByRole('button',{name:'Открыть фото из Авито'});await expect(button).toContainText('Фото не загрузилось');await expect(button.locator('img')).toBeHidden();
 await button.click();await expect(page.locator('.avitoImageStatus')).toContainText('Фото не удалось загрузить');await expect(page.getByRole('link',{name:'Открыть оригинал'})).toHaveAttribute('href',original);await page.getByRole('button',{name:'Закрыть фото'}).click();await expect(page.locator('#avitoSendForm')).toBeVisible();await expect(page.locator('#avitoMessages')).toContainText('Посмотрю крепления');expect(x.errors).toEqual([]);
});
