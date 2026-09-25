const {test,expect}=require('@playwright/test');
async function authPage(page){
 await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
 await page.goto('/?vk_app_id=54758847&vk_user_id=123456789&sign=test');
}
for(const status of [401,403,500])test(`VK HTTP ${status} displays server error and does not retry a valid HTTP response`,async({page})=>{
 let attempts=0,direct=0;
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',r=>{direct++;return r.abort()});
 await page.route('**/api/proxy/vk-session-api',r=>{attempts++;return r.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:false,error:`Проверка ${status}`})})});
 await authPage(page);await expect(page.locator('#authGate')).toContainText(`Проверка ${status}`);expect(attempts).toBe(1);expect(direct).toBe(0);
 await page.getByRole('button',{name:'Повторить вход через VK'}).click();await expect.poll(()=>attempts).toBe(2);
});
test('alternate primary gateway network failure falls back to Netlify before direct Edge',async({page})=>{
 let secondary=0,direct=0;
 await page.route('https://business-os-api-gateway-ukp6ew.v2.appdeploy.ai/api/proxy/vk-session-api',r=>r.abort('failed'));
 await page.route('https://business-os-api-gateway.netlify.app/api/proxy/vk-session-api',r=>{secondary++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"Резервный шлюз отвечает"}'})});
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',r=>{direct++;return r.abort()});
 await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Резервный шлюз отвечает',{timeout:8000});expect(secondary).toBe(1);expect(direct).toBe(0);
});
test('offline gateways fall back to direct Supabase Edge API',async({page})=>{
 let direct=0;
 await page.route('**/api/proxy/**',r=>r.abort('failed'));
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',r=>{direct++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"Прямой резерв отвечает"}'})});
 await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Прямой резерв отвечает',{timeout:8000});expect(direct).toBe(1);await expect(page.getByRole('button',{name:'Повторить вход через VK'})).toBeVisible();
});
test('stale gateway SERVICE_NOT_ALLOWED falls back to direct Supabase Edge API',async({page})=>{
 let direct=0;
 await page.route('**/api/proxy/vk-session-api',r=>r.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"SERVICE_NOT_ALLOWED"}'}));
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',r=>{direct++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"Прямой резерв после SERVICE_NOT_ALLOWED"}'})});
 await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Прямой резерв после SERVICE_NOT_ALLOWED',{timeout:8000});expect(direct).toBe(1);
});
test('hanging gateways switch to direct API before outer auth deadline',async({page})=>{
 test.setTimeout(15000);let direct=0;
 await page.route('**/api/proxy/**',()=>{});
 await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',r=>{direct++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"Резерв после таймаута"}'})});
 await authPage(page);
 await expect(page.locator('#authGate')).toContainText('Резерв после таймаута',{timeout:8000});expect(direct).toBe(1);await expect(page.getByRole('button',{name:'Повторить вход через VK'})).toBeVisible();
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
