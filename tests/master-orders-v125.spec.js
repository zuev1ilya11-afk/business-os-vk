const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master orders v125 stays readable on mobile and shows concise real work',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  master.phone='+79990000001';
  Object.assign(order,{
    phone:'+79990000002',
    client:'Пичуева Анна Пичуева',
    scheduled_date:'2099-09-10',
    scheduled_time:'10:00',
    master_workflow_stage:'started',
    status:'В работе',
    amount:2800,
    work:'Монтаж рулонной шторы / день-ночь на створку окна ×2 шт.\nМинимальная стоимость заказа, светозащита и карнизы ×1 шт.\nПодрезка рулонной шторы день-ночь ×1 шт.\nДополнительные работы ×1 шт.'
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_ORDERS_V125===true);
  await page.locator('nav button[data-page="orders"]').click();

  const card=page.locator('.masterV125Card[data-master-order-id="11"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.masterV125When strong')).toHaveText('10:00');
  await expect(card.locator('.masterV125Stage')).toHaveText('В работе');
  await expect(card).toContainText('Пичуева Анна Пичуева');
  await expect(card.locator('.masterV125Work')).toHaveText('Шторы ×2 · Мин. стоимость');
  await expect(card).not.toContainText('Подрезка');
  await expect(card).not.toContainText('Дополнительные работы');
  await expect(card.locator('.masterV125Pay')).toContainText('1 547');
  await expect(card.getByRole('link',{name:'Позвонить',exact:true})).toHaveAttribute('href','tel:+79990000002');
  await expect(card.getByRole('button',{name:'Открыть заявку',exact:true})).toBeVisible();

  const timeStyle=await card.locator('.masterV125When strong').evaluate(el=>getComputedStyle(el).whiteSpace);
  const stageStyle=await card.locator('.masterV125Stage').evaluate(el=>getComputedStyle(el).whiteSpace);
  expect(timeStyle).toBe('nowrap');
  expect(stageStyle).toBe('nowrap');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await card.getByRole('button',{name:'Открыть заявку',exact:true}).click();
  await expect(page.locator('.bosMasterWorkflow')).toBeVisible();
  await expect(page.getByRole('button',{name:'Нужно перенести',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Завершить/})).toBeVisible();
});
