const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const source=process.env.BOS_QA_ROOT||process.cwd(),out=process.env.BOS_CAPTURE_OUT||path.join(source,'docs/approved-ui/stage-5');
for(const role of ['owner','manager','dispatcher','master'])fs.mkdirSync(path.join(out,role),{recursive:true});
const {fullStack}=require(source+'/tests/helpers/full-stack.cjs');

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
 await services(page,ctx,role);
 await page.goto('http://127.0.0.1:' +server.address().port+'/',{waitUntil:'domcontentloaded'});await page.locator('#authGate').waitFor({state:'hidden',timeout:25000});await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok')&&window.BOS_SESSION_API_READY);await page.evaluate(async role=>{await window.BOS_LOAD_ROLE_MODULES?.(role)},role);await page.locator('#content').waitFor({state:'visible'});
 return {context,page,role,...ctx,errors,blocked};
}
async function cap(c,screen,state='populated',actions=[]){const {page,role}=c;if(['error','offline'].includes(screen)){await page.waitForFunction(async()=>{for(let i=0;i<8;i++){const notice=document.querySelector('#ownerDashboard .odRefreshState');if(!notice||notice.hidden||!notice.textContent.includes('Не удалось обновить')||document.getElementById('bosManualRefresh')?.disabled)return false;await new Promise(requestAnimationFrame)}return true});c.visibleEvidence={...c.visibleEvidence,refresh:await page.evaluate(()=>({error:window.BOS_LAST_REFRESH_ERROR,notice:document.querySelector('.odRefreshState')?.textContent,noticeVisible:!document.querySelector('.odRefreshState')?.hidden,refreshBusy:!!document.getElementById('bosManualRefresh')?.disabled}))};}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const width=page.viewportSize().width;const name=`${screen}-fixture-${width}${state==='synthetic-fixture'?'':'-'+state.replace('synthetic-fixture-','')}.png`,p=`${out}/${role}/${name}`;await page.screenshot({path:p,fullPage:false});const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth-innerWidth,body:document.body.scrollWidth-innerWidth}));manifest=manifest.filter(x=>x.path!==p&&!(x.role===role&&x.screen===screen&&x.width===width&&x.state==='capture-gap'));manifest.push({role,screen,state,width,height:page.viewportSize().height,path:p,source:'local-feature-fixture',commit:sha,runtimeBuild:await page.evaluate(()=>BOS_BUILD.id),buildId:await page.evaluate(()=>BOS_BUILD.id),synthetic:true,fixedClock:'2026-10-08T09:00:00Z',actions,overflow,consoleErrors:[...c.errors],blockedExternalRequests:[...new Set(c.blocked)],coverageGaps:[],visibleEvidence:c.visibleEvidence||{}});write();console.log(`${role} ${screen} ${width}`)}
async function close(c){await c.page.evaluate(()=>{document.querySelector('dialog.ctDialog')?.close();document.querySelector('dialog.ctDialog')?.remove();window.BOS_CLOSE_REPORT_PHOTO?.();document.querySelector('.bosNotifyClose')?.click();if(typeof closeModal==='function')closeModal()});await c.page.evaluate(()=>scrollTo(0,0))}
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
async function attempt(c,name,fn){try{await fn()}catch(e){manifest.push({role:c.role,screen:name,width:c.page.viewportSize().width,source:'local-feature-fixture',commit:sha,state:'capture-gap',modalText:await c.page.locator('#modalRoot').innerText(),coverageGaps:[e.message.slice(0,800)]});write();console.log('GAP '+c.role+' '+name+' '+e.message.slice(0,220));await close(c).catch(()=>{})}}

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
async function services(page,ctx,role){
 const claim={id:'fixture-claim',order_id:'7381715',master_id:ctx.master.id,master_staff_id:ctx.master.id,status:'open',reason:'Ослабло крепление карниза',required_work:'Проверить крепление и закрепить кронштейн',scheduled_date:'2026-10-09',scheduled_time:'11:00',pay_revisit:false,revisit_payment:0};ctx.db.tables.claims=[claim];
 await page.route(/\/(?:api\/proxy|functions\/v1)\/claims-api(?:\?|$)/,async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:cors,body:''});await r.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({ok:true,claims:[claim],orders:ctx.db.tables.orders,masters:[ctx.master]})});});
 await page.route(/\/(?:api\/proxy|functions\/v1)\/(avito-api|hands-api|integration-api)(?:\?|$)/,async r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:cors,body:''});const b=r.request().postDataJSON(),service=new URL(r.request().url()).pathname.split('/').pop();let d={ok:false,error:'Read-only synthetic fixture'};
  if(service==='avito-api'){
   if(b.action==='status')d={ok:true,connected:true,configured:true,connection:{account_name:'Домашний мастер · тест',avito_user_id:'FIXTURE',last_sync_at:'2026-10-08T09:00:00Z'}};
   if(b.action==='chats')d={ok:true,chats:[{id:'fixture-chat',client:'Елена Соколова',phone:'+79990000000',item_title:'Установка карниза',last_message:'Можно сегодня вечером?',unread_count:2},{id:'fixture-chat-2',client:'Иван Петров',item_title:'Навеска полки',last_message:'Сколько стоит установка?',unread_count:0}],next_offset:null};
   if(b.action==='messages')d={ok:true,messages:[{id:'m1',text:'Здравствуйте! Нужно установить два карниза.',direction:'in',created_at:'2026-10-08T08:00:00Z'},{id:'m2',text:'Добрый день. Карнизы уже у вас?',direction:'out',created_at:'2026-10-08T08:01:00Z'},{id:'m3',text:'Да, всё доставили. Можно сегодня вечером?',direction:'in',created_at:'2026-10-08T08:02:00Z'}],next_offset:null};
   if(b.action==='read')d={ok:true};
  }
  if(service==='hands-api'&&b.action==='health')d={ok:true,configured:true,base_url:'api.hands.ru'};
  if(service==='integration-api'&&b.action==='listIntegrations')d={ok:true,integrations:[{id:'fixture-api',name:'Форма сайта',slug:'site',is_active:true,last_used_at:'2026-10-08T09:00:00Z',field_mapping:{client:'customer.name',phone:'phone',address:'address'}}]};
  await r.fulfill({status:d.ok?200:403,headers:cors,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.route('https://fixture.invalid/document.svg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#edf2f8"/><text x="50" y="80" font-size="25">СИНТЕТИЧЕСКИЙ ДОКУМЕНТ</text><text x="50" y="150" font-size="22">Акт выполненных работ</text><path d="M50 220H550M50 300H550M50 380H550M50 460H550" stroke="#aaa"/></svg>'}));
}
async function profile(c){await close(c);await c.page.evaluate(role=>role==='master'?show('team'):openOwnerProfile(),c.role);await c.page.locator(c.role==='master'?'.bosProfileMenu':'.bosManagementProfileMenu').waitFor({state:'visible'});}
async function shared(c){const p=c.page;p.setDefaultTimeout(5000);
 const wanted=process.env.BOS_CAPTURE_SCREENS?.split(',');
 if(!wanted){await p.evaluate(()=>show('home'));await cap(c,c.role==='master'?'home-days':c.role==='dispatcher'?'workspace':'dashboard','synthetic-fixture-shell',['real role shell']);}
 async function run(screen,fn,marker){if(!contractPairs.has(c.role+':'+screen)||(wanted&&!wanted.includes(screen)))return;await attempt(c,screen,async()=>{await close(c);await fn();if(marker)await p.locator(marker).first().waitFor({state:'visible'});if(screen==='hands-order')await p.locator('#handsOrderActions').scrollIntoViewIfNeeded();await cap(c,screen,'synthetic-fixture',[screen]);if(screen==='profile'){await p.locator('[data-bos-shared=about]').scrollIntoViewIfNeeded();await cap(c,screen,'synthetic-fixture-menu',['profile menu']);}});}
 await run('profile',()=>profile(c),c.role==='master'?'.bosProfileMenu':'.bosManagementProfile');
 for(const screen of ['personal','help','about','login-settings'])await run(screen,async()=>{await profile(c);if(screen==='personal'&&c.role==='master')await p.evaluate(()=>openMasterProfileEdit());else if(screen==='push')await p.evaluate(()=>BOS_PUSH.open());else if(screen==='login-settings')await p.evaluate(()=>BOS_OPEN_AUTH_SETTINGS());else await p.locator(`[data-bos-shared=${screen}]`).click();},'#modalRoot .modal');
 if(!wanted||wanted.includes('push'))await attempt(c,'push',async()=>{
  const {pushPresentation}=require(source+'/tests/helpers/push-presentation.cjs');
  for(const state of (process.env.BOS_CAPTURE_PUSH_STATES||'default,denied,subscribed,unsupported,denied-with-subscription,unknown').split(',')){
   await close(c);await pushPresentation(p,state);await p.evaluate(()=>BOS_PUSH.open());
   await p.waitForFunction(()=>{const field=document.querySelector('[data-push-state=subscription]');return field&&field.textContent!=='Не проверена'});
   if(state==='subscribed')await p.waitForFunction(()=>document.querySelector('#bosPushMessage')?.textContent.includes('Подключены на этом телефоне'));
   c.visibleEvidence=await p.locator('.bosPushStates').innerText();
   await cap(c,'push','synthetic-fixture-'+state,['read-only browser capability, permission and device subscription']);c.visibleEvidence={};
  }
 });
 await run('notifications',()=>p.evaluate(()=>openBosNotifications()),'.bosNotifyPanel');
 await run('claims',()=>p.evaluate(async role=>{await refreshClaims();if(role==='master')openMasterProfileClaimsV129();else showClaims();},c.role),c.role==='master'?'#modalRoot .modal':'.bos-claim-compact');
 await run('claim-detail',()=>p.evaluate(async()=>{await refreshClaims();openClaimDetails('fixture-claim')}),'#modalRoot .modal');
 if(c.role!=='master'){
 await run('claim-create',()=>p.evaluate(()=>openReopenClaimForm('7381715')),'#claimForm');
 await run('avito',()=>p.evaluate(()=>openAvitoInbox()),'.avitoChatRow');
 await run('avito-thread',async()=>{await p.evaluate(()=>{closeModal();show('orders')});await p.evaluate(()=>openAvitoInbox());if(await p.locator('.avitoBackList').isVisible())await p.locator('.avitoBackList').click();await p.locator('.avitoChatRow').first().click();},'.avitoBubble');
 await run('avito-lead',async()=>{await p.evaluate(()=>{closeModal();show('orders')});await p.evaluate(()=>openAvitoInbox());if(await p.locator('.avitoBackList').isVisible())await p.locator('.avitoBackList').click();await p.locator('.avitoChatRow').first().click();await p.locator('.avitoBubble').first().waitFor();if(await p.locator('.avitoShowLead').isVisible())await p.locator('.avitoShowLead').click();},'#avitoLeadForm');
 await run('avito-settings',async()=>{await p.evaluate(()=>openAvitoSettings());},'#modalRoot .modal');
 for(const s of ['hands-settings','hands-sync'])await run(s,()=>p.evaluate(()=>openHandsIntegration()),'.bosSharedIntegration .apiState');
 await run('hands-order',()=>p.evaluate(()=>openOrder('7381707')),'#handsOrderActions');
 }
 await run('file-viewer',async()=>{await p.evaluate(()=>BOS_OPEN_REPORT_PHOTO('https://fixture.invalid/document.svg','Акт выполненных работ'));await p.waitForFunction(()=>document.querySelector('#reportPhotoViewer img')?.naturalWidth>0);},'#reportPhotoViewer');
 await run('photo-error',async()=>{await p.evaluate(()=>BOS_OPEN_REPORT_PHOTO('https://fixture.invalid/missing.jpg','Фото отчёта'));},'.bosSharedPhotoError');
 if(c.role==='master')await run('price',()=>p.evaluate(()=>openMasterMemoItem('price')),'.bosSharedCatalog');
 if(c.role==='dispatcher')await run('reports',async()=>{await p.evaluate(()=>openBosOpsAttention('report'));},'#content');
 if(c.role==='owner'){
 await run('admin',()=>p.evaluate(()=>openOwnerTools()),'.ownerToolsHead');
 await run('settings-proposal',()=>p.evaluate(()=>openOwnerTools()),'.ownerToolsHead');
 await run('api-integrations',()=>p.evaluate(()=>openApiIntegrations()),'.apiBtns');
 await run('api-create',()=>p.evaluate(()=>createApiIntegration()),'#apiIntForm');
 await run('api-mapping',()=>p.evaluate(()=>openApiMapping('fixture-api')),'#apiMapForm');
 await run('role-preview',async()=>{await p.evaluate(()=>openOwnerTools());},'.ownerPreviewBtn');
 if(!wanted||wanted.includes('role-preview'))await attempt(c,'role-preview',async()=>{await close(c);await p.evaluate(()=>openOwnerTools());await p.locator('.ownerPreviewBtn').first().click();await p.locator('body[data-bos-ui-role=master]').waitFor();await p.evaluate(()=>{closeModal();show('team')});await p.getByRole('button',{name:'← Вернуться к владельцу',exact:true}).waitFor();await cap(c,'role-preview','synthetic-fixture-master-return',['existing master preview']);await p.getByRole('button',{name:'← Вернуться к владельцу',exact:true}).click();await p.locator('#ownerDashboard').waitFor();});
 }
}
async function systems(c){
 if(c.role!=='owner'||process.env.BOS_CAPTURE_SCREENS)return;const p=c.page;
 await close(c);await p.evaluate(()=>show('home'));await cap(c,'dashboard','synthetic-fixture-shell',['existing dashboard']);
 await p.route(/mini-app-api(?:\?|$)/,async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:cors,body:''});return r.fulfill({status:503,headers:cors,contentType:'application/json',body:JSON.stringify({ok:false,error:'Синтетическая ошибка подключения'})})});
 await p.waitForFunction(()=>!document.getElementById('bosManualRefresh')?.disabled);await p.evaluate(()=>BOS_REFRESH_NOW());await p.locator('.odRefreshState:not([hidden])').waitFor();await cap(c,'error','synthetic-fixture',['failed refresh preserves loaded dashboard']);
 await c.context.setOffline(true);await p.waitForFunction(()=>!document.getElementById('bosManualRefresh')?.disabled);await p.evaluate(()=>BOS_REFRESH_NOW());await p.locator('.odRefreshState:not([hidden])').waitFor();await cap(c,'offline','synthetic-fixture',['offline preserves loaded dashboard']);await c.context.setOffline(false);
 await p.unroute(/mini-app-api(?:\?|$)/);await p.evaluate(()=>show('orders'));const search=p.locator('#bosOrderSearch');if(await search.count()){await search.fill('НЕСУЩЕСТВУЮЩАЯ-ЗАЯВКА');await cap(c,'empty','synthetic-fixture',['zero matching search']);}
}
async function auth(role,width){
 if(process.env.BOS_CAPTURE_SCREENS&&!process.env.BOS_CAPTURE_AUTH)return;
 for(const mode of ['auth-login','auth-invite','auth-expired','loading']){
  if(mode==='loading'&&role!=='owner')continue;
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',locale:'ru-RU'}),page=await context.newPage();const c={context,page,role,errors:[],blocked:[]};page.on('pageerror',e=>c.errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  let release;
  if(mode==='loading'){
   await fullStack(page,'owner');const held=new Promise(r=>release=r);await page.route(/mini-app-api(?:\?|$)/,async r=>{await held;return r.fallback();});
  }
  if(mode==='auth-invite')await page.route(/vk-session-api(?:\?|$)/,r=>r.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({ok:true,registration_required:true,session_token:'fixture.9999999999.signature'})}));
  if(mode==='auth-expired'){
   await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','expired.1.fixture'));
   await page.route(/mini-app-api(?:\?|$)/,r=>r.fulfill({status:401,headers:cors,contentType:'application/json',body:JSON.stringify({ok:false,error:'Сессия истекла'})}));
  }
  try{
   await page.goto('http://127.0.0.1:'+server.address().port+'/'+(mode==='auth-invite'?'?force_vk_auth=1&vk_app_id=54758847&vk_user_id=123456789&sign=fixture':''),{waitUntil:'domcontentloaded'});
   await page.locator(mode==='auth-invite'?'#simpleInviteForm':mode==='loading'?'#authGate h1':'#simplePassForm').waitFor({state:'visible'});await cap(c,mode,'synthetic-fixture',[mode==='auth-expired'?'401 expired session uses existing login gate':mode]);
  }catch(e){console.log('AUTH GAP '+role+' '+mode+' '+e.message);manifest.push({role,screen:mode,width,state:'capture-gap',coverageGaps:[e.message]});write();}
  finally{release?.();await context.close();}
 }
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/headless_shell'});try{for(const role of (process.env.BOS_CAPTURE_ROLES||'master,dispatcher,manager,owner').split(','))for(const width of (process.env.BOS_CAPTURE_WIDTHS||'390,1440').split(',').map(Number)){const c=await setup(role,width);await shared(c);await systems(c);await c.context.close();await auth(role,width);}}finally{await browser.close();server.close();write();}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
