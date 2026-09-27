const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v187 unifies schedule and day plan and keeps multi-slot duration when moved',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{
    scheduled_date:localDate(),
    scheduled_time:'10:00',
    time_slot:'10:00–12:00',
    status:'В работе'
  });

  await page.setViewportSize({width:1360,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187?.version==='187');
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();

  await expect(page.locator('.du187Root')).toBeVisible();
  await expect(page.locator('.du187Root')).toHaveClass(/dh190Root/);
  await expect(page.locator('.dbV23Tab')).toBeHidden();
  await expect(page.locator('.du187Time',{hasText:'10:00'})).toBeVisible();
  await expect(page.locator('.du187Time',{hasText:'10:30'})).toBeVisible();

  const card=page.locator('.du187Card[data-order-id="11"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-duration-slots','4');
  await expect(card.locator('.du187When')).toHaveText('10:00–12:00');

  expect(await page.evaluate(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187.setDuration('11',6))).toBe(true);
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('10:00–13:00');
  await expect(page.locator('.du187Card[data-order-id="11"]')).toHaveAttribute('data-duration-slots','6');

  expect(await page.evaluate(masterVk=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',masterVk,'11:30'),master.external_id)).toBe(true);
  await expect.poll(()=>db.tables.orders[0].scheduled_time).toBe('11:30');
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('11:30–14:30');
  await expect(page.locator('.du187Card[data-order-id="11"] .du187When')).toHaveText('11:30–14:30');
});

async function openSchedule(page){
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187?.version==='187');
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root')).toBeVisible();
  await expect(page.locator('.du187Root')).toHaveClass(/dh190Root/);
}

async function resizeBy(page,card,slots){
  const handle=card.locator('.du187Resize');
  await handle.hover();
  const {box,rowHeight,slotWidth,horizontal}=await handle.evaluate(el=>({
    box:el.getBoundingClientRect().toJSON(),
    rowHeight:el.closest('.du187Slot').getBoundingClientRect().height,
    slotWidth:el.closest('.du187Slot').getBoundingClientRect().width,
    horizontal:!!window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190
  }));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  if(horizontal)await page.mouse.move(box.x+box.width/2+slots*slotWidth,box.y+box.height/2,{steps:8});
  else await page.mouse.move(box.x+box.width/2,box.y+box.height/2+slots*rowHeight,{steps:8});
  await page.mouse.up();
}

test('real resize, reload and drag to another master preserve three hours',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  const {employee}=require('./helpers/edge.cjs');
  const second=employee('second','master',{full_name:'Дмитрий',city:'Санкт-Петербург'});
  db.tables.business_staff.push(second);
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'10:00',time_slot:'10:00–11:00'});
  await page.setViewportSize({width:1600,height:1000});
  await openSchedule(page);
  await page.evaluate(()=>{window.testDrags=0;document.addEventListener('dragstart',()=>window.testDrags++)});
  const card=page.locator('.du187Root.dh190Root:visible .du187Card[data-order-id="11"]');
  await card.click();
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Анна');
  await resizeBy(page,card,4);
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('10:00–13:00');
  expect(await page.evaluate(()=>window.testDrags)).toBe(0);
  await page.reload();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root.dh190Root:visible')).toBeVisible();
  await expect(card).toHaveAttribute('data-duration-slots','6');
  const target=page.locator(`.du187Root.dh190Root:visible .du187Slot[data-master="${second.external_id}"][data-time="14:00"]`);
  await page.evaluate(()=>{window.testEvents=[];for(const type of ['dragstart','drop'])document.addEventListener(type,()=>window.testEvents.push(type),true)});
  await card.hover();
  const source=await card.boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(source.x+source.width/2+12,source.y+source.height/2,{steps:3});
  await target.hover();
  await target.hover();
  await page.mouse.up();
  expect(await page.evaluate(()=>window.testEvents)).toEqual(['dragstart','drop']);
  await expect.poll(()=>db.tables.orders[0]).toMatchObject({master_staff_id:second.id,scheduled_time:'14:00',time_slot:'14:00–17:00'});
  const movedCard=page.locator('.du187Root.dh190Root:visible .du187Card[data-order-id="11"]');
  await expect(movedCard).toHaveAttribute('data-duration-slots','6');
  await expect(movedCard.locator('.du187When')).toHaveText('14:00–17:00');
  await resizeBy(page,movedCard,-1);
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('14:00–16:30');
});

