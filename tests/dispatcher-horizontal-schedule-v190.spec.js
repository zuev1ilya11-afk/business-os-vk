const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v190 shows fixed hourly 10-21 timeline and keeps half-hour orders visible',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  const names=['Дмитрий','Иван','Руслан','Тимур','Сергей','Артём','Михаил'];
  names.forEach((full_name,i)=>db.tables.business_staff.push(employee(`horizontal-${i}`,'master',{full_name,city:'Санкт-Петербург'})));
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'10:30',time_slot:'10:30–12:00',status:'В работе'});

  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();

  const root=page.locator('.du187Root.dh190Root:visible');
  await expect(root).toBeVisible();
  await expect(root).toContainText('Расписание дня');
  await expect(root).toContainText('10:00–21:00 · по 1 часу');
  await expect(root.locator('.du187Master')).toHaveCount(8);
  await expect(root.locator('.du187Time')).toHaveCount(11);
  await expect(root.locator('.du187Time')).toHaveText(['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00']);
  await expect(root.locator('.du187Time:text-matches(":30")')).toHaveCount(0);

  const geometry=await root.evaluate(el=>{
    const times=[...el.querySelectorAll('.du187Time')].slice(0,2).map(x=>x.getBoundingClientRect());
    const masters=[...el.querySelectorAll('.du187Master')].slice(0,2).map(x=>x.getBoundingClientRect());
    const wrap=el.querySelector('.dh190GridWrap');
    const grid=el.querySelector('.dh190Grid');
    return{
      times:times.map(r=>({x:r.x,y:r.y})),
      masters:masters.map(r=>({x:r.x,y:r.y})),
      pageHeight:document.documentElement.scrollHeight,
      pageWidth:document.documentElement.scrollWidth,
      innerHeight,
      innerWidth,
      wrapClientHeight:wrap?.clientHeight||0,
      wrapClientWidth:wrap?.clientWidth||0,
      wrapScrollHeight:wrap?.scrollHeight||0,
      gridScrollWidth:grid?.scrollWidth||0
    };
  });
  expect(geometry.times[1].x).toBeGreaterThan(geometry.times[0].x);
  expect(Math.abs(geometry.times[1].y-geometry.times[0].y)).toBeLessThan(2);
  expect(geometry.masters[1].y).toBeGreaterThan(geometry.masters[0].y);
  expect(Math.abs(geometry.masters[1].x-geometry.masters[0].x)).toBeLessThan(2);
  expect(geometry.pageHeight).toBeLessThanOrEqual(geometry.innerHeight+1);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.innerWidth+1);
  expect(geometry.wrapClientHeight).toBeGreaterThan(0);
  expect(geometry.wrapScrollHeight).toBeGreaterThanOrEqual(geometry.wrapClientHeight);
  expect(geometry.gridScrollWidth).toBeGreaterThan(geometry.wrapClientWidth);
  expect(geometry.gridScrollWidth-geometry.wrapClientWidth).toBeLessThanOrEqual(170);

  const card=root.locator('.du187Card[data-order-id="11"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.du187When')).toHaveText('10:30–12:00');
  const offset=await card.evaluate(el=>{const card=el.getBoundingClientRect(),slot=el.parentElement.getBoundingClientRect();return(card.left-slot.left)/slot.width});
  expect(offset).toBeGreaterThan(.4);
  expect(offset).toBeLessThan(.6);
  await card.click();
  const detail=page.locator('#dispatchBoardDetail');
  await expect(detail).toContainText('Анна');
  const detailWidth=await detail.evaluate(el=>el.getBoundingClientRect().width);
  expect(detailWidth).toBeLessThanOrEqual(305);
});

test('dispatcher v190 scopes viewport fitting to dispatcher orders page',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:1360,height:900});
  await page.goto('/');
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('#content .dbBoard')).toHaveClass(/dh190Board/);
  await expect(page.locator('html')).not.toHaveClass(/dh190Active/);
  await expect(page.locator('body')).not.toHaveClass(/dh190Active/);
  await page.locator('nav [data-page=home]').click();
  await expect(page.locator('#content .dh190Board')).toHaveCount(0);
});

