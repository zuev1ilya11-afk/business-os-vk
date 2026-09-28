const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher v184 hides an empty unassigned queue and keeps the desktop workspace dense',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db,master}=await fullStack(page,'dispatcher');
  for(const order of db.tables.orders){
    if(['Выполнена','Отменена'].includes(String(order.status||'')))continue;
    order.master_staff_id=master.id;
    order.master_name=master.full_name;
  }
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_DISPATCHER_UI_POLISH_V184);
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();
  const board=page.locator('.dbBoard.du184Board');
  await expect(board).toBeVisible();
  const queue=page.locator('#content>.duq122');
  await expect(queue).toHaveClass(/du184QueueEmpty/);
  await expect(queue).toBeHidden();

  const geometry=await page.evaluate(()=>{
    const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
    const left=rect('.dbAttention'),center=rect('.dbSchedule'),right=rect('#dispatchBoardDetail');
    const kpi=rect('.du183Kpi');
    return {left:left?.width||0,center:center?.width||0,right:right?.width||0,kpi:kpi?.height||0};
  });
  expect(geometry.center).toBeGreaterThan(640);
  expect(geometry.right).toBeGreaterThan(230);
  expect(geometry.right).toBeLessThanOrEqual(305);
  expect(geometry.left).toBeLessThanOrEqual(276);
  expect(geometry.kpi).toBeLessThanOrEqual(66);
});

test('dispatcher v184 does not replace the mobile dispatcher layout',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_DISPATCHER_UI_POLISH_V184);
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du184Board')).toHaveCount(0);
});