test('range conflicts warn, cancel cleanly and remain separately clickable',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'10:00',time_slot:'10:00–12:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:localDate(),scheduled_time:'12:30',time_slot:'12:30–14:00',master_staff_id:master.id,master_name:master.full_name});
  await page.setViewportSize({width:1360,height:1000});
  await openSchedule(page);
  const card=page.locator('.du187Card[data-order-id="11"]');
  let warning='';
  page.once('dialog',async dialog=>{warning=dialog.message();await dialog.dismiss()});
  await resizeBy(page,card,2);
  await expect.poll(()=>warning).toContain('пересекается');
  await expect(card).toHaveAttribute('data-duration-slots','4');
  await expect(card.locator('.du187When')).toHaveText('10:00–12:00');
  expect(db.tables.orders[0].time_slot).toBe('10:00–12:00');
  page.once('dialog',dialog=>dialog.accept());
  await resizeBy(page,card,2);
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('10:00–13:00');
  await expect(page.locator('.du187Card.conflict')).toHaveCount(2);
  await expect(page.locator('.du187Slot[data-time="12:30"]')).toHaveClass(/conflict/);
  const other=page.locator('.du187Card[data-order-id="12"]');
  const a=await card.boundingBox(),b=await other.boundingBox();
  expect(a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
  await card.click();
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Анна');
  await other.click();
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Борис');
  await page.getByRole('button',{name:/Контроль/}).click();
  await expect(page.locator('.du187Root')).toHaveCount(0);
  await page.getByRole('button',{name:/Конфликт времени ·/}).click();
  await expect(page.locator('.dbV24Card')).toHaveCount(2);
  await page.locator('.dbV24Card').first().getByRole('button',{name:'План дня'}).click();
  await expect(page.locator('.du187Root')).toHaveCount(1);
  await expect(page.locator('.dbV23Plan')).toHaveCount(0);
  await expect(page.locator('.dbV24Control')).toHaveCount(0);
});

test('desktop widths and scaled layout retain usable grid; mobile has none',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'10:00',time_slot:'10:00–11:00'});
  await page.setViewportSize({width:1100,height:1000});
  await openSchedule(page);
  const card=page.locator('.du187Card[data-order-id="11"]');
  for(const width of [1100,1360,1600]){
    await page.setViewportSize({width,height:1000});
    await expect(page.locator('.du187Root')).toBeVisible();
    await card.click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  for(const [zoom,expected] of [[0.8,'10:00–11:30'],[1.25,'10:00–12:00']]){
    await page.evaluate(zoom=>document.body.style.zoom=String(zoom),zoom);
    await resizeBy(page,card,1);
    await expect.poll(()=>db.tables.orders[0].time_slot).toBe(expected);
  }
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('10:00–12:00');
  await page.evaluate(()=>document.body.style.zoom='');
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root')).toBeHidden();
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});

test('free-window filter accounts for whole intervals and quick move keeps duration',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  const {employee}=require('./helpers/edge.cjs');
  const second=employee('second','master',{full_name:'Дмитрий',city:'Санкт-Петербург'});
  db.tables.business_staff.push(second);
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'09:00',time_slot:'09:00–21:00'});
  await page.setViewportSize({width:1600,height:1000});
  await openSchedule(page);
  await page.getByRole('button',{name:'Есть свободное окно'}).click();
  await expect(page.locator('.du187Master')).toHaveCount(1);
  await expect(page.locator('.du187Master')).toContainText('Дмитрий');
  await expect(page.locator('#dbV21FreeCount')).toHaveText('Свободных: 1');
  await page.getByRole('button',{name:'Есть свободное окно'}).click();
  await expect(page.locator('.du187Master')).toHaveCount(2);
  expect(await page.evaluate(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187.setDuration('11',6))).toBe(true);
  await page.locator('.du187Card[data-order-id="11"]').click();
  await page.locator('.dbV21QuickMove').evaluate(box=>{
    box.querySelector('#dbV21MoveTime').value='14:00';
    box.querySelector('button').click();
  });
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('14:00–17:00');
  expect(db.tables.orders[0].master_staff_id).toBe(master.id);
});
