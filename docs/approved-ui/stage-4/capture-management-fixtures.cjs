const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const source=process.env.BOS_QA_ROOT||process.cwd(),out=process.env.BOS_CAPTURE_OUT||path.join(source,'docs/approved-ui/stage-4');
for(const role of ['owner','manager','dispatcher','master'])fs.mkdirSync(path.join(out,role),{recursive:true});
const {fullStack}=require(source+'/tests/helpers/full-stack.cjs');
const {revealFinanceMaster}=require('./management-capture-readiness.cjs');
const {employee,attachmentUrl}=require(source+'/tests/helpers/edge.cjs');

const contractPairs=new Set(require(source+'/docs/approved-ui/screen-contract.json').map(x=>x.role+':'+x.screen));
const sha=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const manifestPath=out+'/capture-manifest.json';let manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)).filter(x=>contractPairs.has(x.role+':'+x.screen)):[];
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const p=path.resolve(source,'.'+(pathname==='/'?'/index.html':pathname));if(!p.startsWith(source+'/')){res.writeHead(403).end();return;}fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b)})});
const write=()=>fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
let browser;
function seed(db,me,master,role){
 const meName={owner:'Илья Зуев',manager:'Анна Волкова',dispatcher:'Мария Соколова',master:'Алексей Смирнов'}[role];
 Object.assign(db.tables.business_staff.find(x=>x.id===me.id),{full_name:meName,phone:'+79990000001',city:'Санкт-Петербург'});
 Object.assign(db.tables.business_staff.find(x=>x.id===master.id),{full_name:'Алексей Смирнов',phone:'+79990000002',city:'Санкт-Петербург',skills:['карнизы','жалюзи','сантехника']});master.full_name='Алексей Смирнов';
 db.tables.business_staff.push(employee('m2','master',{full_name:'Дмитрий Козлов',phone:'+79990000003',city:'Санкт-Петербург',skills:['электрика','сантехника']}),employee('m3','master',{full_name:'Сергей Орлов',phone:'+79990000004',city:'Санкт-Петербург'}));
 if(role!=='dispatcher')db.tables.business_staff.push(employee('d2','dispatcher',{full_name:'Мария Соколова',city:'Санкт-Петербург'}));
 const o={id:'7381707',external_id:'7381707',order_number:'7381707',client:'Елена Петрова',phone:'+79990000107',address:'Комендантский проспект, 66к1, кв. 84',work:'Установка двухрядного карниза — 3 м',status:'В работе',amount:6800,original_amount:6800,master_staff_id:master.id,master_name:'Алексей Смирнов',master_payout:3757,source:'Hands',external_source:'hands',city:'Санкт-Петербург',district:'Приморский',scheduled_date:'2026-10-08',scheduled_time:'14:00',time_slot:'14:00–15:00',master_workflow_stage:'assigned',created_at:'2026-10-07T08:00:00Z',updated_at:'2026-10-08T08:00:00Z',comment:'Домофон 84. Парковка со двора. Клиент просит позвонить за 30 минут.',master_comment:'Взять стремянку и дюбели для бетона.',manager_name:'Анна Волкова'};
 db.tables.orders=[o,
 {...o,id:'7381712',external_id:'7381712',order_number:'7381712',source:'Авито',external_source:'avito',client:'Андрей Морозов',phone:'+79990000112',address:'Ленинский проспект, 120, кв. 37',work:'Установка люстры',amount:4500,original_amount:4500,master_payout:2700,master_staff_id:null,master_name:null,scheduled_time:'16:00',time_slot:'16:00–17:00'},
 {...o,id:'7381713',external_id:'7381713',order_number:'7381713',client:'Ольга Иванова',address:'Богатырский проспект, 35к2',work:'Установка рулонных штор — 2 окна',scheduled_date:'2026-10-09',scheduled_time:'11:00',time_slot:'11:00–12:00',amount:5200,original_amount:5200,master_payout:2873,reschedule_requested:true,reschedule_reason:'Клиент просит перенести на пятницу после 14:00',reschedule_requested_at:'2026-10-08T07:30:00Z',reschedule_requested_by:master.id},
 {...o,id:'7381714',external_id:'7381714',order_number:'7381714',client:'Павел Васильев',address:'Туристская улица, 28к3',work:'Навеска полок — 3 шт.',status:'В работе',scheduled_date:'2026-10-08',scheduled_time:'10:00',time_slot:'10:00–11:00',amount:3600,original_amount:3600,master_payout:1989,master_workflow_stage:'started',master_departed_at:'2026-10-08T06:30:00Z',master_started_at:'2026-10-08T07:00:00Z'},
 {...o,id:'7381715',external_id:'7381715',order_number:'7381715',client:'Наталья Кузнецова',address:'Савушкина улица, 126',work:'Подрезка карниза по длине × 3 пил.',status:'Выполнена',scheduled_date:'2026-10-08',completed_at:'2026-10-08T08:00:00Z',amount:4800,original_amount:4800,master_payout:2880,source:'Авито',external_source:'avito',extra_work_amount:500,extra_work_description:'Замена подводки',report_review_status:'approved',report_uploaded_at:'2026-10-08T08:00:00Z',report_upload_token:'fixture-report',report_act_url:attachmentUrl('7381715','fixture-report'),report_photo_urls:JSON.stringify([attachmentUrl('7381715','fixture-report','photo.jpg')])},
 {...o,id:'7381716',external_id:'7381716',order_number:'7381716',client:'Михаил Фёдоров',address:'Парашютная улица, 25к1',work:'Сборка комода',status:'В работе',scheduled_date:'2026-10-08',scheduled_time:'09:00',time_slot:'09:00–10:00',amount:6000,original_amount:6000,master_payout:3315,report_review_status:'pending',report_uploaded_at:'2026-10-08T07:30:00Z',report_upload_token:'fixture-report',report_act_url:attachmentUrl('7381716','fixture-report'),report_photo_urls:JSON.stringify([attachmentUrl('7381716','fixture-report','photo.jpg')]),master_workflow_stage:'started'},
 {...o,id:'7381717',external_id:'7381717',order_number:'7381717',client:'Екатерина Сидорова',address:'Авиаконструкторов проспект, 18',work:'Установка жалюзи',scheduled_date:'2026-10-10',scheduled_time:'12:00',time_slot:'12:00–13:00',master_staff_id:'m2',master_name:'Дмитрий Козлов',amount:7200,original_amount:7200,master_payout:3978},
 {...o,id:'7381718',external_id:'7381718',order_number:'7381718',client:'Виктор Алексеев',address:'Комендантский проспект, 41',work:'Замена смесителя',status:'Выполнена',scheduled_date:'2026-10-07',completed_at:'2026-10-07T12:00:00Z',amount:4200,original_amount:4200,master_payout:2520,source:'По рекомендации',external_source:'manual',report_review_status:'approved'},
 {...o,id:'7381719',external_id:'7381719',order_number:'7381719',client:'Ирина Белова',address:'Королёва проспект, 63',work:'Установка карниза',status:'Отменена',scheduled_date:'2026-10-06',amount:2800,original_amount:2800,master_payout:1547,comment:'Клиент отменил заказ'}];
 for(const order of db.tables.orders)if(order.external_source==='hands')order.external_id='hands:'+order.order_number;
 db.tables.staff_schedule=[];for(let day=1;day<=31;day++)for(const id of [master.id,'m2','m3'])db.tables.staff_schedule.push({id:`${id}-${day}`,staff_id:id,work_date:`2026-10-${String(day).padStart(2,'0')}`,is_working:id==='m3'?day%3!==0:day%7!==4,work_start:id==='m2'?'13:00':'10:00',work_end:'20:00'});
 db.tables.finance_expenses=[{id:'b1b34875-2935-4e79-93e2-1c6b5a135b08',expense_date:'2026-10-08',amount:2400,category:'avito',comment:'Размещение объявлений на неделю',city:'Санкт-Петербург',created_at:'2026-10-08T06:00:00Z',created_by_name:'Илья Зуев',created_by_staff_id:me.id},{id:'b1b34875-2935-4e79-93e2-1c6b5a135b09',expense_date:'2026-10-07',amount:850,category:'tools',comment:'Набор крепежа и расходные материалы',city:'Санкт-Петербург',created_at:'2026-10-07T06:00:00Z',created_by_name:'Илья Зуев',created_by_staff_id:me.id}];
}
async function setup(role,width=390){
 const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,serviceWorkers:'block',locale:'ru-RU',timezoneId:'Europe/Moscow'}),page=await context.newPage();
 const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const host=new URL(r.request().url()).hostname;if(host==='127.0.0.1')return r.continue();blocked.push(r.request().url());return r.abort()});
 await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'));
 const ctx=await fullStack(page,role);seed(ctx.db,ctx.me,ctx.master,role);
 await page.route(/\/(?:api\/proxy|functions\/v1)\/push-api(?:\?|$)/,async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-bos-session'},body:''});
  const body=route.request().postDataJSON(),staff=ctx.db.tables.business_staff.map(x=>({id:x.id,name:x.full_name,role:x.role,has_push:false}));
  await route.fulfill({status:body.action==='controlList'?200:403,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(body.action==='controlList'?{ok:true,tasks:[],staff,reminders_enabled:true,more:false}:{ok:false,error:'Capture is read only'})});
 });
 await page.route(/\/(?:api\/proxy|functions\/v1)\/staff-invite-api(?:\?|$)/,async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-bos-session'},body:''});
  const body=route.request().postDataJSON();await route.fulfill({status:body.action==='issue'?200:403,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(body.action==='issue'?{ok:true,code:'DEMO-ONLY',expires_at:'2026-10-08T10:00:00Z'}:{ok:false,error:'Unsupported synthetic capture action'})});
 });
 await page.goto('http://127.0.0.1:' +server.address().port+'/',{waitUntil:'domcontentloaded'});await page.locator('#authGate').waitFor({state:'hidden',timeout:25000});await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok')&&window.BOS_SESSION_API_READY);await page.evaluate(async role=>{await window.BOS_LOAD_ROLE_MODULES?.(role)},role);await page.waitForFunction(()=>window.BOS_ORDER_CONTROL&&window.BOS_OWNER_DASHBOARD);await page.locator(role==='dispatcher'?'.bosOpsWorkspace':'#ownerDashboard').waitFor({state:'visible'});
 return {context,page,role,...ctx,errors,blocked};
}
async function cap(c,screen,state='populated',actions=[]){const {page,role}=c;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const width=page.viewportSize().width;const name=`${screen}-fixture-${width}${state==='synthetic-fixture'?'':'-'+state.replace('synthetic-fixture-','')}.png`,p=`${out}/${role}/${name}`;await page.screenshot({path:p,fullPage:false});const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth-innerWidth,body:document.body.scrollWidth-innerWidth}));manifest=manifest.filter(x=>x.path!==p&&!(x.role===role&&x.screen===screen&&x.state==='capture-gap'));manifest.push({role,screen,state,width,height:page.viewportSize().height,path:p,source:'local-feature-fixture',commit:sha,runtimeBuild:await page.evaluate(()=>BOS_BUILD.id),buildId:await page.evaluate(()=>BOS_BUILD.id),synthetic:true,fixedClock:'2026-10-08T09:00:00Z',actions,overflow,consoleErrors:[...c.errors],blockedExternalRequests:[...new Set(c.blocked)],coverageGaps:[],visibleEvidence:c.visibleEvidence||{}});write();console.log(`${role} ${screen} ${width}`)}
async function close(c){await c.page.evaluate(()=>{document.querySelector('dialog.ctDialog')?.close();document.querySelector('dialog.ctDialog')?.remove();if(typeof closeModal==='function')closeModal()});await c.page.evaluate(()=>scrollTo(0,0))}
async function nav(c,target){
 await close(c);
 const direct=c.page.locator(`nav [data-page="${target}"]`).first();
 if(await direct.isVisible())await direct.click();
 else if(c.role!=='master'){
   await c.page.locator('nav [data-page="more"]').click();
   await c.page.locator(`[data-bos-destination="${target}"]`).click();
 }else if(target==='team'){
   await c.page.locator('nav [data-page="profile"]').click();
   await c.page.getByRole('button',{name:/Команда/}).click();
 }else throw Error('No visible navigation destination: '+target);
 await c.page.evaluate(()=>scrollTo(0,0));
}
async function attempt(c,name,fn){try{await fn()}catch(e){manifest.push({role:c.role,screen:name,source:'local-feature-fixture',commit:sha,state:'capture-gap',modalText:await c.page.locator('#modalRoot').innerText(),coverageGaps:[e.message.slice(0,800)]});write();console.log('GAP '+c.role+' '+name+' '+e.message.slice(0,220));await close(c).catch(()=>{})}}

