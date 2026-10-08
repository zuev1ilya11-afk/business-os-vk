const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');
const fs=require('node:fs');
const path=require('node:path');

const OUT=path.resolve('audit-screenshots');
fs.mkdirSync(OUT,{recursive:true});
const roles=['owner','manager','dispatcher','master'];

function safe(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi,'-').replace(/^-|-$/g,'')||'screen'}
async function shot(page,name){await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:true});}

async function boot(page,role){
  await page.clock.install({time:new Date('2026-10-08T15:00:00Z')});
  const ctx=await fullStack(page,role);
  const {db,master}=ctx;
  const today='2026-10-08';
  const masters=role==='master'?[master]:[
    master,
    employee('m2','master',{full_name:'Алексей Смирнов',city:'Санкт-Петербург'}),
    employee('m3','master',{full_name:'Роман Кузнецов',city:'Санкт-Петербург'}),
    employee('m4','master',{full_name:'Денис Орлов',city:'Санкт-Петербург'})
  ];
  if(role!=='master')db.tables.business_staff.push(...masters.slice(1));
  const base={...db.tables.orders[0],created_at:'2026-10-08T08:00:00Z',city:'Санкт-Петербург',phone:'+7 999 123-45-67',source:'Hands'};
  db.tables.orders=[
    {...base,id:'11',external_id:'hands:7357206',client:'Анна',address:'Комендантский пр., 63',work:'Карниз ×2\nПодрезка карниза ×2',status:'В работе',amount:8400,original_amount:8400,scheduled_date:today,scheduled_time:'19:00',master_staff_id:master.id,master_name:master.full_name,master_workflow_stage:'assigned',master_called_at:'2026-10-08T09:00:00Z',master_contact_status:'agreed',master_contact_comment:'Будут дома к 19:00. Карниз куплен.'},
    {...base,id:'12',external_id:'hands:7376520',client:'Ирина',address:'ул. Парашютная, 17к2',work:'Шторы ×4',status:'В работе',amount:6200,scheduled_date:'2026-10-09',scheduled_time:'11:00',master_staff_id:master.id,master_name:master.full_name,master_workflow_stage:'assigned'},
    {...base,id:'13',source:'Авито',external_id:'avito:7380308',client:'Олег',address:'ул. Гданьская, 5к1',work:'Карниз',status:'В работе',amount:4700,scheduled_date:'2026-10-10',scheduled_time:null,master_staff_id:role==='master'?master.id:masters[1]?.id||master.id,master_name:role==='master'?master.full_name:masters[1]?.full_name||master.full_name,master_workflow_stage:'assigned'},
    {...base,id:'14',source:'Hands',external_id:'hands:7384249',client:'Мария',address:'ул. Яхтенная, 40, подъезд 1',work:'Карниз ×2',status:'В работе',amount:5600,scheduled_date:null,scheduled_time:null,master_staff_id:master.id,master_name:master.full_name,master_workflow_stage:'assigned',master_called_at:null,master_contact_status:null,master_contact_history:[]},
    {...base,id:'15',source:'Авито',external_id:'avito:7381707',client:'Сергей',address:'Комендантский пр., 66к1',work:'Римские шторы',status:'В работе',amount:7100,scheduled_date:null,scheduled_time:null,master_staff_id:master.id,master_name:master.full_name,master_workflow_stage:'assigned',master_contact_status:'no_answer',master_contact_comment:'Не ответил на звонок.',master_contact_callback_at:'2026-10-08T16:30:00Z'},
    {...base,id:'16',source:'Hands',external_id:'hands:7385211',client:'Наталья',address:'Выборгское шоссе, 5к1',work:'Карниз ×4',status:'В работе',amount:9800,scheduled_date:null,scheduled_time:null,master_staff_id:role==='master'?master.id:masters[2]?.id||master.id,master_name:role==='master'?master.full_name:masters[2]?.full_name||master.full_name,master_workflow_stage:'assigned',master_contact_status:'waiting_delivery',master_contact_comment:'Доставка 12 октября, затем монтаж.'},
    {...base,id:'17',source:'Авито',external_id:'avito:7390001',client:'Виктор',address:'Московский пр., 120',work:'Монтаж карниза',status:'В работе',amount:5300,scheduled_date:today,scheduled_time:'14:00',master_staff_id:null,master_name:null,master_workflow_stage:'assigned'},
    {...base,id:'18',source:'Hands',external_id:'hands:7390002',client:'Елена',address:'Лиговский пр., 77',work:'Шторы ×2',status:'Выполнена',amount:6500,original_amount:6500,extra_work_amount:800,completed_at:'2026-10-08T12:00:00Z',scheduled_date:today,scheduled_time:'10:00',master_staff_id:master.id,master_name:master.full_name,master_payout:3400,report_review_status:'approved',master_workflow_stage:'reported'}
  ];
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden({timeout:15000});
  await page.waitForTimeout(350);
  return ctx;
}

