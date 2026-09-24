const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master order v126 highlights next step and keeps mobile actions usable',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  master.phone='+79990000001';
  Object.assign(order,{
    phone:'+79990000002',
    client:'Анна Пичуева',
    scheduled_date:'2099-09-10',
    scheduled_time:'10:00',
    master_workflow_stage:'started',
    master_called_at:'2099-09-10T06:30:00.000Z',
    master_agreed_at:'2099-09-10T06:40:00.000Z',
    master_started_at:'2099-09-10T07:00:00.000Z',
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null,
    status:'В работе',
    amount:2800,
    work:'Монтаж рулонной шторы ×2 шт.\nПодрезка рулонной шторы ×1 шт.'
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_ORDER_FOCUS_V126===true);
  await page.locator('nav button[data-page="orders"]').click();

  const card=page.locator('.masterV125Card[data-master-order-id="11"]');
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Открыть заявку',exact:true}).click();

  const focus=page.locator('.masterV126Focus');
  await expect(focus).toBeVisible();
  await expect(focus.getByRole('heading',{name:'Заполните отчёт'})).toBeVisible();
  await expect(focus).toContainText('После завершения прикрепите отчёт');

  const phone=page.locator('.masterV126Phone');
  await expect(phone).toHaveAttribute('href','tel:+79990000002');
  await expect(page.getByRole('button',{name:'Заполнить отчёт',exact:true})).toBeVisible();

  const actions=page.locator('.bosMasterWorkflow .mwv2Actions');
  await expect(actions).toBeVisible();
  expect(await actions.evaluate(el=>getComputedStyle(el).position)).toBe('static');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});