async function reviewEvidence(c){
 return c.page.locator('.bosManagementReview').evaluate(modal=>({scrollTop:modal.scrollTop,scrollHeight:modal.scrollHeight,actions:[...modal.querySelectorAll('.bosReviewActions button')].map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id:e.id,visible:r.top>=0&&r.bottom<=innerHeight,unoccluded:hit===e||e.contains(hit),top:r.top,bottom:r.bottom}})}));
}
async function reviewStates(c){
 const p=c.page,modal=p.locator('.bosManagementReview');
 for(const state of ['scrolled-middle','scrolled-end']){await modal.evaluate((e,end)=>e.scrollTop=end?e.scrollHeight:e.scrollHeight/2,state==='scrolled-end');c.visibleEvidence={review:await reviewEvidence(c)};await cap(c,'review','synthetic-fixture-'+state,['original review','scroll']);}
 const order=c.db.tables.orders.find(o=>o.id==='7381716');Object.assign(order,{extra_work_amount:400,extra_work_description:'Сохранённое описание допработ. '.repeat(20),report_photo_urls:JSON.stringify(Array.from({length:15},(_,i)=>attachmentUrl(order.id,'fixture-report',`photo-${i}.jpg`))),uncompleted_work_amount:140,uncompleted_work_items:Array.from({length:14},(_,i)=>({name:`Сохранённая позиция ${i+1}`,quantity:1,unit:'шт.',unit_price:10,amount:10,price_confirmed:true})),uncompleted_work_description:'Сохранённый комментарий к вычету. '.repeat(15)});
 await close(c);await p.evaluate(()=>BOS_REFRESH_NOW());await p.waitForFunction(()=>state.orders.find(o=>o.id==='7381716')?.extra_work_description?.length>300);await p.evaluate(()=>openReportReview('7381716'));
 for(const state of ['long-initial','long-middle','long-end']){await modal.evaluate((e,state)=>e.scrollTop=state==='long-initial'?0:state==='long-middle'?e.scrollHeight/2:e.scrollHeight,state);c.visibleEvidence={review:await reviewEvidence(c)};if(!c.visibleEvidence.review.actions.every(x=>x.visible&&x.unoccluded))throw Error('Review decisions not visible/unoccluded: '+state);await cap(c,'review','synthetic-fixture-'+state,['long saved fixture','scroll']);}
 await p.locator('#rejectReportBtn').click();c.visibleEvidence={review:await reviewEvidence(c)};await cap(c,'review-reject','synthetic-fixture-long-reason',['original required reason validation']);
}

