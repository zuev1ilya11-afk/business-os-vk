const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today='2026-10-05';
const yesterday='2026-10-04';
const tomorrow='2026-10-06';

async function setup(page,role,now=`${today}T12:00:00Z`){
  const context=await fullStack(page,role);
  const base=context.db.tables.orders[0];
  context.db.tables.orders=[
    {...base,id:'101',client:'Сегодня в работе',scheduled_date:today,status:'В работе',master_workflow_stage:'started'},
    {...base,id:'102',client:'Сегодня выполнена',scheduled_date:today,status:'Выполнена',master_workflow_stage:'completed',completed_at:`${today}T11:00:00Z`},
    {...base,id:'103',client:'Вчера выполнена',scheduled_date:yesterday,status:'Выполнена',master_workflow_stage:'completed',completed_at:`${today}T10:00:00Z`},
    {...base,id:'104',client:'Завтра выполнена',scheduled_date:tomorrow,status:'Выполнена',master_workflow_stage:'completed',completed_at:`${today}T09:00:00Z`},
    {...base,id:'105',client:'Без даты выполнена',scheduled_date:null,status:'Выполнена',master_workflow_stage:'completed',completed_at:`${today}T08:00:00Z`},
    {...base,id:'106',client:'Сегодня отменена',scheduled_date:today,status:'Отменена',master_workflow_stage:'cancelled'},
    {...base,id:'107',client:'Сегодня рекламация',scheduled_date:today,status:'Рекламация',is_claim:true}
  ];
  await page.clock.setFixedTime(new Date(now));
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  if(role!=='master')await page.getByRole('button',{name:'Все заявки',exact:true}).click();
  return context;
}

const filter=(page,value)=>page.locator(`.bosOrderFilters button[onclick="setBosOrderFilter('${value}')"]`);
const cards=page=>page.locator('#bosOrderList > .opsCompactOrder:visible');
async function expectClients(page,clients){
  await expect.poll(async()=> (await cards(page).locator('.opsCompactMain > b').allTextContents()).sort()).toEqual([...clients].sort());
  await expect(page.locator('#content h2 + .muted')).toHaveText(`Найдено: ${clients.length}`);
}

// Restoring the operational-status guard in the date filter must fail these tests.
for(const role of ['owner','manager','dispatcher'])test(`${role}: today includes completed scheduled orders and preserves explicit status filters`,async({page})=>{
  await setup(page,role);
  await filter(page,'today').click();
  await expectClients(page,['Сегодня в работе','Сегодня выполнена','Сегодня отменена','Сегодня рекламация']);
  await expect(filter(page,'today').locator('small')).toHaveText('4');

  await page.locator('#dmv3Status').selectOption('Выполнена');
  await expectClients(page,['Сегодня выполнена']);
  await filter(page,'all').click();
  await expectClients(page,['Сегодня выполнена','Вчера выполнена','Завтра выполнена','Без даты выполнена']);
  await filter(page,'today').click();
  await expect(page.locator('#dmv3Status')).toHaveValue('Выполнена');
  await expectClients(page,['Сегодня выполнена']);
  await page.locator('#dmv3Status').selectOption('В работе');
  await expectClients(page,['Сегодня в работе']);
  await page.locator('#dmv3Status').selectOption('');
  await expectClients(page,['Сегодня в работе','Сегодня выполнена','Сегодня отменена','Сегодня рекламация']);

  await filter(page,'active').click();
  await expectClients(page,['Сегодня в работе']);
  await filter(page,'done').click();
  await expectClients(page,['Сегодня выполнена','Вчера выполнена','Завтра выполнена','Без даты выполнена']);
  await filter(page,'today').click();
  await page.locator('#bosOrderSearch').fill('Сегодня выполнена');
  await expectClients(page,['Сегодня выполнена']);
  await page.locator('#bosOrderSearch').fill('');
  await expectClients(page,['Сегодня в работе','Сегодня выполнена','Сегодня отменена','Сегодня рекламация']);
});

test.describe('existing today timezone boundary',()=>{
  test.use({timezoneId:'Europe/Moscow'});
  for(const now of [`${today}T00:30:00Z`,`${today}T22:30:00Z`])test(`today keeps the UTC date key at ${now}`,async({page})=>{
    await setup(page,'owner',now);
    await filter(page,'today').click();
    await expectClients(page,['Сегодня в работе','Сегодня выполнена','Сегодня отменена','Сегодня рекламация']);
  });
});

test('master keeps current and completed status tabs separate when a day is selected',async({page})=>{
  await setup(page,'master');
  const masterCards=page.locator('.masterV125Card');
  const ids=()=>masterCards.evaluateAll(nodes=>nodes.map(node=>node.dataset.masterOrderId).sort());
  const day=page.locator(`.masterDayFilters button[onclick="setMasterOrderDay('${today}')"]`);
  await day.click();
  await expect.poll(ids).toEqual(['101']);
  await page.locator('.masterStatusFilters button[onclick="setMasterOrdersFilter(\'done\')"]').click();
  await day.click();
  await expect.poll(ids).toEqual(['102','103','104','105']);
  await page.locator('.masterStatusFilters button[onclick="setMasterOrdersFilter(\'current\')"]').click();
  await day.click();
  await expect.poll(ids).toEqual(['101']);
});
