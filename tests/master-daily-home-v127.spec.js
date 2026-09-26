const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const orderNo=o=>String(o?.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o?.id||'');

test('master v127 home shows request number, same-day cards and attention queue on mobile',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const next=db.tables.orders.find(o=>String(o.id)==='11')||db.tables.orders[0];
  const attention=db.tables.orders.find(o=>String(o.id)==='12')||db.tables.orders[1];
  const sameDay=db.tables.orders.filter(o=>o!==next&&o!==attention).slice(0,2);
  expect(sameDay.length).toBeGreaterThanOrEqual(2);

  for(const o of db.tables.orders){
    if(o!==next&&o!==attention&&!sameDay.includes(o))Object.assign(o,{status:'Выполнена',report_review_status:'approved'});
  }
  Object.assign(next,{
    master_staff_id:master.id,
    client:'Анна Пичуева',
    address:'Невский проспект, 10',
    scheduled_date:'2099-09-10',
    scheduled_time:'10:30',
    status:'В работе',
    master_called_at:null,
    master_agreed_at:null,
    master_workflow_stage:'assigned',
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null
  });
  Object.assign(sameDay[0],{
    master_staff_id:master.id,
    address:'Просвещения, 32',
    scheduled_date:'2099-09-10',
    scheduled_time:'13:30',
    status:'В работе',
    master_called_at:null,
    master_agreed_at:null,
    master_workflow_stage:'assigned',
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null
  });
  Object.assign(sameDay[1],{
    master_staff_id:master.id,
    address:'Ленинский проспект, 82',
    scheduled_date:'2099-09-10',
    scheduled_time:'16:00',
    status:'В работе',
    master_called_at:null,
    master_agreed_at:null,
    master_workflow_stage:'assigned',
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null
  });
  Object.assign(attention,{
    master_staff_id:master.id,
    client:'Иван Петров',
    address:'Литейный проспект, 20',
    scheduled_date:'',
    scheduled_time:'',
    status:'В работе',
    master_called_at:'2099-09-09T10:00:00.000Z',
    master_agreed_at:'2099-09-09T10:05:00.000Z',
    master_workflow_stage:'started',
    report_uploaded_at:'2099-09-09T12:00:00.000Z',
    report_act_url:'https://example.test/report.pdf',
    report_review_status:'rejected',
    report_review_comment:'Добавьте фото результата'
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_DAILY_HOME_V127===true);
  await page.evaluate(()=>{show('home');window.BOS_MASTER_DAILY_HOME_V127_API.refresh()});

  const dashboard=page.locator('#masterDailyV127');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.getByRole('heading',{name:'Рабочий день'})).toBeVisible();

  const nextCard=dashboard.locator('.masterV127Next');
  await expect(nextCard).toHaveAttribute('data-order-id',String(next.id));
  await expect(nextCard).toContainText('10:30');
  await expect(nextCard.locator('.masterV127Main small')).toHaveText('БЛИЖАЙШАЯ ЗАЯВКА');
  await expect(nextCard.locator('.masterV127Main h3')).toHaveText(`№ ${orderNo(next)}`);
  await expect(nextCard).not.toContainText('Анна Пичуева');
  await expect(nextCard).toContainText('Невский проспект, 10');
  await expect(nextCard).toContainText('Позвонить клиенту');
  const nextText=await nextCard.innerText();
  expect(nextText.split(orderNo(next)).length-1).toBe(1);

  const day=dashboard.locator('.masterV127Day');
  await expect(day).toBeVisible();
  await expect(day.locator('.masterV127DayHead')).toContainText('Остальные заявки на день');
  const dayItems=day.locator('.masterV127DayItem');
  await expect(dayItems).toHaveCount(2);
  await expect(dayItems.nth(0)).toContainText('13:30');
  await expect(dayItems.nth(0)).toContainText(`№ ${orderNo(sameDay[0])}`);
  await expect(dayItems.nth(0)).toContainText('Просвещения, 32');
  await expect(dayItems.nth(1)).toContainText('16:00');
  await expect(dayItems.nth(1)).toContainText(`№ ${orderNo(sameDay[1])}`);
  await expect(dayItems.nth(1)).toContainText('Ленинский проспект, 82');
  expect(await day.locator('.masterV127DayRow').evaluate(el=>getComputedStyle(el).flexWrap)).toBe('nowrap');

  const attentionItem=dashboard.locator('.masterV127AttentionItem').filter({hasText:'Отчёт вернули на доработку'});
  await expect(attentionItem).toHaveCount(1);
  await expect(attentionItem).toContainText('Исправить отчёт');
  await expect(dashboard.locator('.masterV127AttentionHead')).toContainText('1');

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master v127 dashboard stays out of dispatcher home',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>show('home'));
  await expect(page.locator('#masterDailyV127')).toHaveCount(0);
});