async function management(c){const p=c.page;p.setDefaultTimeout(6000);
 async function run(screen,fn,marker){if(!contractPairs.has(c.role+':'+screen)||(wanted&&!wanted.includes(screen)))return;await attempt(c,screen,async()=>{await close(c);await fn();if(marker)await p.locator(marker).first().waitFor({state:'visible'});await p.evaluate(()=>scrollTo(0,0));if(screen==='review-reject')await p.locator('#reviewComment').scrollIntoViewIfNeeded();if(screen==='staff-invite')await p.locator('[data-staff-invite-card]').scrollIntoViewIfNeeded();c.visibleEvidence={};if(screen==='finance-master')c.visibleEvidence.financeMaster=await revealFinanceMaster(p);await cap(c,screen,'synthetic-fixture',[screen]);if(screen==='dashboard'){await p.locator('.odSecondaryIndicators summary').click();await p.locator('.odSecondaryIndicators').scrollIntoViewIfNeeded();await cap(c,screen,'synthetic-fixture-secondary',[screen,'secondary indicators']);}if(screen==='review')await reviewStates(c);})}
 const wanted=process.env.BOS_CAPTURE_SCREENS?.split(',');
 const tasks=[
 ['dashboard',()=>nav(c,'home'),'.bosManagementHeading'],
 ['team',()=>p.evaluate(()=>show('team')),'.bosManagementTeam'],
 ['team-member',()=>p.evaluate(()=>openEmployeeProfile('staff_m')),'.bosManagementMember'],
 ['profile',()=>p.locator('#profileBtn').click(),'.bosManagementProfile'],
 ['more',()=>p.evaluate(()=>show('more')),'.bosMore'],
 ['control',()=>p.evaluate(()=>BOS_ORDER_CONTROL.open()),'#bosOrderControl [data-oc-order]'],
 ['control-task',async()=>{await p.evaluate(()=>BOS_ORDER_CONTROL.open());await p.locator('[data-ct-edit=\"7381712\"][data-ct-code=unassigned]').click();},'dialog.ctDialog'],
 ['reports',()=>p.locator('[data-owner-list=reports]').first().click(),'.odModalList'],
 ['review',()=>p.evaluate(()=>openReportReview('7381716')),'.bosManagementReview'],
 ['review-reject',async()=>{await p.evaluate(()=>openReportReview('7381716'));await p.locator('#rejectReportBtn').click();},'#reviewMsg'],
 ['manual-complete',()=>p.evaluate(()=>openManualCompletion('7381707')),'#manualCompletionForm'],
 ['order-delete',()=>p.evaluate(()=>openOrder('7381707')),'[data-bos-delete-order]'],
 ['memo-edit',()=>p.evaluate(()=>state.user.role==='owner'?openOwnerMemoManager():openManagerMemoEditor()),'#managerMemoForm,#ownerMemoForm'],
 ['staff-access',()=>p.evaluate(()=>openStaffAccess('all')),'#modalRoot .modal'],
 ['staff-invite',async()=>{await p.evaluate(()=>openEmployeeProfile('staff_m'));await p.locator('[data-issue-staff-invite]').click();await p.locator('[data-copy-invite]').waitFor({state:'visible'});},'[data-staff-invite-card]'],
 ['admin',()=>p.evaluate(()=>openOwnerTools()),'.ownerToolsHead'],
 ['invite',()=>p.evaluate(()=>openEmployeeForm()),'#empForm'],
 ['employee-edit',()=>p.evaluate(()=>openStaffAdminCard('m')),'#staffCredForm'],
 ['workspace',()=>nav(c,'home'),'#ownerDashboard'],
 ['attention',()=>p.evaluate(()=>openBosOpsAttention()),'.bosOpsAttention'],
 ['orders',()=>p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('all')}),'#bosOrderList .bosOpsListRow'],
 ['orders-new',()=>p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('opsNew')}),'#bosOrderList'],
 ['orders-active',()=>p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('active')}),'#bosOrderList'],
 ['orders-reports',async()=>{await nav(c,'home');await p.locator('[data-owner-list=reports]').first().click();},'.odModalList'],
 ['orders-archive',()=>p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('done')}),'#bosOrderList'],
 ['order-detail',()=>p.evaluate(()=>openOrder('7381707')),'.bosManageOrder'],
 ['order-create',()=>p.evaluate(()=>openOrderForm()),'.newOrderForm'],
 ['order-edit',()=>p.evaluate(()=>openOrderForm('7381707')),'.newOrderForm'],
 ['assign',()=>p.evaluate(()=>openDispatcherSmartAssign119('7381712')),'.bosOpsAssign'],
 ['reschedule',()=>p.evaluate(()=>openDispatcherReschedule('7381713')),'.bosOpsReschedule'],
 ['filters',async()=>{await p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('all')});await p.locator('#dmv3City').waitFor({state:'attached'});await p.getByRole('button',{name:'Фильтры',exact:true}).click();},'[data-original-id=dmv3Status]'],
 ['free-slots',()=>p.evaluate(()=>openBosOpsFreeSlots()),'.dfs120Master'],
 ['slot-assign',async()=>{await p.evaluate(()=>openBosOpsFreeSlots());await p.locator('.dfs120Slot').first().click();},'#dfs120Orders'],
 ['order-cancel',()=>p.evaluate(()=>openDispatcherCancelOrder('7381707')),'#dwv114CancelConfirm'],
 ['schedule',()=>nav(c,'dispatch'),'.usManagement'],
 ['schedule-month',()=>p.evaluate(()=>openBosOpsMonth()),'.bosOpsMonthGrid'],
 ['day-detail',()=>p.evaluate(()=>openUnifiedScheduleMasterDay('2026-10-08','m')),'.usMasterList'],
 ];
 const ownerOnly=['admin','invite','employee-edit','staff-invite'];
 const small=p.viewportSize().width!==390&&p.viewportSize().width!==1440;
 for(const [screen,fn,marker]of tasks){if(wanted&&!wanted.includes(screen))continue;if(small&&!['dashboard','team','profile','review','control','schedule'].includes(screen))continue;if(ownerOnly.includes(screen)&&c.role!=='owner')continue;if(screen==='reports')await nav(c,'home');if(screen==='employee-edit')await p.evaluate(()=>openStaffAccess('all'));await run(screen,fn,marker)}
 if(wanted&&!wanted.some(x=>x.startsWith('finance-')||x.startsWith('expense-')))return;
 await nav(c,'finance');await p.locator('#financePage').waitFor({state:'visible'});await p.waitForFunction(()=>![...document.querySelectorAll('.finNote')].some(e=>e.textContent.includes('Расходы загружаются')));
 for(const tab of ['overview','expenses','masters','orders','sources','works','periods'])await run('finance-'+tab,async()=>{await p.locator(`[data-fin-tab=${tab}]`).click();await p.locator(`[data-fin-tab=${tab}].primary`).waitFor({state:'visible'})},'#finContent');
 if(!small){
 await run('finance-overview-unknown',async()=>{await p.evaluate(()=>{state.orders.find(o=>o.id==='7381715').master_payout=null;show('finance')});await p.locator('[data-fin-tab=overview]').click()},'#finContent');
 await run('finance-filters',()=>p.locator('.finFilters summary').click(),'.finFilterGrid');
 await run('finance-period',async()=>{await p.locator('.finPeriodControl summary').click();await p.locator('[data-fin-period=custom]').click()},'#finPeriodForm');
 if(!wanted||wanted.includes('finance-period')){await p.locator('.finPeriodControl').evaluate(e=>e.open=true);await p.locator('[data-fin-period=month]').click();}
 await run('expense-new',async()=>{await p.locator('[data-fin-tab=expenses]').click();await p.locator('[data-fin-expense-add]').click()},'#finExpenseForm');
 await run('expense-edit',async()=>{await p.locator('[data-fin-tab=expenses]').click();await p.locator('[data-fin-expense-edit]').first().click()},'#finExpenseForm');
 await run('expense-delete',async()=>{await p.locator('[data-fin-tab=expenses]').click();await p.locator('[data-fin-expense-delete]').first().click()},'#finExpenseDeleteForm');
 await run('finance-master',async()=>{await p.locator('[data-fin-tab=masters]').click();await p.locator('[data-fin-master]').first().click()},'#finMasterDetail');
 }
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/headless_shell',headless:true,args:['--no-sandbox']});try{for(const role of (process.env.BOS_CAPTURE_ROLES?.split(',')||['manager','owner']))for(const width of (process.env.BOS_CAPTURE_WIDTHS?process.env.BOS_CAPTURE_WIDTHS.split(',').map(Number):[360,390,430,768,1440])){const c=await setup(role,width);try{await management(c)}finally{await c.context.close()}}}finally{await browser.close();server.close();write()}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
