const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function boot(page,role='master',width=390){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.setViewportSize({width,height:844});
 await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'));
 const ctx=await fullStack(page,role);
 Object.assign(ctx.db.tables.orders[0],{scheduled_date:'2026-10-08',scheduled_time:'19:00',master_agreed_at:'2026-10-08T08:00:00Z',master_contact_status:'agreed',master_contact_comment:'Встреча у подъезда',phone:'+79990000002, +79990000003'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok'));
 return ctx;
}
test('master compact day keeps first action visible and preserves search/date through refresh',async({page})=>{
 await boot(page);const home=page.locator('#masterDailyV127');
 await expect(home.getByRole('heading',{name:'Мой день',exact:true})).toBeVisible();
 await expect(page.locator('#masterHomeSearch')).toBeHidden();
 const action=home.locator('[data-home-action=departed]').first();await expect(action).toBeVisible();
 expect((await action.boundingBox()).y+(await action.boundingBox()).height).toBeLessThan(750);
 await home.getByRole('button',{name:'Поиск и дата',exact:true}).click();
 await page.getByLabel('Дата визита').fill('2026-10-08');await page.getByRole('searchbox',{name:'Поиск заявок'}).fill('Невский');
 await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(page.getByRole('searchbox',{name:'Поиск заявок'})).toHaveValue('Невский');
 await expect(page.getByLabel('Дата визита')).toHaveValue('2026-10-08');
 await home.getByRole('button',{name:'Поиск и дата',exact:true}).click();
 await expect(page.locator('#masterHomeSearch')).toBeHidden();
 await expect(home.locator('.masterV127Card')).toHaveCount(1);
});
test('master card body and keyboard open once; nested contact action opens only contact',async({page})=>{
 await boot(page);await page.evaluate(()=>{window.__openCount=0;const base=window.openOrder;window.openOrder=function(...args){window.__openCount++;return base.apply(this,args)}});const card=page.locator('.masterV127Card[data-order-id="11"]');
 await card.locator('.masterV127Address').click();await expect(page.locator('.bosCompactMasterCard')).toBeVisible();
 expect(await page.evaluate(()=>window.__openCount)).toBe(1);await page.evaluate(()=>closeModal());await card.focus();await page.keyboard.press('Enter');
 await expect(page.locator('.bosCompactMasterCard')).toBeVisible();await page.evaluate(()=>closeModal());
 await card.locator('[data-home-action=result]').click();
 await expect(page.locator('[data-contact-phone]')).toHaveCount(2);await page.locator('[data-contact-phone]').first().click();await expect(page.locator('.bosContactResult')).toBeVisible();await expect(page.locator('.bosCompactMasterCard')).toHaveCount(0);expect(await page.evaluate(()=>window.__openCount)).toBe(2);
});
for(const role of ['manager','owner'])test(`${role} finance is a direct permitted mobile tab with working registry rows`,async({page})=>{
 await boot(page,role);const nav=page.locator('#app > nav');
 await expect(nav.locator('[data-page=finance]')).toBeVisible();await nav.locator('[data-page=finance]').click();
 await expect(page.locator('#financePage')).toBeVisible();await expect(page.locator('[data-fin-tab]')).toHaveCount(7);
 await page.locator('[data-fin-tab=orders]').click();const row=page.locator('[data-fin-key="order:11"]');
 await row.locator('[data-label="Работы"]').click();await expect(page.locator('#modalRoot')).toContainText('Невский');
 await page.evaluate(()=>closeModal());
 await page.evaluate(()=>{state.settings.permissions.can_view_finance=false;show('home')});
 await expect(nav.locator('[data-page=finance]')).toBeHidden();
});
for(const role of ['dispatcher','manager','owner'])test(`${role} control card opens the existing order from its body`,async({page})=>{
 await boot(page,role);
 if(role==='dispatcher')await page.locator('#app > nav [data-page=orders]').click();
 await page.locator('[data-oc-home-filter=unassigned],button#bosOrderControlEntry[data-oc-enter]').first().click();
 const card=page.locator('[data-oc-order="12"]');await expect(card).toBeVisible();
 await card.locator('.ocWork').click();await expect(page.locator('#modalRoot')).toContainText('Другой адрес');
});
