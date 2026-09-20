const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

async function waitForPhase3(page){
  await page.waitForFunction(()=>{
    const link=document.getElementById('bosDarkPhase3Css');
    return !!(link&&link.sheet);
  });
}

async function pageOverflow(page){
  return page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
}

test('dark phase 3 keeps dispatcher day plan contained on desktop',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await waitForPhase3(page);

  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'План дня'}).click();
  const plan=page.locator('.dbV23Plan');
  await expect(plan).toBeVisible();
  await expect(page.locator('.dbV23Summary>div')).toHaveCount(5);

  const layout=await page.evaluate(()=>{
    const rect=s=>document.querySelector(s)?.getBoundingClientRect();
    const content=rect('#content'),plan=rect('.dbV23Plan'),grid=rect('.dbV23GridWrap');
    return {
      viewport:document.documentElement.clientWidth,
      content:content&&{left:content.left,right:content.right,width:content.width},
      plan:plan&&{left:plan.left,right:plan.right,width:plan.width},
      grid:grid&&{left:grid.left,right:grid.right,width:grid.width},
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    };
  });
  expect(layout.overflow).toBe(0);
  expect(layout.plan.left).toBeGreaterThanOrEqual(layout.content.left-1);
  expect(layout.plan.right).toBeLessThanOrEqual(layout.content.right+1);
  expect(layout.grid.right).toBeLessThanOrEqual(layout.content.right+1);

  const summary=page.locator('.dbV23Summary>div');
  for(let i=0;i<await summary.count();i++){
    const box=await summary.nth(i).boundingBox();
    if(box)expect(box.height).toBeGreaterThanOrEqual(48);
  }
});

test('dark phase 3 keeps master calendar touch friendly on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'master');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await waitForPhase3(page);

  const dispatchNav=page.locator('nav [data-page=dispatch]');
  if(await dispatchNav.count()) await dispatchNav.click();
  else await page.evaluate(()=>show('dispatch'));

  await expect(page.locator('#masterMonthCalendar')).toBeVisible();
  const days=page.locator('#masterMonthCalendar .bosCalDay');
  expect(await days.count()).toBeGreaterThanOrEqual(28);

  const first=await days.first().boundingBox();
  expect(first).not.toBeNull();
  expect(first.x).toBeGreaterThanOrEqual(-1);
  expect(first.x+first.width).toBeLessThanOrEqual(391);
  expect(first.height).toBeGreaterThanOrEqual(58);
  expect(await pageOverflow(page)).toBe(0);
});

test('dark phase 3 renders team as responsive card grid',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await fullStack(page,'owner');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await waitForPhase3(page);
  await page.locator('nav [data-page=team]').click();

  const cards=page.locator('#content>section.card');
  expect(await cards.count()).toBeGreaterThan(0);
  const desktopColumns=await page.locator('#content').evaluate(el=>getComputedStyle(el).gridTemplateColumns);
  expect(desktopColumns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
  expect(await pageOverflow(page)).toBe(0);

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(50);
  const mobileColumns=await page.locator('#content').evaluate(el=>getComputedStyle(el).gridTemplateColumns);
  expect(mobileColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(await pageOverflow(page)).toBe(0);
});
