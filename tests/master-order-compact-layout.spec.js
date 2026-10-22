const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test.use({timezoneId:'America/Los_Angeles'}); // The visit labels must still use Moscow.
async function open(page,patch={},width=390){
 await page.setViewportSize({width,height:844});
 await page.clock.setFixedTime(new Date('2026-10-22T21:30:00Z'));
 const ctx=await fullStack(page,'master');
 Object.assign(ctx.db.tables.orders[0],{
  order_number:'TEST-1022',client:'Тестовый клиент',phone:'+70000000001',address:'Тестовая улица, дом 12',apartment:'8',floor:'3',
  received_date:'2026-10-20',scheduled_date:'2026-10-23',scheduled_time:'14:00',master_agreed_at:'2026-10-22T10:00:00Z',
  master_called_at:'2026-10-22T10:00:00Z',master_called_by_staff_id:ctx.me.id,master_called_by_name:ctx.me.full_name,
  master_contact_status:'agreed',master_contact_history:[{result:'agreed',phone:'+70000000001',at:'2026-10-22T10:00:00Z',comment:'Позвонить у подъезда.'}],
  work:'3 шторы 6 направляющих\nМонтаж шторы × 2 шт.\nПодрезка × 1,5 м',
  work_items:[{name:'Монтаж шторы',quantity:2,unit:'шт.'},{name:'Подрезка',quantity:1.5,unit:'м'}],...patch
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrder('11'));await expect(page.locator('.bosMasterWorkflow[data-bos-v179="1"]')).toBeVisible();
 return ctx;
}
for(const width of [360,390,430,1280])test(`compact layout at ${width}: visit, next step and call fit; details scroll`,async({page},info)=>{
 const {db}=await open(page,{},width),before=structuredClone(db.tables.orders[0]),card=page.locator('.bosCompactMasterCard');
 await expect(card.locator('.bosOrderVisit')).toContainText('Сегодня');
 await expect(card.locator('.bosOrderVisit')).toContainText('14:00');
 await expect(card.getByText('Тестовая улица, дом 12',{exact:true})).toHaveCount(1);
 await expect(card.locator('.bosHandsHead')).not.toContainText('Поступила');
 await expect(card.locator('.bosOrderAdditional')).not.toHaveAttribute('open','');
 await expect(card.getByRole('button',{name:'Помощь по заявке',exact:true})).toBeHidden();
 const call=card.locator('a[aria-label="Позвонить клиенту"]'),primary=card.getByRole('button',{name:'Подтвердить: выехал',exact:true});
 for(const target of [call,primary,card.locator('.bosOrderVisit')]){
  const box=await target.boundingBox(),modal=await page.locator('.bosCompactOrderModal').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(modal.y);expect(box.y+box.height).toBeLessThanOrEqual(modal.y+modal.height);
 }
 expect((await primary.boundingBox()).height).toBeGreaterThanOrEqual(44);
 expect((await primary.boundingBox()).width).toBeGreaterThan((await card.boundingBox()).width-35);
 await expect(card.getByRole('button',{name:'Запросить перенос',exact:true})).toHaveCount(1);
 await expect(card.locator('.bosHandsWorkRow')).toHaveCount(2);
 await expect(card.locator('.bosWorkDescription')).toHaveText('3 шторы 6 направляющих');
 await expect(card.locator('.bosWorksLabel')).toHaveText('Работы (2)');
 await expect(card.locator('.bosHandsWorkRow').nth(1)).toContainText('1,5 м');
 await expect(card.locator('.bosMasterContactSummary')).not.toContainText('+70000000001');
 await expect(card.locator('.bosMasterContactSummary')).toContainText('Позвонить у подъезда.');
 await page.screenshot({path:info.outputPath(`master-${width}.png`)});
 await card.locator('.bosOrderAdditional>summary').click();
 await card.getByRole('button',{name:'Помощь по заявке',exact:true}).scrollIntoViewIfNeeded();
 await expect(card.getByRole('button',{name:'Помощь по заявке',exact:true})).toBeVisible();
 expect(await page.locator('.bosCompactOrderModal').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(db.tables.orders[0]).toEqual(before);
 await card.getByRole('button',{name:'Закрыть заявку',exact:true}).click();await expect(card).toHaveCount(0);
});

test('missing data and missing payout are explicit, zero payout stays zero',async({page})=>{
 const {db}=await open(page,{phone:null,address:null,apartment:null,floor:null,scheduled_date:null,scheduled_time:null,time_slot:null,amount:null,master_payout:null,amount_confirmed:false,work_items:[{name:'Работа без количества'}],work:'Работа без количества'});
 const card=page.locator('.bosCompactMasterCard');
 for(const text of ['Дата не назначена','Время не назначено','Адрес не указан','Телефон не указан','Выплата мастеру: Не рассчитана'])await expect(card).toContainText(text);
 await expect(card.locator('.bosHandsWorkRow b')).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Договориться',exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:'Подтвердить: выехал',exact:true})).toHaveCount(0);
 Object.assign(db.tables.orders[0],{master_payout:0,amount_confirmed:true});
 await page.evaluate(async()=>{await reloadData(true);openOrder('11')});
 await expect(card.locator('.bosCompactMoney')).toContainText('Выплата мастеру: 0 ₽');
 // The existing bootstrap calculates a numeric payout. Also exercise a partial
 // client payload directly, without changing that server/payroll contract.
 await page.evaluate(()=>{const o=state.orders.find(x=>String(x.id)==='11');delete o.master_payout;delete o.amount;openOrder('11')});
 await expect(card.locator('.bosCompactMoney')).toContainText('Выплата мастеру: Не рассчитана');
});

test('tomorrow and time range use saved visit data',async({page})=>{
 await open(page,{scheduled_date:'2026-10-24',scheduled_time:null,time_slot:'14:00–16:00'});
 await expect(page.locator('.bosOrderVisit')).toContainText('Завтра');
 await expect(page.locator('.bosOrderVisit')).toContainText('14:00–16:00');
});

test('description-only intake is not converted into counted positions',async({page})=>{
 await open(page,{work_items:[],work:'3 шторы 6 направляющих\nПозвонить перед визитом'});
 await expect(page.locator('.bosWorksLabel')).toHaveText('Работы');
 await expect(page.locator('.bosHandsWorkRow')).toHaveCount(0);
 await expect(page.locator('.bosWorkDescription')).toHaveText('3 шторы 6 направляющих\nПозвонить перед визитом');
});

for(const [patch,label,percent] of [
 [{master_workflow_stage:'assigned'},'Подтвердить: выехал','25'],
 [{master_workflow_stage:'departed',master_departed_at:'2026-10-22T10:00:00Z'},'Начать работу','50'],
 [{master_workflow_stage:'started',master_started_at:'2026-10-22T10:30:00Z'},'Отправить отчёт','75'],
 [{master_workflow_stage:'started',report_review_status:'rejected'},'Исправить отчёт','75'],
 [{status:'Выполнена',report_review_status:'approved',report_uploaded_at:'2026-10-22T11:00:00Z'},'Посмотреть отчёт','100']
])test(`saved state selects ${label}`,async({page})=>{
 await open(page,patch);const card=page.locator('.bosCompactMasterCard');
 await expect(card.getByRole('button',{name:label,exact:true})).toBeEnabled();
 await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow',percent);
 await expect(card.locator('.bosDetailFooter>.primary')).toHaveCount(1);
});

test('cancelled order cannot progress or request a transfer',async({page})=>{
 await open(page,{status:'Отменена'});const card=page.locator('.bosCompactMasterCard');
 await expect(card).toContainText('Заявка отменена');
 await expect(card.locator('.moa179Action')).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Запросить перенос',exact:true})).toHaveCount(0);
});

test('manual completion does not invent departure, work or report confirmations',async({page})=>{
 await open(page,{status:'Выполнена',master_workflow_stage:'assigned',master_departed_at:null,master_started_at:null,report_uploaded_at:null,report_review_status:null});
 await expect(page.locator('.moa179Step.done')).toHaveCount(1);
 await expect(page.locator('.bosCompactMasterCard .moa179Action')).toHaveCount(0);
});

test('refresh updates the only visit card when dispatcher changes saved schedule',async({page})=>{
 const {db}=await open(page);
 Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-24',scheduled_time:'18:30',address:'Другой тестовый адрес',apartment:'19'});
 await page.evaluate(async()=>{await reloadData(true);window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH()});
 const visit=page.locator('.bosOrderVisit');
 await expect(visit).toContainText('Завтра');await expect(visit).toContainText('18:30');
 await expect(visit).toContainText('Другой тестовый адрес');await expect(visit).not.toContainText('Тестовая улица');
 await expect(page.locator('.bosCompactMasterCard').getByText('Другой тестовый адрес',{exact:true})).toHaveCount(1);
});

test('long values and contact comment stay readable without nested scroll',async({page})=>{
 const comment='Полный комментарий. '.repeat(40);
 await open(page,{client:'Оченьдлинноеимя'.repeat(18),address:'Длинныйадрес'.repeat(30),work_items:[{name:'Длиннаяработа'.repeat(35),quantity:2,unit:'шт.'}],work:'Независимое описание',master_contact_history:[{result:'no_answer',comment,at:'2026-10-22T10:00:00Z'}],master_contact_status:'no_answer',master_agreed_at:null},360);
 const card=page.locator('.bosCompactMasterCard');
 await expect(card.locator('.bosMasterContactSummary .confirmed')).toHaveCount(0);
 await card.locator('.bosMasterContactSummary').getByText('Подробнее',{exact:true}).click();
 await expect(card.locator('.bosContactComment')).toHaveText(comment.trim());
 await card.locator('.bosOrderAdditional>summary').click();
 await card.locator('.bosOrderContactHistory>summary').click();
 await card.locator('.bosContactHistory').scrollIntoViewIfNeeded();
 expect(await card.locator('.bosContactHistory').evaluate(e=>getComputedStyle(e).overflowY)).toBe('visible');
 expect(await page.locator('.bosCompactOrderModal').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
});
