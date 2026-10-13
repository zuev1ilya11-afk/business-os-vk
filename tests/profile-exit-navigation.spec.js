const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher profile keeps the original logout after its settings',async({page})=>{
 await fullStack(page,'dispatcher');await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 await page.locator('#profileBtn').click();
 await expect(page.locator('.bosManagementProfileMenu [data-bos-shared=about]')).toBeVisible();
 await expect(page.locator('#bosOwnerLogout')).toBeVisible();
 await expect.poll(()=>page.locator('#bosOwnerLogout').evaluate(e=>e.parentElement.lastElementChild===e)).toBe(true);
});

test('owner master preview returns to owner without showing master account logout',async({page})=>{
 const {master}=await fullStack(page,'owner');await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(id=>enterMasterPreview(id),master.external_id);
 await page.locator('nav [data-page=team]').click();
 await expect(page.locator('.bosProfileMenu [data-bos-shared=about]')).toBeVisible();
 await expect(page.locator('.bosProfileMenu [data-bos-shared=logout]')).toHaveCount(0);
 await page.getByRole('button',{name:/Вернуться к владельцу/}).click();
 await expect(page.locator('body')).toHaveAttribute('data-bos-ui-role','owner');
 expect(await page.evaluate(()=>state.user.role)).toBe('owner');
});
