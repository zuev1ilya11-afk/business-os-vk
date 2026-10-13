const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');
const {navigate}=require('./helpers/approved-navigation.cjs');
async function boot(page,role){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.setViewportSize({width:390,height:844});const ctx=await fullStack(page,role);
 ctx.db.tables.business_staff.push(employee('review-manager','manager',{full_name:'Руководитель проверки'}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok'));
 return ctx;
}
for(const role of ['manager','owner'])test(`${role} member back returns to team and recent order opens`,async({page})=>{
 await boot(page,role);await navigate(page,'team');
 await page.locator('.compactTeamCard').filter({hasText:'Тестовый мастер'}).click();
 await page.getByRole('button',{name:'← К списку сотрудников',exact:true}).click();
 await expect(page.locator('#modalRoot .modal')).toHaveCount(0);await expect(page.locator('.compactTeamCard')).not.toHaveCount(0);
 await page.locator('.compactTeamCard').filter({hasText:'Тестовый мастер'}).click();
 await page.locator('.bosEmployeeRecentOrder').first().click();await expect(page.locator('#modalRoot')).toContainText('Невский 1');
});
test('owner tools have one materials entry and a real manager preview with return',async({page})=>{
 await boot(page,'owner');await page.locator('#ownerToolsBtn').click();
 await expect(page.locator('#modalRoot button[onclick="openOwnerMemoManager()"]')).toHaveCount(1);
 const manager=page.locator('.managerPreviewTool');await expect(manager).toBeVisible();await manager.click();
 await expect(page.locator('body')).toHaveAttribute('data-bos-ui-role','manager');
 await page.locator('#profileBtn').click();
 await page.getByRole('button',{name:/Вернуться к владельцу|Вернуться в профиль владельца|К владельцу/}).first().click();
 await expect(page.locator('body')).toHaveAttribute('data-bos-ui-role','owner');
});
for(const role of ['manager','owner'])test(`${role} browser Back closes finance and employee details without leaving their workspace`,async({page})=>{
 await boot(page,role);await page.locator('nav [data-page=finance]').click();await page.locator('.finPeriodControl summary').click();await page.locator('[data-fin-period=all]').click();await page.locator('[data-fin-tab=orders]').click();
 await page.locator('[data-fin-key="order:11"] [data-fin-order]').click();await expect(page.locator('#modalRoot .modal')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kind)).toBe('modal');await page.goBack();await expect(page.locator('#modalRoot .modal')).toHaveCount(0);await expect(page.locator('#financePage')).toBeVisible();
 await navigate(page,'team');await page.locator('.compactTeamCard').filter({hasText:'Тестовый мастер'}).click();await expect(page.locator('#modalRoot .modal')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kind)).toBe('modal');await page.goBack();await expect(page.locator('#modalRoot .modal')).toHaveCount(0);await expect(page.locator('.compactTeamCard').first()).toBeVisible();
});
