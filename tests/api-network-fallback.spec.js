const {test,expect}=require('@playwright/test');
// main ea3d6f5 removed direct fallback. Exercise the active auth transport.
async function authPage(page){
 await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
 await page.goto('/?vk_app_id=54758847&vk_user_id=123456789&sign=test');
}
for(const status of [401,403,500])test(`VK HTTP ${status} displays server error and retries only on click`,async({page})=>{
 let attempts=0,direct=0;
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/**',r=>{direct++;return r.abort()});
 await page.route('**/api/proxy/vk-session-api',r=>{attempts++;return r.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:false,error:`Проверка ${status}`})})});
 await authPage(page);await expect(page.locator('#authGate')).toContainText(`Проверка ${status}`);expect(attempts).toBe(1);expect(direct).toBe(0);
 await page.getByRole('button',{name:'Повторить вход через VK'}).click();await expect.poll(()=>attempts).toBe(2);
});
test('offline gateway gives Russian error without direct fallback',async({page})=>{
 await page.route('**/api/proxy/**',r=>r.abort('failed'));await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Не удалось связаться с сервером');await expect(page.getByRole('button',{name:'Повторить вход через VK'})).toBeVisible();
});
test('hanging gateway ends loader within transport deadline',async({page})=>{
 test.setTimeout(35000);await page.route('**/api/proxy/**',()=>{});await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Сервер не ответил',{timeout:25000});await expect(page.getByRole('button',{name:'Повторить вход через VK'})).toBeVisible();
});
test('failed password login keeps entered values for retry',async({page})=>{
 await page.route('**/api/proxy/password-session-api',r=>r.fulfill({status:500,contentType:'application/json',body:'{"ok":false,"error":"Временная ошибка"}'}));
 await page.goto('/');await page.locator('#simplePassForm [name=login]').fill('audit');await page.locator('#simplePassForm [name=password]').fill('test-password');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.locator('#simplePassMsg')).toHaveText('Временная ошибка');await expect(page.locator('#simplePassForm [name=login]')).toHaveValue('audit');await expect(page.locator('#simplePassForm [name=password]')).toHaveValue('test-password');
});
test('double password submit sends one auth request',async({page})=>{
 let calls=0;await page.route('**/api/proxy/password-session-api',async r=>{calls++;await new Promise(resolve=>setTimeout(resolve,300));await r.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Неверный пароль"}'})});await page.goto('/');await page.locator('#simplePassForm [name=login]').fill('audit');await page.locator('#simplePassForm [name=password]').fill('test-password');await page.locator('#simplePassForm').evaluate(f=>{f.requestSubmit();f.requestSubmit()});await expect(page.locator('#simplePassMsg')).toHaveText('Неверный пароль');expect(calls).toBe(1);
});
test('unresponsive VK Bridge cannot leave auth spinning forever',async({page})=>{
 await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:()=>new Promise(()=>{})};'}));await page.goto('/?force_vk_auth=1');await expect(page.getByRole('button',{name:'Повторить вход через VK'})).toBeVisible({timeout:12000});
});
test('malformed success response is an error rather than an empty successful result',async({page})=>{
 await page.goto('/');await page.route('**/api/proxy/mini-app-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":'}));
 expect(await page.evaluate(()=>BOS_POST('https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api',{action:'bootstrap'}).then(()=> 'accepted',e=>e.message))).toBe('Сервер вернул некорректный ответ. Повторите попытку.');
});