async function captureNav(page,role){
  const nav=page.locator('#app > nav button[data-page]');
  const count=await nav.count();
  for(let i=0;i<count;i++){
    const b=nav.nth(i);
    if(!await b.isVisible())continue;
    const pageName=await b.getAttribute('data-page');
    const label=(await b.innerText()).trim();
    await b.click();
    await page.waitForTimeout(250);
    await shot(page,`${role}-nav-${safe(pageName)}-${safe(label)}`);
  }
}

async function captureProfile(page,role){
  const btn=page.locator('#profileBtn');
  if(!await btn.isVisible())return;
  await btn.click();
  await page.waitForTimeout(200);
  const modal=page.locator('#modalRoot .modal');
  if(await modal.count()&&await modal.isVisible()){
    await shot(page,`${role}-profile-modal`);
    const close=page.locator('#modalRoot .modalClose');
    if(await close.count())await close.click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
}

async function masterHomeTabs(page){
  await page.evaluate(()=>show('home'));await page.waitForTimeout(200);
  const root=page.locator('#masterDailyV127');
  if(!await root.count())return;
  const tabs=root.getByRole('tab');
  for(let i=0;i<await tabs.count();i++){
    const t=tabs.nth(i);const label=(await t.innerText()).trim();
    await t.click();await page.waitForTimeout(150);await shot(page,`master-home-tab-${safe(label)}`);
  }
}

async function financeTabs(page,role){
  const fin=page.locator('#app > nav [data-page="finance"]');
  if(!await fin.count()||!await fin.isVisible())return;
  await fin.click();await page.waitForTimeout(350);
  const tabs=page.locator('#financePage [data-fin-tab]');
  for(let i=0;i<await tabs.count();i++){
    const t=tabs.nth(i);const label=(await t.innerText()).trim();
    await t.click();await page.waitForTimeout(180);await shot(page,`${role}-finance-tab-${safe(label)}`);
  }
}

async function dispatcherDesktopViews(page){
  if(!(await page.locator('#roleBadge').innerText()).includes('Диспетчер'))return;
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>show('orders'));await page.waitForTimeout(300);
  await shot(page,'dispatcher-desktop-orders-default');
  const views=page.locator('.dbViewTabs button');
  for(let i=0;i<await views.count();i++){
    const b=views.nth(i);if(!await b.isVisible())continue;const label=(await b.innerText()).trim();
    await b.click();await page.waitForTimeout(180);await shot(page,`dispatcher-desktop-orders-${safe(label)}`);
  }
  await page.setViewportSize({width:390,height:1000});
}

for(const role of roles){
  test(`UI audit screenshots: ${role}`,async({page})=>{
    await page.setViewportSize({width:390,height:1000});
    await boot(page,role);
    await captureNav(page,role);
    await captureProfile(page,role);
    if(role==='master')await masterHomeTabs(page);
    if(role==='owner'||role==='manager')await financeTabs(page,role);
    if(role==='dispatcher')await dispatcherDesktopViews(page);
  });
}
