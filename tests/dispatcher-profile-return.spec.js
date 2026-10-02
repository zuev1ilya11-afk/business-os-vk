const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');
async function boot(page,role,width){
 await page.setViewportSize({width,height:900});const ctx=await fullStack(page,role);
 if(role==='owner')ctx.db.tables.business_staff.push(employee('d','dispatcher',{full_name:'Тестовый диспетчер'}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();return ctx;
}
for(const width of [360,390,430,1280])test(`owner ${width}: profile and return survive dispatcher preview on home, orders, schedule`,async({page})=>{
 await boot(page,'owner',width);
 await page.locator('#ownerToolsBtn').click();await page.getByRole('button',{name:/Тестовый диспетчер.*Открыть/}).click();
 await expect(page.locator('#roleBadge')).toContainText('Диспетчер');
 for(const name of ['home','orders','dispatch']){
  await page.locator(`nav button[data-page="${name}"]`).click();
  await page.evaluate(()=>reloadData(true));
  const p=page.locator('#profileBtn');
  await expect(p).toBeVisible();const box=await p.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.width).toBeGreaterThanOrEqual(40);
  const exit=page.getByRole('button',{name:'К владельцу',exact:true});await expect(exit).toBeVisible();const eb=await exit.boundingBox(),bb=await page.locator('#roleBadge').boundingBox();expect(Math.abs((eb.y+eb.height/2)-(bb.y+bb.height/2))).toBeLessThan(16);
  await p.click();await expect(page.getByRole('button',{name:/Вернуться.*владельц/})).toBeVisible();await page.locator('.modalClose').click();
  await page.getByRole('button',{name:'К владельцу',exact:true}).click();await expect(page.locator('#roleBadge')).toHaveText('Владелец');await expect(page.locator('#ownerToolsBtn')).toBeVisible();
  expect(await page.evaluate(()=>state.user.role)).toBe('owner');await page.locator('#ownerToolsBtn').click();await page.getByRole('button',{name:/Тестовый диспетчер.*Открыть/}).click();
 }
 await page.locator('#profileBtn').click();await page.getByRole('button',{name:/Вернуться.*владельц/}).click();await expect(page.locator('#roleBadge')).toHaveText('Владелец');
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#profileBtn')).toBeVisible();await page.locator('#ownerToolsBtn').click();await page.getByRole('button',{name:/Тестовый диспетчер.*Открыть/}).click();await page.getByRole('button',{name:'К владельцу',exact:true}).click();await expect(page.locator('#roleBadge')).toHaveText('Владелец');
});
test('real dispatcher keeps own profile across reload and cannot promote by preview controls',async({page})=>{
 await boot(page,'dispatcher',390);
 for(const name of ['home','orders','dispatch']){
  await page.locator(`nav button[data-page="${name}"]`).click();await expect(page.locator('#profileBtn')).toBeVisible();await page.locator('#profileBtn').click();await expect(page.locator('.modal')).toContainText('Мой профиль');await expect(page.locator('.modal')).toContainText('Диспетчер');await expect(page.getByRole('button',{name:/К владельцу|Вернуться.*владельц/})).toHaveCount(0);await page.locator('.modalClose').click();
 }
 await page.evaluate(()=>{enterDispatcherPreview('staff_dispatcher');exitDispatcherPreview()});expect(await page.evaluate(()=>state.user.role)).toBe('dispatcher');
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#profileBtn')).toBeVisible();await expect(page.getByRole('button',{name:'К владельцу',exact:true})).toHaveCount(0);
});
