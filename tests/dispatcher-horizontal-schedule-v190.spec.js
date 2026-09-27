const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v190 shows masters as horizontal timeline rows and keeps page inside viewport',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  const names=['Дмитрий','Иван','Руслан','Тимур','Сергей','Артём','Михаил'];
  names.forEach((full_name,i)=>db.tables.business_staff.push(employee(`horizontal-${i}`,'master',{full_name,city:'Санкт-Петербург'})));
  Object.assign(db.tables.orders[0],{scheduled_date:localDate(),scheduled_time:'10:00',time_slot:'10:00–12:00',status:'В работе'});

  await page.setViewportSize({width:1600,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();

  const root=page.locator('.du187Root.dh190Root');
  await expect(root).toBeVisible();
  await expect(root).toContainText('Горизонтальное расписание дня');
  await expect(page.locator('.du187Master')).toHaveCount(8);
  await expect(page.locator('.du187Time')).toHaveCount(24);

  const geometry=await page.evaluate(()=>{
    const times=[...document.querySelectorAll('.du187Time')].slice(0,2).map(x=>x.getBoundingClientRect());
    const masters=[...document.querySelectorAll('.du187Master')].slice(0,2).map(x=>x.getBoundingClientRect());
    const wrap=document.querySelector('.dh190GridWrap');
    return{
      times:times.map(r=>({x:r.x,y:r.y})),
      masters:masters.map(r=>({x:r.x,y:r.y})),
      pageHeight:document.documentElement.scrollHeight,
      pageWidth:document.documentElement.scrollWidth,
      innerHeight,
      innerWidth,
      wrapClientHeight:wrap?.clientHeight||0,
      wrapScrollHeight:wrap?.scrollHeight||0
    };
  });
  expect(geometry.times[1].x).toBeGreaterThan(geometry.times[0].x);
  expect(Math.abs(geometry.times[1].y-geometry.times[0].y)).toBeLessThan(2);
  expect(geometry.masters[1].y).toBeGreaterThan(geometry.masters[0].y);
  expect(Math.abs(geometry.masters[1].x-geometry.masters[0].x)).toBeLessThan(2);
  expect(geometry.pageHeight).toBeLessThanOrEqual(geometry.innerHeight+1);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.innerWidth+1);
  expect(geometry.wrapScrollHeight).toBeLessThanOrEqual(geometry.wrapClientHeight+1);

  const card=page.locator('.du187Card[data-order-id="11"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.du187When')).toHaveText('10:00–12:00');
  await card.click();
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Анна');
});

test('dispatcher v190 releases page scroll lock outside dispatcher orders page',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:1360,height:900});
  await page.goto('/');
  await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190?.version==='190');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('html')).toHaveClass(/dh190Active/);
  await page.locator('nav [data-page=dashboard]').click();
  await expect(page.locator('html')).not.toHaveClass(/dh190Active/);
});
