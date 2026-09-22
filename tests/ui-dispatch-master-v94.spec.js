const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher keeps list inside board and moves controls to requested areas',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbBoard')).toBeVisible();
  await expect(page.locator('.dbAttention .dbFilters')).toBeVisible();
  await expect(page.locator('.dbV21QuickDates .dbDateNav')).toBeVisible();

  await page.getByRole('button',{name:'Список',exact:true}).click();
  await expect(page.locator('.dbBoard')).toBeVisible();
  await expect(page.locator('.dbAttention')).toBeVisible();
  await expect(page.locator('.dbV94InlineList')).toBeVisible();
  await expect(page.locator('.dbListMode')).toHaveCount(0);

  await page.locator('#bosOrderSearch').fill('Анна');
  await expect(page.locator('.dbV94ListCard')).toHaveCount(1);
  await expect(page.locator('.dbV94ListCard')).toContainText('Анна');
});

test('master orders use green red and orange status highlighting',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db,master}=await fullStack(page,'master');
  const base={...db.tables.orders[0],master_staff_id:master.id,master_name:master.full_name};
  db.tables.orders[0].status='Выполнена';
  db.tables.orders.push({...base,id:'13',status:'Рекламация',scheduled_date:'2099-09-11'});
  db.tables.orders.push({...base,id:'14',status:'В работе',reschedule_requested:true,reschedule_reason:'Клиент просит завтра',scheduled_date:'2099-09-12'});

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  const done=page.locator('.bosHandsMiniCard,.masterCompactOrder').filter({hasText:'№ 11'}).first();
  const reclamation=page.locator('.bosHandsMiniCard,.masterCompactOrder').filter({hasText:'№ 13'}).first();
  const reschedule=page.locator('.bosHandsMiniCard,.masterCompactOrder').filter({hasText:'№ 14'}).first();
  await page.getByRole('button',{name:/^Выполненные/}).click();
  await expect(done).toHaveClass(/bosMasterDone/);
  await page.getByRole('button',{name:/^Рекламации/}).click();
  await expect(reclamation).toHaveClass(/bosMasterReclamation/);
  await page.getByRole('button',{name:/^Текущие/}).click();
  await expect(reschedule).toHaveClass(/bosMasterReschedule/);
});
