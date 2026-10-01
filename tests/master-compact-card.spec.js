const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const work='Монтаж рулонной шторы — без сверления крепёжной системы';
async function open(page,width,role='master',source='Hands'){
 await page.setViewportSize({width,height:1000});const ctx=await fullStack(page,role);
 Object.assign(ctx.db.tables.orders[0],{external_source:source==='Hands'?'hands':'mini_app',source,external_id:source==='Hands'?'hands:TEST-123':'app_test_123',client:'Тестовый клиент',phone:'+79990000002',address:'Санкт-Петербург, очень длинное название тестовой улицы, дом 100, корпус 12',apartment:'кв. 42',comment:'Необходимо позвонить перед приездом. '+('Длинный тестовый комментарий для проверки полного раскрытия. '.repeat(8)),work:work+' × 2 шт.\nУстановка направляющей × 1,5 м\nТретья услуга без сокращений × 3 шт.\nЧетвёртая услуга × 1 шт.',scheduled_date:'2099-09-10',scheduled_time:'10:00',created_at:'2026-10-01T08:00:00Z',master_workflow_stage:'assigned'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await expect(page.locator('.bosCompactMasterCard')).toBeVisible();return ctx;
}
for(const width of [360,390,430])test(`${width}: compact card, exact titles, expand/collapse, phone and sequential progress`,async({page},info)=>{
 const {db}=await open(page,width),card=page.locator('.bosCompactMasterCard'),modal=page.locator('.bosCompactOrderModal');
 await expect(card.locator('.bosApartment')).toHaveText('кв. 42');await expect(card.locator('.bosHandsAddressLink')).toHaveAttribute('href',/yandex.ru\/maps/);
 await expect(card.locator('.bosCompactClient').getByRole('link',{name:'Позвонить клиенту',exact:true})).toHaveAttribute('href','tel:+79990000002');
 await expect(modal.getByText('Связь с клиентом',{exact:true})).toHaveCount(0);await expect(modal.locator('.masterV126Focus,.masterV149Route,.masterV126ReceivedModal')).toHaveCount(0);
 await expect(card.locator('.bosHandsWorkRow:visible')).toHaveCount(2);await expect(card.getByText(work,{exact:true})).toBeVisible();await expect(card.getByText('1,5 м',{exact:true})).toBeVisible();
 await card.getByText('Ещё 2 работы',{exact:true}).click();await expect(card.locator('.bosHandsWorkRow:visible')).toHaveCount(4);await card.getByText('Свернуть работы',{exact:true}).click();await expect(card.locator('.bosHandsWorkRow:visible')).toHaveCount(2);
 await card.getByText('Показать полностью',{exact:true}).click();await expect(card.locator('.bosOrderComment p')).toHaveText(db.tables.orders[0].comment);await card.getByText('Свернуть комментарий',{exact:true}).click();
 expect((await modal.locator('.moa179StageCard').boundingBox()).height).toBeLessThan(400);
 await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow','25');await expect(modal.locator('.moa179Action')).toHaveCount(1);await expect(modal.locator('.moa179Step.future button')).toHaveCount(0);
 for(const el of [card,modal,modal.locator('.moa179StageCard')])expect(await el.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const client=card.locator('.bosMasterClientActions');await expect(client.getByRole('button',{name:'Подтвердить договорённость'})).toBeDisabled();await client.getByRole('button',{name:'Звонок выполнен'}).click();await client.getByRole('button',{name:'Подтвердить договорённость'}).click();await expect(client).toContainText('Время согласовано');
 await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();
 await modal.getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
 await modal.evaluate(e=>e.scrollTop=0);
 await modal.screenshot({path:info.outputPath(`card-${width}.png`)});
 await modal.getByRole('button',{name:'Подтвердить: начал работу',exact:true}).click();await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow','75');
 await modal.getByRole('button',{name:'Отправить отчёт',exact:true}).click();await expect(page.locator('#masterReportForm')).toBeVisible();await expect(page.getByText('Сделано не всё',{exact:true})).toBeVisible();
});
test('master has no edit controls; missing optional data and full unbroken titles fit',async({page})=>{
 const {db}=await open(page,360);Object.assign(db.tables.orders[0],{apartment:null,comment:null,phone:null,work:'Оченьдлинноенепрерывноеназвание'.repeat(15),address:'Длинныйадрес'.repeat(30)});
 await page.evaluate(async()=>{await reloadData(true);openOrder('11')});const modal=page.locator('.bosCompactOrderModal');await expect(modal.locator('input,textarea')).toHaveCount(0);await expect(modal.locator('.bosApartment,.bosOrderComment')).toHaveCount(0);await expect(modal).toContainText('Телефон не указан');expect(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.evaluate(()=>openOrderForm('11'));await expect(page.locator('#orderForm')).toHaveCount(0);
});
for(const role of ['owner','manager','dispatcher'])test(`${role}: edit apartment/comment in existing form and see saved fields after reload`,async({page})=>{
 const {db}=await fullStack(page,role);Object.assign(db.tables.orders[0],{phone:'+79990000002',apartment:'8',comment:'От Hands',scheduled_time:'10:00',time_slot:'10:00–11:00'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrderForm('11'));const form=page.locator('#orderForm');await expect(form).toBeVisible();await form.locator('[name=apartment]').fill('12А');await form.locator('[name=comment]').fill('Локальный комментарий');await form.locator('button[type=submit]').click();await expect(form).toBeHidden();
 expect(db.tables.orders[0].apartment).toBe('12А');expect(db.tables.orders[0].comment).toBe('Локальный комментарий');expect(db.tables.orders[0].hands_detail_overrides).toEqual({apartment:true,comment:true});
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrderForm('11'));await expect(page.locator('[name=apartment]')).toHaveValue('12А');await expect(page.locator('[name=comment]')).toHaveValue('Локальный комментарий');await page.locator('[name=comment]').fill('');await page.locator('#orderForm button[type=submit]').click();await expect(page.locator('#orderForm')).toBeHidden();expect(db.tables.orders[0].comment).toBe('');
});
for(const source of ['Hands','Авито'])test(`${source}: header money and full calculation preserve source rules`,async({page})=>{
 await open(page,390,'master',source);const card=page.locator('.bosCompactMasterCard');if(source==='Hands'){await expect(card).not.toContainText('Стоимость:');await expect(card.locator('.bosCompactCost')).toHaveCount(0);await expect(card.locator('.bosCompactMoney')).toContainText('552,5')}else{await expect(card.locator('.bosCompactMoney')).toContainText('Стоимость: 1');await expect(card.locator('.bosCompactMoney')).toContainText('600');await card.locator('.bosCompactCost>summary').click();await expect(card.locator('[data-cost-total]')).toContainText('1');await expect(card).toContainText('Мастеру — 60% основных работ')}
});
