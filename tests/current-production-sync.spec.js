const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function boot(page,role){
  const data=await fullStack(page,role);
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_EMPLOYEE_LIVE_REFRESH_V27);
  return data;
}
for(const role of ['owner','manager'])test(`${role}: employee refresh updates open profile AND underlying team without reload`,async({page})=>{
  await page.clock.install();
  const {db,master}=await boot(page,role);
  await page.locator('nav [data-page=team]').click();
  await page.getByRole('button',{name:/Тестовый мастер/}).click();
  Object.assign(db.tables.business_staff.find(x=>x.id===master.id),{phone:'+79990000099',city:'Пушкин'});
  db.tables.orders[0].status='Выполнена';
  db.tables.staff_schedule.push({staff_id:master.id,work_date:'2099-09-10',is_working:true,work_start:'12:00',work_end:'18:00'});
  await page.clock.fastForward(2600);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#modalRoot')).toContainText('+79990000099');
  await expect(page.locator('#content')).toContainText('+79990000099');
  const stateData=await page.evaluate(()=>({users:state.users,masters:state.masters,schedule:state.masterSchedule,orders:state.orders}));
  expect(stateData.users.find(x=>x.id===master.id).phone).toBe('+79990000099');
  expect(stateData.masters.find(x=>x.id===master.id).phone).toBe('+79990000099');
  expect(stateData.schedule.some(x=>x.work_start==='12:00')).toBe(true);
  expect(stateData.orders[0].status).toBe('Выполнена');
});
test('master preview refresh uses current employee rather than captured profile object',async({page})=>{
  const {db,master}=await boot(page,'owner');
  await page.evaluate(id=>enterMasterPreview(id),master.external_id);
  await page.locator('nav [data-page=team]').click();
  db.tables.business_staff.find(x=>x.id===master.id).phone='+79990000099';
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#content')).toContainText('+79990000099');
});
test('master saving profile updates users, masters and opens current home without reload',async({page})=>{
  await boot(page,'master');
  await page.locator('nav [data-page=team]').click();
  await page.getByRole('button',{name:'Редактировать профиль'}).click();
  await page.locator('#masterProfileEditForm [name=phone]').fill('+79990000099');
  await page.locator('#masterProfileEditForm [name=district]').fill('Новый район');
  await page.locator('#masterProfileEditForm button[type=submit]').click();
  await expect(page.locator('#masterProfileEditForm')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('+79990000099');
  const people=await page.evaluate(()=>[state.user,...state.users,...state.masters]);
  expect(people.every(x=>x.phone==='+79990000099'&&x.district==='Новый район')).toBe(true);
  await page.locator('nav [data-page=home]').click();
  await expect(page.getByRole('heading',{name:'Рабочий день'})).toBeVisible();
});
test('credentials save synchronizes employee state without waiting for polling',async({page})=>{
  const {master}=await boot(page,'owner');
  await page.locator('nav [data-page=team]').click();
  await page.getByRole('button',{name:'Логины и пароли'}).click();
  await page.locator('#modalRoot').getByRole('button',{name:/Тестовый мастер/}).click();
  await page.locator('#staffCredForm [name=login]').fill('updated.master');
  await page.locator('#staffCredForm [name=password]').fill('Test-only-password123');
  await page.locator('#staffCredForm button[type=submit]').click();
  await expect(page.locator('#staffCredMsg')).toContainText('сохранены');
  const users=await page.evaluate(()=>({users:state.users,masters:state.masters}));
  expect(users.users.find(x=>x.id===master.id).login).toBe('updated.master');
  expect(users.masters.find(x=>x.id===master.id).login).toBe('updated.master');
});
