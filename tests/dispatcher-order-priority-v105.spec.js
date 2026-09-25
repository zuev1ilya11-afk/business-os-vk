const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher mobile order cards use the same simple operational priorities as desktop',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[1],{
    scheduled_date:today(),
    priority:'high',
    reschedule_requested:true,
    master_name:'',
    master_vk_id:'',
    master_id:'',
    master_staff_id:''
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_ORDER_PRIORITY_V105===true);

  await page.locator('nav button[data-page="orders"]').click();
  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'№ 12'}).first();
  await expect(card).toBeVisible();
  await expect(card.locator('.dmFlagUrgent')).toHaveText('Срочно');
  await expect(card.locator('.dmFlagToday')).toHaveText('Сегодня');
  await expect(card.locator('.dmFlagUnassigned')).toHaveText('Без мастера');
  await expect(card.locator('.dmFlagReschedule')).toHaveText('Перенос');
  await expect(card.locator('.dmAssignAction')).toHaveClass(/dmPriorityAction/);

  const touch=await card.locator('.dmCardActions').evaluate(node=>{
    const buttons=[...node.querySelectorAll('button,a')];
    const viewport=document.documentElement.clientWidth;
    return {
      safe:buttons.every(el=>el.getBoundingClientRect().height>=44),
      inside:buttons.every(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=viewport+1}),
      overflow:document.documentElement.scrollWidth-viewport
    };
  });
  expect(touch).toEqual({safe:true,inside:true,overflow:0});
});