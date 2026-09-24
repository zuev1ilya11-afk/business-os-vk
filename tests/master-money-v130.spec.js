const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

test('master v130 shows money summary and drilldown by order',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const today=iso(new Date());
  const primary=db.tables.orders.find(o=>String(o.id)==='11');
  Object.assign(primary,{
    status:'Выполнена',report_review_status:'approved',scheduled_date:today,completed_at:`${today}T12:00:00`,
    original_amount:1200,amount:1000,master_payout:552.5,
    extra_work_done:true,extra_work_description:'Установка дополнительного крепления',extra_work_amount:100,
    uncompleted_work_done:true,uncompleted_work_description:'Не установлен один держатель',uncompleted_work_amount:200,
    master_staff_id:master.id,master_name:master.full_name
  });
  const secondary={...primary,id:'13002',original_amount:2000,amount:2000,master_payout:1105,extra_work_done:false,extra_work_description:'',extra_work_amount:0,uncompleted_work_done:false,uncompleted_work_description:'',uncompleted_work_amount:0};
  db.tables.orders.splice(0,db.tables.orders.length,primary,secondary);

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_MONEY_V130===true&&window.BOS_MASTER_PROFILE_SUMMARY_V129===true);
  await page.evaluate(()=>{show('team');window.BOS_MASTER_PROFILE_SUMMARY_V129_API.refresh();window.BOS_MASTER_MONEY_V130_API.refresh()});

  const panel=page.locator('#masterProfileSummaryV129');
  const money=page.locator('#masterMoneyV130');
  await expect(panel).toBeVisible();
  await expect(money).toBeVisible();
  await expect(money.getByText('Начислено',{exact:true}).locator('..')).toContainText(/1[\s ]?757[,.]5/);
  await expect(money.getByText('Выплачено',{exact:true}).locator('..')).toContainText('Нет данных');
  await expect(money).toContainText('Фактические выплаты пока не фиксируются');

  const extraCard=panel.getByText('Допработы',{exact:true}).locator('..');
  await expect(extraCard).toHaveAttribute('role','button');
  await extraCard.click();
  await expect(page.locator('#modalRoot')).toContainText('Установка дополнительного крепления');
  await expect(page.locator('#modalRoot')).toContainText(/100/);
  await expect(page.locator('#modalRoot')).not.toContainText('Сумма для расчёта');
  await expect(page.locator('#modalRoot')).not.toContainText('До вычета');
  await page.evaluate(()=>closeModal());

  await panel.getByText('Вычеты',{exact:true}).locator('..').click();
  await expect(page.locator('#modalRoot')).toContainText('Не установлен один держатель');
  await expect(page.locator('#modalRoot')).toContainText('повторно из зарплаты не вычитается');
  await expect(page.locator('#modalRoot')).not.toContainText('Сумма для расчёта');
  await page.evaluate(()=>closeModal());

  await panel.getByText('ЗП за неделю',{exact:true}).locator('..').click();
  await expect(page.locator('#modalRoot')).toContainText('№ 11');
  await expect(page.locator('#modalRoot')).toContainText(/552[,.]5/);
  await expect(page.locator('#modalRoot')).toContainText('Итого начислено');
  await expect(page.locator('#modalRoot')).not.toContainText('Сумма для расчёта');
  await page.evaluate(()=>closeModal());

  const totalCard=panel.getByText('Общая зарплата',{exact:true}).locator('..');
  await expect(totalCard).toHaveAttribute('role','button');
  await totalCard.click();
  await expect(page.locator('#modalRoot')).toContainText('Все начисления');
  await expect(page.locator('#modalRoot')).not.toContainText('Сумма для расчёта');
  await page.evaluate(()=>closeModal());

  await money.getByText('Выплачено',{exact:true}).locator('..').click();
  await expect(page.locator('#modalRoot')).toContainText('Business OS не подставляет выдуманное значение');
  await page.evaluate(()=>closeModal());

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master v130 money block is not shown for dispatcher',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_MONEY_V130===true);
  await page.evaluate(()=>show('team'));
  await expect(page.locator('#masterMoneyV130')).toHaveCount(0);
});
