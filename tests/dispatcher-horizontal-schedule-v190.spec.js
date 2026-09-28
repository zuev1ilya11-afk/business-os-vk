const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v190 shows fixed hourly 10-20 timeline and keeps half-hour orders visible',async({page})=>{
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
  await expect(root).toContainText('Горизонтальное расписание дня');
  await expect(root).toContainText('10:00–20:00 · по 1 часу');
  await expect(root.locator('.du187Master')).toHaveCount(8);
  await expect(root.locator('.du187Time')).toHaveCount(10);
  await expect(root.locator('.du187Time')).toHaveText(['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']);
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
  expect(geometry.gridScrollWidth).toBeLessThanOrEqual(geometry.wrapClientWidth+1);

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
