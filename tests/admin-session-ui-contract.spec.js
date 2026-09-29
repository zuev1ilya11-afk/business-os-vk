const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');

test('owner integrations open with the actual password login session',async({page})=>{
 const {db}=await fullStack(page);db.tables.api_integrations=[];
 const login=await edge('password-session-api',db)({action:'login',login:'owner',password:'audit-password'});
 expect(login.status).toBe(200);
 await page.addInitScript(t=>{localStorage.setItem('bos_vk_session_v2',t);sessionStorage.setItem('bos_vk_session_v2',t)},login.body.session_token);
 const api=edge('integration-api',db);
 await page.route('**/integration-api',async r=>{const out=await api(r.request().postDataJSON(),'100',r.request().headers()['x-bos-session']);await r.fulfill({status:out.status,json:out.body});});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openApiIntegrations());
 await expect(page.getByRole('button',{name:'+ Добавить интеграцию'})).toBeVisible();
 await expect(page.locator('#modalRoot')).not.toContainText('Требуются права владельца');
});

test('own credentials reject short input before sending and save the server-supported length',async({page})=>{
 const {db}=await fullStack(page);const api=edge('password-session-api',db);let calls=0;
 await page.route('**/password-session-api',async r=>{const b=r.request().postDataJSON();if(b.action==='setCredentials')calls++;const out=await api(b,'100',r.request().headers()['x-bos-session']);await r.fulfill({status:out.status,json:out.body});});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_OPEN_AUTH_SETTINGS());
 const form=page.locator('#bosCredForm');await form.locator('[name=login]').fill('owner');await form.locator('[name=password]').fill('123456');
 expect(await form.evaluate(f=>f.checkValidity())).toBe(false);
 await form.getByRole('button',{name:'Сохранить логин и пароль'}).click();expect(calls).toBe(0);
 await form.locator('[name=password]').fill('fixture-password');await form.getByRole('button',{name:'Сохранить логин и пароль'}).click();
 await expect(page.locator('#bosCredMsg')).toContainText('сохранены');expect(calls).toBe(1);
 expect((await api({action:'login',login:'owner',password:'fixture-password'})).status).toBe(200);
});

test('manager sees staff details without credential form and can still restore staff',async({page})=>{
 const {db,master}=await fullStack(page,'manager');const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=team]').click();
 await expect(page.getByRole('button',{name:'Логины и пароли',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Сотрудники',exact:true}).click();await page.locator('#modalRoot').getByRole('button',{name:/Тестовый мастер/}).click();
 await expect(page.locator('#staffCredForm')).toHaveCount(0);await expect(page.locator('#modalRoot')).toContainText('настраивает владелец');
 db.tables.business_staff.find(s=>s.id===master.id).is_active=false;
 await page.evaluate(()=>openStaffAccess('inactive'));await page.locator('#modalRoot').getByRole('button',{name:/Тестовый мастер/}).click();
 await page.getByRole('button',{name:'Вернуть сотрудника'}).click();
 await expect.poll(()=>db.tables.business_staff.find(s=>s.id===master.id).is_active).toBe(true);
 expect(errors).toEqual([]);
});
