const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

async function openCabinet(page,role='master',width=390,time='2026-09-30T09:00:00Z'){
 await page.clock.install({time:new Date(time)});
 await page.setViewportSize({width,height:900});
 const data=await fullStack(page,role),{db,master}=data,template={...db.tables.orders[0]};
 db.tables.business_staff.push(employee('other','master',{full_name:'Другой мастер'}));
 const done=(id,date,amount,extra=0)=>({...template,id,status:'Выполнена',report_review_status:'approved',scheduled_date:date.slice(0,10),completed_at:date,amount,extra_work_amount:extra,uncompleted_work_amount:0,master_staff_id:master.id,master_name:master.full_name});
 db.tables.orders=[done('11','2026-09-30T09:00:00Z',1000,100),done('12','2026-09-27T20:59:59Z',2000),done('13','2026-09-27T21:00:00Z',3000),done('14','2026-08-31T12:00:00Z',4000),{...done('15','2026-09-30T10:00:00Z',10000),status:'В работе',report_review_status:'pending'},{...done('16','2026-09-30T10:00:00Z',50000),master_staff_id:'other'}];
 db.tables.orders[0].uncompleted_work_amount=200;
 db.tables.orders[0].uncompleted_work_description='Не установлен держатель';
 db.tables.orders[0].extra_work_description='Дополнительное крепление';
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 if(role==='owner')await page.evaluate(id=>enterMasterPreview(id),master.external_id);
 await page.evaluate(()=>show('team'));
 await expect(page.locator('#masterMoneyV130')).toBeVisible();
 return data;
}
const hero=page=>page.locator('.salaryHero');
const range=page=>page.locator('[data-salary-range]');

for(const [role,width] of [['master',390],['owner',1280]])test(`${role}: salary periods filter own completed orders and keep the approved payroll formula`,async({page})=>{
 const {db}=await openCabinet(page,role,width),panel=page.locator('#masterMoneyV130');
 await expect(panel.getByRole('button',{name:'Неделя',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(range(page)).toHaveText('28.09.2026 — 04.10.2026');
 await expect(hero(page)).toContainText(/2[\s ]?310/);
 await expect(panel.locator('.salaryOrder')).toHaveCount(2);
 await expect(panel).not.toContainText('№ 16');await expect(panel).not.toContainText('№ 15');
 await panel.locator('[data-master-money-kind="deductions"]').click();
 await expect(page.locator('#modalRoot')).toContainText('повторно из зарплаты не вычитается');
 await expect(page.locator('#modalRoot')).toContainText('Не установлен держатель');await page.evaluate(()=>closeModal());
 await panel.locator('[data-money-action="previous"]').click();
 await expect(range(page)).toHaveText('21.09.2026 — 27.09.2026');await expect(hero(page)).toContainText(/1[\s ]?105/);
 await page.evaluate(()=>BOS_REFRESH_NOW());await expect(range(page)).toHaveText('21.09.2026 — 27.09.2026');
 await panel.getByRole('button',{name:'К текущему',exact:true}).click();await expect(hero(page)).toContainText(/2[\s ]?310/);
 await panel.getByRole('button',{name:'Месяц',exact:true}).click();await expect(hero(page)).toContainText(/3[\s ]?415/);
 await panel.locator('[data-money-action="history"][data-start="2026-08-01"]').click();await expect(hero(page)).toContainText(/2[\s ]?210/);
 await panel.getByRole('button',{name:'Свои даты',exact:true}).click();
 await panel.locator('[name="start"]').fill('2026-08-01');await panel.locator('[name="end"]').fill('2026-09-27');
 db.tables.orders[0].client='Обновлённое имя клиента';await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(panel.locator('[name="start"]')).toHaveValue('2026-08-01');await expect(panel.locator('[name="end"]')).toHaveValue('2026-09-27');
 await panel.getByRole('button',{name:'Показать',exact:true}).click();
 await expect(hero(page)).toContainText(/3[\s ]?315/);await expect(panel.locator('.salaryOrder')).toHaveCount(2);
 await panel.locator('[name="start"]').fill('2026-09-28');await panel.getByRole('button',{name:'Показать',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('начало не позже окончания');
 await expect(hero(page)).toContainText(/3[\s ]?315/);
 await panel.getByRole('button',{name:'К текущему',exact:true}).click();
 await panel.locator('[data-v130-order="11"]').click();await expect(page.locator('#modalRoot')).toContainText('Отчёт принят');await page.evaluate(()=>closeModal());
 await panel.getByRole('button',{name:'День',exact:true}).click();await panel.locator('[data-money-field="anchor"]').fill('2026-09-26');
 await expect(hero(page)).toContainText('0 ₽');await expect(panel.locator('.salaryOrders')).toContainText('За выбранный период начислений нет');
 await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(db.calls.filter(c=>c.table==='orders'&&c.mode==='update')).toHaveLength(0);
});

for(const [kind,time,before,after] of [
 ['week','2026-10-04T20:59:00Z','28.09.2026 — 04.10.2026','05.10.2026 — 11.10.2026'],
 ['month','2026-09-30T20:59:00Z','01.09.2026 — 30.09.2026','01.10.2026 — 31.10.2026'],
 ['day','2026-09-30T20:59:00Z','30.09.2026','01.10.2026']
])test(`${kind}: current salary rolls over at Moscow midnight without losing history`,async({page})=>{
 const {db,master}=await openCabinet(page,'master',390,time);
 const base={...db.tables.orders[0],extra_work_amount:0,uncompleted_work_amount:0};
 db.tables.orders=[{...base,id:'11',amount:1000,completed_at:time},{...base,id:'12',amount:2000,completed_at:time.replace('20:59:00','21:00:00')}];
 await page.evaluate(()=>BOS_REFRESH_NOW());
 await page.locator(`[data-money-action="kind"][data-kind="${kind}"]`).click();
 await expect(range(page)).toHaveText(before);await expect(hero(page)).toContainText(/552[,.]5/);
 await page.clock.fastForward(61000);
 await expect(range(page)).toHaveText(after);await expect(hero(page)).toContainText(/1[\s ]?105/);
 await page.locator('[data-money-action="previous"]').click();await expect(range(page)).toHaveText(before);await expect(hero(page)).toContainText(/552[,.]5/);
});

test('historical week stays selected when a new week starts and current week is one click away',async({page})=>{
 await openCabinet(page,'master',390,'2026-10-04T20:59:00Z');
 await page.locator('[data-money-action="previous"]').click();await expect(range(page)).toHaveText('21.09.2026 — 27.09.2026');
 await page.clock.fastForward(61000);await expect(range(page)).toHaveText('21.09.2026 — 27.09.2026');
 await page.getByRole('button',{name:'К текущему',exact:true}).click();await expect(range(page)).toHaveText('05.10.2026 — 11.10.2026');
});
