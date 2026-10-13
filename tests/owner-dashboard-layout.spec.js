const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');

async function ready(page){
  await page.clock.install({time:new Date('2026-10-13T09:00:00Z')});
  const ctx=await fullStack(page,'owner');
  const names=['Иван','Николай','Руслан','Филипп','Шамиль'];
  ctx.master.full_name=names[0];
  ctx.db.tables.business_staff.find(m=>m.id===ctx.master.id).full_name=names[0];
  const masters=[ctx.master,...names.slice(1).map((name,i)=>employee('layout-'+i,'master',{full_name:name}))];
  ctx.db.tables.business_staff.push(...masters.slice(1));
  ctx.db.tables.staff_schedule=masters.flatMap((m,i)=>Array.from({length:7},(_,d)=>({id:`s${i}-${d}`,staff_id:m.id,work_date:`2026-10-${13+d}`,is_working:d<4,work_start:'10:00',work_end:'20:00'})));
  const base=ctx.db.tables.orders[0];
  ctx.db.tables.orders=Array.from({length:7},(_,i)=>({...base,id:String(11+i),client:['Алексей','Мария','Анна','Михаил','Елена','Ольга','Сергей'][i],address:['Невский проспект, д. 15','ул. Садовая, д. 24','Литейный проспект, д. 8'][i%3],master_staff_id:masters[i%5].id,master_name:masters[i%5].full_name,scheduled_date:'2026-10-13',scheduled_time:`${10+i}:00`,master_workflow_stage:i<3?'completed':i===3?'started':'assigned',status:i<3?'Выполнена':'В работе',completed_at:i<3?'2026-10-13T08:00:00Z':null,report_uploaded_at:i<2?'2026-10-13T08:00:00Z':null,report_review_status:i<2?'pending':null,report_upload_token:i<2?'layout-report':null}));
  Object.assign(ctx.db.tables.orders[2],{uncompleted_work_amount:100,uncompleted_work_description:'Клиент перенёс монтаж второй шторы'});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#bosOrderControlSummary')).toBeVisible();
  return ctx;
}

// Catches the actual regression: a hidden half-width schedule and separate grids
// place today's orders below unrelated blocks and leave unused desktop columns.
test('owner overview keeps today and the full week visible in the approved compact grid',async({page},info)=>{
  await page.setViewportSize({width:1366,height:768});
  await ready(page);
  const dashboard=page.locator('#ownerDashboard');
  await expect(dashboard.locator('.odTable')).toBeVisible();
  const box=await dashboard.boundingBox(),today=await dashboard.locator('.odTodayList').boundingBox(),reports=await dashboard.locator('.odReports').boundingBox(),load=await dashboard.locator('.odLoad').boundingBox();
  expect(Math.abs(today.y-reports.y)).toBeLessThanOrEqual(2);
  expect(today.width).toBeGreaterThan(reports.width*1.4);
  expect(Math.abs(load.width-box.width)).toBeLessThanOrEqual(2);
  expect(load.y).toBeGreaterThan(today.y);
  expect(await dashboard.locator('.odTableScroll').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1024,900],[768,1024],[360,800],[390,844],[430,932],[412,915]]){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await expect(dashboard.locator('.odTodayList [data-owner-order]').first()).toBeVisible();
    await expect(dashboard.locator('.odTable')).toBeVisible();
    const metrics=await dashboard.locator(':scope > .odMetrics > .dashMetric').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top})));
    expect(Math.max(...metrics.map(m=>m.height))-Math.min(...metrics.map(m=>m.height))).toBeLessThanOrEqual(1);
    if(width>=1366)expect(new Set(metrics.map(m=>m.top)).size).toBe(1);
    if(width<768){
      const a=await dashboard.locator('.odTodayList').boundingBox(),b=await dashboard.locator('.odReports').boundingBox();
      expect(b.y).toBeGreaterThanOrEqual(a.y+a.height);
      await dashboard.locator('.odTableScroll').evaluate(e=>e.scrollLeft=e.scrollWidth);
      const last=await dashboard.locator('thead th').last().boundingBox();
      expect(last.x+last.width).toBeLessThanOrEqual(width);
      await dashboard.locator('.odTableScroll').evaluate(e=>e.scrollLeft=0);
    }
    if([1920,1366,390,412].includes(width)){
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:info.outputPath(`owner-${width}x${height}.png`)});
      await page.screenshot({path:info.outputPath(`owner-${width}x${height}-full.png`),fullPage:true});
    }
  }
});

test('owner overview links retain their existing destinations without order writes',async({page})=>{
  const {db}=await ready(page);
  const root=page.locator('#ownerDashboard');
  await root.locator('.odTodayList [data-owner-order="14"]').click();
  await expect(page.locator('#modalRoot')).toContainText('Михаил');
  await page.locator('.modalClose').click();
  await root.locator('.odReports [data-owner-list="reports"]').click();
  await expect(page.locator('.odModalList [data-owner-review="11"]')).toBeVisible();
  await page.locator('.modalClose').click();
  await root.locator('[data-owner-day="2026-10-13"]').first().click();
  await expect(page.locator('#modalRoot')).toContainText('Иван');
  await page.locator('.modalClose').click();
  for(const destination of ['orders','dispatch','team','finance']){
    await root.locator(`[data-owner-page="${destination}"]`).first().click();
    await expect.poll(()=>page.evaluate(()=>state.page)).toBe(destination);
    await page.evaluate(()=>show('home'));
  }
  await root.locator('[data-owner-new]').click();await expect(page.locator('#orderForm')).toBeVisible();await page.locator('.modalClose').click();
  await root.locator('[data-oc-home-filter="contact"]').click();await expect(page.locator('#bosOrderControl')).toBeVisible();
  expect(db.calls.filter(c=>c.table==='orders'&&['update','insert','delete'].includes(c.mode))).toEqual([]);
});

test('empty report queue with an archive link keeps its messages separate',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{state.orders=[];state.settings.reports_drive_folder_url='https://drive.google.com/drive/folders/archive';show('home')});
  const reports=page.locator('#ownerDashboard .odReports');
  await expect(reports.getByRole('link',{name:'Архив отчётов ↗'})).toBeVisible();
  const waiting=await reports.getByText('Ожидают решения',{exact:true}).boundingBox();
  const empty=await reports.getByText('Новых отчётов на проверку нет.',{exact:true}).boundingBox();
  expect(empty.y).toBeGreaterThanOrEqual(waiting.y+waiting.height);
});
