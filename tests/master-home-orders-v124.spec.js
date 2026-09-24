const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

test('master home keeps time and stage readable and shows concise real upcoming works',async({page})=>{
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
  await page.waitForFunction(()=>!!window.BOS_MASTER_HOME_ORDERS_V124);

  const today=page.locator('.bosMwTodayCard[data-order-id="11"]');
  await expect(today).toBeVisible();
  await expect(today.locator('.bosMwTodayTime')).toHaveText('10:00');
  await expect(today.locator('.mwv2TodayStage')).toHaveText('В работе');

  const layout=await today.evaluate(card=>{
    const time=card.querySelector('.bosMwTodayTime'),main=card.querySelector('.bosMwTodayMain'),stage=card.querySelector('.mwv2TodayStage');
    const tr=time.getBoundingClientRect(),mr=main.getBoundingClientRect(),sr=stage.getBoundingClientRect();
    return{timeWhiteSpace:getComputedStyle(time).whiteSpace,timeHeight:tr.height,stageLeft:sr.left,mainLeft:mr.left,stageHeight:sr.height,stageWidth:sr.width};
  });
  expect(layout.timeWhiteSpace).toBe('nowrap');
  expect(layout.timeHeight).toBeLessThan(32);
  expect(layout.stageLeft).toBeGreaterThanOrEqual(layout.mainLeft-1);
  expect(layout.stageWidth).toBeGreaterThan(55);
  expect(layout.stageHeight).toBeLessThan(34);

  const upcoming=page.locator('.bosMasterUpcomingCard[data-order-id="11"]');
  await expect(upcoming).toBeVisible();
  const summary=upcoming.locator('.bosUpcomingWork');
  await expect(summary).toHaveText('Шторы ×2 · Мин. стоимость');
  await expect(summary).not.toContainText('Подрезка');
  await expect(summary).not.toContainText('Дополнительная');

  await upcoming.click();
  const modal=page.locator('#modalRoot .modal').last();
  await expect(modal).toContainText('Подрезка рулонной шторы');
  await expect(modal).toContainText('Дополнительная работа');
});
