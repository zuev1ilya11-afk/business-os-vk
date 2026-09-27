const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

async function pairState(page){
  return page.evaluate(()=>{
    const host=document.querySelector('.dbV94ListItems');
    if(!host)return null;
    const cards=[...host.querySelectorAll(':scope>.dbV94ListCard[data-order-id]')];
    const bars=[...host.querySelectorAll(':scope>.dq159DesktopActions[data-order-id]')];
    const byId=new Map(cards.map(card=>[String(card.dataset.orderId||''),card]));
    let badPair=0,badHidden=0;
    for(const bar of bars){
      const card=byId.get(String(bar.dataset.orderId||''));
      if(!card||card.nextElementSibling!==bar)badPair++;
      if(card&&bar.hidden!==card.hidden)badHidden++;
    }
    return {cards:cards.length,bars:bars.length,badPair,badHidden,hiddenCards:cards.filter(card=>card.hidden).length};
  });
}

test('dispatcher v185 keeps filters, quick actions and compact desktop stable across viewport changes',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  if(db.tables.orders[0])Object.assign(db.tables.orders[0],{scheduled_date:localDate(0),status:'В работе'});
  if(db.tables.orders[1])Object.assign(db.tables.orders[1],{scheduled_date:localDate(3),status:'В работе'});

  await page.setViewportSize({width:1280,height:850});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_UI_STABILITY_V185?.version==='185');
  await page.waitForFunction(()=>window.BOS_DISPATCHER_QUICK_ACTIONS_V159?.version==='159');
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();

  await expect(page.locator('.dbV94ListCard[data-order-id]').first()).toBeVisible();
  await expect(page.locator('#bosOrderSort')).toBeVisible();
  await expect.poll(async()=>{const s=await pairState(page);return !!s&&s.cards>1&&s.bars===s.cards&&s.badPair===0&&s.badHidden===0}).toBe(true);

  await page.locator('#bosOrderSort').selectOption('oldest');
  await expect.poll(async()=>{const s=await pairState(page);return !!s&&s.badPair===0&&s.badHidden===0}).toBe(true);

  await page.locator('[data-da123-filter="today"]').click();
  await expect.poll(async()=>{const s=await pairState(page);return !!s&&s.hiddenCards>0&&s.badPair===0&&s.badHidden===0}).toBe(true);

  await page.locator('[data-da123-filter="all"]').click();
  await expect.poll(async()=>{const s=await pairState(page);return !!s&&s.hiddenCards===0&&s.badPair===0&&s.badHidden===0}).toBe(true);

  await page.setViewportSize({width:1100,height:780});
  await expect.poll(async()=>{const s=await pairState(page);return !!s&&s.badPair===0&&s.badHidden===0}).toBe(true);
  const geometry=await page.evaluate(()=>{
    const layout=document.querySelector('.du184Board .dbLayout');
    const center=document.querySelector('.du184Board .dbSchedule');
    const right=document.querySelector('.du184Board #dispatchBoardDetail');
    return layout?{client:layout.clientWidth,scroll:layout.scrollWidth,center:center?.getBoundingClientRect().width||0,right:right?.getBoundingClientRect().width||0}:null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+2);
  expect(geometry.center).toBeGreaterThan(300);
  expect(geometry.right).toBeGreaterThan(240);
});
