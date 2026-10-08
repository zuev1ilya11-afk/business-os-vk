const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

test('master home keeps time and stage readable and preserves all real works',async({page})=>{
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  Object.assign(order,{
    scheduled_date:localToday(),
    scheduled_time:'10:00',
    time_slot:'10:00–11:00',
    master_workflow_stage:'started',
    master_called_at:new Date().toISOString(),
    master_agreed_at:new Date().toISOString(),
    work:[
      'Монтаж рулонной шторы\\рулонной шторы «день-ночь» на створку окна × 2 PIECE',
      'Минимальная стоимость заказа, светозащита и карнизы × 1 PIECE',
      'Подрезка рулонной шторы день-ночь × 1 PIECE',
      'Дополнительная работа × 1 PIECE'
    ].join('\n')
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_MASTER_HOME_ORDERS_V124&&!!window.BOS_MASTER_DAILY_HOME_V127);

  const today=page.locator('.masterV127Next[data-order-id="11"]');
  await expect(today).toBeVisible();
  await expect(today.locator('.masterV127When b')).toHaveText('10:00');
  await expect(today.locator('.masterV127Main strong')).toHaveText('Заполнить отчёт');

  const layout=await today.evaluate(card=>{
    const time=card.querySelector('.masterV127When b'),main=card.querySelector('.masterV127Main'),stage=card.querySelector('.masterV127Main strong');
    const tr=time.getBoundingClientRect(),mr=main.getBoundingClientRect(),sr=stage.getBoundingClientRect();
    return{timeHeight:tr.height,stageLeft:sr.left,mainLeft:mr.left,stageHeight:sr.height};
  });
  expect(layout.timeHeight).toBeLessThan(38);
  expect(layout.stageLeft).toBeGreaterThanOrEqual(layout.mainLeft-1);
  expect(layout.stageHeight).toBeLessThan(34);

  const upcoming=page.locator('.masterV127Next[data-order-id="11"]');
  await expect(upcoming).toBeVisible();
  const summary=upcoming.locator('.masterV127Work');
  await expect(summary).toContainText('Монтаж рулонной шторы');
  await expect(summary).toContainText('× 2 PIECE');
  await expect(summary).toContainText('Минимальная стоимость заказа');
  await expect(summary).toContainText('Подрезка');
  await expect(summary).toContainText('Дополнительная');

  await upcoming.getByRole('button',{name:/^Открыть заявку №/}).click();
  const modal=page.locator('#modalRoot .modal').last();
  await expect(modal).toContainText('Подрезка рулонной шторы');
  await expect(modal).toContainText('Дополнительная работа');
});