for(const role of ['owner','dispatcher'])for(const width of [1280,1600]){
  test(`${role} ${width}: 20:00 and 20:30 orders are visible and clickable in the last hour`,async({page})=>{
    const {db,master}=await fullStack(page,role);
    const date=localDate();
    Object.assign(db.tables.orders[0],{scheduled_date:date,scheduled_time:'20:00',time_slot:'20:00–20:30',status:'В работе'});
    Object.assign(db.tables.orders[1],{scheduled_date:date,scheduled_time:'20:30',time_slot:'20:30–21:00',master_staff_id:master.id,master_name:master.full_name,status:'В работе'});
    // Already assigned orders remain visible even outside the master's availability.
    db.tables.staff_schedule.push({staff_id:master.id,work_date:date,is_working:true,work_start:'10:00',work_end:'20:00'});
    await page.setViewportSize({width,height:900});
    await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
    await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
    await page.locator('nav [data-page=orders]').click();
    const root=page.locator('.du187Root.dh190Root:visible');
    const slot=root.locator('.dh190Slot[data-time="20:00"]');
    await expect(slot).toHaveCount(1);
    await expect(slot).toHaveClass(/off/);
    const wrap=root.locator('.dh190GridWrap'),masterCell=root.locator('.du187Master');
    const pinnedLeft=await masterCell.evaluate(el=>el.getBoundingClientRect().left);
    const scrollLeft=await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth;return el.scrollLeft});
    expect(scrollLeft).toBeGreaterThan(0);
    await expect.poll(()=>masterCell.evaluate(el=>el.getBoundingClientRect().left)).toBeCloseTo(pinnedLeft,0);
    // Scrolled cards must stay underneath the pinned master names.
    expect(await masterCell.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);
    for(const [id,time] of [['11','20:00–20:30'],['12','20:30–21:00']]){
      const card=slot.locator(`.du187Card[data-order-id="${id}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('.du187When')).toHaveText(time);
      const fits=await card.evaluate(el=>{const r=el.getBoundingClientRect(),wrap=el.closest('.dh190GridWrap').getBoundingClientRect();return r.left>=wrap.left&&r.right<=wrap.right+1});
      expect(fits).toBe(true);
      await card.click();
      await expect(page.locator('#dispatchBoardDetail')).toContainText(id==='11'?'Анна':'Борис');
      await expect.poll(()=>wrap.evaluate(el=>el.scrollLeft)).toBeCloseTo(scrollLeft,0);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    expect(db.calls.filter(c=>c.table==='orders'&&c.mode==='update')).toHaveLength(0);
  });
}


test('readable schedule keeps text separated and preserves both scroll axes on refresh',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  db.tables.business_staff.find(m=>m.id===master.id).full_name='Руслан';
  for(let i=0;i<9;i++)db.tables.business_staff.push(employee(`scroll-${i}`,'master',{full_name:`Мастер ${i}`,city:'Санкт-Петербург'}));
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'20:00',time_slot:'20:00–21:00',external_id:'hands:7344032'});
  await page.setViewportSize({width:1600,height:960});
  await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  const wrap=page.locator('.dh190GridWrap'),card=page.locator('.dh190Card[data-order-id="11"]');
  await expect(card).toHaveAttribute('title',/7344032.*20:00–21:00.*Анна/);
  const metrics=await card.evaluate(el=>{
    const master=el.closest('.dh190Grid').querySelector('.du187Master'),strong=el.querySelector('strong'),when=el.querySelector('.du187When'),work=el.querySelector('small');
    return {masterWidth:master.getBoundingClientRect().width,masterFont:parseFloat(getComputedStyle(master.querySelector('b')).fontSize),clientFont:parseFloat(getComputedStyle(strong).fontSize),rowHeight:master.getBoundingClientRect().height,endHidden:getComputedStyle(el.querySelector('.dh190End')).display==='none',separate:when.getBoundingClientRect().bottom<=strong.getBoundingClientRect().top&&strong.getBoundingClientRect().bottom<=work.getBoundingClientRect().top};
  });
  expect(metrics).toMatchObject({masterWidth:88,masterFont:14,clientFont:14,rowHeight:80,endHidden:true,separate:true});
  await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=120;el.dispatchEvent(new Event('scroll'))});
  const before=await wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
  expect(before.left).toBeGreaterThan(0);expect(before.top).toBe(120);
  await page.evaluate(()=>show('orders'));
  await expect.poll(()=>wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}))).toEqual(before);
  await page.evaluate(()=>BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190.shiftDate(1));
  await expect.poll(()=>wrap.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}))).toEqual({left:0,top:0});
});
