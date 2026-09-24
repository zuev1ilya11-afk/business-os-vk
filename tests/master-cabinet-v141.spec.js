const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

test('master cabinet v141 shows today salary and recent completed orders in profile',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const today=iso(new Date());
  const yesterdayDate=new Date();yesterdayDate.setDate(yesterdayDate.getDate()-1);const yesterday=iso(yesterdayDate);
  const primary=db.tables.orders.find(o=>String(o.id)==='11');
  const secondary=db.tables.orders.find(o=>String(o.id)==='12')||{...primary,id:'14102'};
  Object.assign(primary,{
    status:'Выполнена',report_review_status:'approved',scheduled_date:today,completed_at:`${today}T12:00:00`,
    amount:1000,original_amount:1000,master_payout:552.5,extra_work_amount:100,uncompleted_work_amount:0,
    extra_work_description:'Дополнительное крепление',master_staff_id:master.id,master_name:master.full_name,work:'Установка карниза'
  });
  Object.assign(secondary,{
    id:String(secondary.id||'14102'),status:'Выполнена',report_review_status:'approved',scheduled_date:yesterday,completed_at:`${yesterday}T12:00:00`,
    amount:2000,original_amount:2200,master_payout:1105,extra_work_amount:0,uncompleted_work_amount:200,
    uncompleted_work_description:'Не установлен держатель',master_staff_id:master.id,master_name:master.full_name,work:'Установка штор'
  });
  db.tables.orders.splice(0,db.tables.orders.length,primary,secondary);

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_CABINET_V141===true);
  await page.locator('nav button[data-page="team"]').click();

  const panel=page.locator('#masterProfileSummaryV129');
  await expect(panel).toBeVisible();
  const todayCard=panel.locator('.masterCabinetV141Today');
  await expect(todayCard).toContainText('ЗП сегодня');
  await expect(todayCard).toContainText(/652[,.]5/);

  const completed=page.locator('#masterCabinetV141Completed');
  await expect(completed).toBeVisible();
  await expect(completed.getByText('Выполненные заявки',{exact:true})).toBeVisible();
  await expect(completed.locator('.masterCabinetV141Order')).toHaveCount(2);
  await expect(completed).toContainText('Установка карниза');
  await expect(completed).toContainText(/652[,.]5/);
  await expect(completed).toContainText('вычет');

  await todayCard.click();
  await expect(page.locator('#modalRoot')).toContainText('ЗП сегодня');
  await expect(page.locator('#modalRoot')).toContainText(/652[,.]5/);
  await expect(page.locator('#modalRoot')).toContainText('Допработы');
  await page.evaluate(()=>closeModal());

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
