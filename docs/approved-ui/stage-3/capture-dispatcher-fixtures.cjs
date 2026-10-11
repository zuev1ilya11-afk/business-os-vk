const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const source=process.env.BOS_QA_ROOT||process.cwd(),out=process.env.BOS_CAPTURE_OUT||path.join(source,'docs/approved-ui/stage-3');
for(const role of ['owner','manager','dispatcher','master'])fs.mkdirSync(path.join(out,role),{recursive:true});
const {fullStack}=require(source+'/tests/helpers/full-stack.cjs');
const {employee,attachmentUrl}=require(source+'/tests/helpers/edge.cjs');
const mode=process.argv[2]||'basic',roleArg=process.argv[3];
const sha=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const manifestPath=out+'/capture-manifest.json';let manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):[];
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
 {...o,id:'7381715',external_id:'7381715',order_number:'7381715',client:'Наталья Кузнецова',address:'Савушкина улица, 126',work:'Подключение стиральной машины',status:'Выполнена',scheduled_date:'2026-10-08',completed_at:'2026-10-08T08:00:00Z',amount:4800,original_amount:4800,master_payout:2880,source:'Авито',external_source:'avito',extra_work_amount:500,extra_work_description:'Замена подводки',report_review_status:'approved',report_uploaded_at:'2026-10-08T08:00:00Z',report_upload_token:'fixture-report',report_act_url:attachmentUrl('7381715','fixture-report'),report_photo_urls:JSON.stringify([attachmentUrl('7381715','fixture-report','photo.jpg')])},
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
 const ctx=await fullStack(page,role);await page.route('**/mini-app-api',async r=>{await new Promise(resolve=>setTimeout(resolve,350));await r.fallback()});seed(ctx.db,ctx.me,ctx.master,role);
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});await page.locator('#authGate').waitFor({state:'hidden',timeout:25000});await page.evaluate(async role=>{await window.BOS_LOAD_ROLE_MODULES?.(role)},role);await page.waitForFunction(()=>window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190&&window.BOS_DISPATCHER_QUICK_ACTIONS_V159);await page.locator('.bosOpsWorkspace').waitFor({state:'visible'});
 return {context,page,role,...ctx,errors,blocked};
}
async function cap(c,screen,state='populated',actions=[]){const {page,role}=c;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const width=page.viewportSize().width;const name=`${screen}-fixture-${width}.png`,p=`${out}/${role}/${name}`;await page.screenshot({path:p,fullPage:false});const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth-innerWidth,body:document.body.scrollWidth-innerWidth}));manifest=manifest.filter(x=>x.path!==p&&!(x.role===role&&x.screen===screen&&x.state==='capture-gap'));manifest.push({role,screen,state,width,height:page.viewportSize().height,path:p,source:'local-feature-fixture',commit:sha,buildId:await page.evaluate(()=>BOS_BUILD.id),synthetic:true,fixedClock:'2026-10-08T09:00:00Z',actions,overflow,consoleErrors:[...c.errors],blockedExternalRequests:[...new Set(c.blocked)],coverageGaps:[]});write();console.log(`${role} ${screen} ${width}`)}
async function close(c){await c.page.evaluate(()=>{if(typeof closeModal==='function')closeModal()});await c.page.evaluate(()=>scrollTo(0,0))}
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
 await c.page.waitForTimeout(250);await c.page.evaluate(()=>scrollTo(0,0));
}
async function attempt(c,name,fn){try{await fn()}catch(e){manifest.push({role:c.role,screen:name,source:'local-feature-fixture',commit:sha,state:'capture-gap',coverageGaps:[e.message.slice(0,800)]});write();console.log('GAP '+c.role+' '+name+' '+e.message.slice(0,220));await close(c).catch(()=>{})}}

async function dispatcher(c){const p=c.page;p.setDefaultTimeout(7000);
 async function run(screen,fn,marker){await attempt(c,screen,async()=>{await close(c);await fn();if(marker)await p.locator(marker).first().waitFor({state:'visible'});if(screen==='orders'&&p.viewportSize().width<=760){await p.locator('.duq122').waitFor({state:'attached'});await p.waitForFunction(()=>document.querySelector('#bosOrderList').nextElementSibling?.matches('.duq122'))}await p.evaluate(()=>scrollTo(0,0));await cap(c,screen,'synthetic-fixture',[screen]);})}
 const tasks=[
 ['workspace',()=>nav(c,'home'),'.bosOpsWorkspace'],
 ['attention',()=>p.evaluate(()=>openBosOpsAttention()),'.bosOpsAttention'],
 ['orders',()=>p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('all')}),'#bosOrderList .bosOpsListRow'],
 ['order-detail',()=>p.evaluate(()=>openOrder('7381707')),'.bosManageOrder'],
 ['order-create',()=>p.evaluate(()=>openOrderForm()),'.newOrderForm'],
 ['order-edit',()=>p.evaluate(()=>openOrderForm('7381707')),'.newOrderForm'],
 ['assign',()=>p.evaluate(()=>openDispatcherSmartAssign119('7381712')),'.bosOpsAssign'],
 ['reschedule',()=>p.evaluate(()=>openDispatcherReschedule('7381713')),'.bosOpsReschedule'],
 ['schedule',()=>nav(c,'dispatch'),'.bosOpsDaySchedule'],
 ['team',()=>p.evaluate(()=>show('team')),'.compactTeam'],
 ['master-detail',()=>p.evaluate(()=>openEmployeeProfile('staff_m')),'.bosOpsMasterVisits'],
 ['profile',()=>p.locator('#profileBtn').click(),'.bosOpsProfile'],
 ['filters',async()=>{await p.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('all')});await p.locator('#dmv3City').waitFor({state:'attached'});await p.getByRole('button',{name:'Фильтры',exact:true}).click();},'[data-original-id=dmv3Status]'],
 ['free-slots',()=>p.evaluate(()=>openBosOpsFreeSlots()),'.dfs120Master'],
 ['order-cancel',()=>p.evaluate(()=>openDispatcherCancelOrder('7381707')),'#dwv114CancelConfirm'],
 ['schedule-month',()=>p.evaluate(()=>openBosOpsMonth()),'.bosOpsMonthGrid'],
 ['day-detail',()=>p.evaluate(()=>openUnifiedScheduleMasterDay('2026-10-08','m')),'.usMasterList'],
 ['master-report',()=>p.evaluate(()=>showDispatcherReport()),'.bosOpsMasterReport'],
 ['slot-assign',async()=>{await p.evaluate(()=>openBosOpsFreeSlots());await p.locator('.dfs120Slot').first().click();},'#dfs120Orders']
 ];for(const t of tasks)if(!process.env.BOS_CAPTURE_SCREENS||process.env.BOS_CAPTURE_SCREENS.split(',').includes(t[0]))await run(...t);
 if(!process.env.BOS_CAPTURE_SCREENS)for(const [screen,id] of [['order-create-bottom',null],['order-edit-bottom','7381707']])await run(screen,async()=>{await p.evaluate(id=>openOrderForm(id),id);await p.locator('.newOrderForm').waitFor({state:'visible'});await p.locator('.newOrderActions [type=submit]').scrollIntoViewIfNeeded()},'.newOrderActions');
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/headless_shell',headless:true,args:['--no-sandbox']});try{for(const width of (process.env.BOS_CAPTURE_WIDTHS?process.env.BOS_CAPTURE_WIDTHS.split(',').map(Number):[360,390,430,768,1440])){const c=await setup('dispatcher',width);try{await dispatcher(c)}finally{await c.context.close()}}}finally{await browser.close();server.close();write()}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
