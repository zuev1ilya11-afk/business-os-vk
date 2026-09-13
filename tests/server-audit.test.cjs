const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,token}=require('./helpers/edge.cjs');

test('bootstrap and employee writes never serialize password hashes',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('m')]});const api=edge('mini-app-api',db);
 for(const b of [{action:'bootstrap'},{action:'updateEmployee',id:'m',phone:'+79990000002'}]){
  const r=await api(b);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.body).includes('password_hash'));assert.ok(!JSON.stringify(r.body).includes('audit-password'));
 }
});
test('password login accepts internal staff IDs and rejects inactive/wrong credentials',async()=>{
 const db=database({business_staff:[employee('m')]});const api=edge('password-session-api',db);
 const r=await api({action:'login',login:'m',password:'audit-password'});assert.equal(r.status,200);assert.ok(r.body.session_token.startsWith('staff_m.'));
 assert.equal((await api({action:'login',login:'m',password:'wrong'})).status,401);
 db.tables.business_staff[0].is_active=false;
 assert.equal((await api({action:'login',login:'m',password:'audit-password'})).status,401);
});
test('disabled old session fails; restore re-enables password login',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('m','master',{is_active:false})]});
 assert.equal((await edge('mini-app-api',db)({action:'bootstrap'},'staff_m')).status,401);
 assert.equal((await edge('staff-admin-api',db)({action:'restoreEmployee',id:'m'})).status,200);
 assert.equal((await edge('password-session-api',db)({action:'login',login:'m',password:'audit-password'})).status,200);
});
test('manager cannot restore or set credentials for owner or manager; master cannot administer staff',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('boss','manager'),employee('other','manager'),employee('m')]});const api=edge('staff-admin-api',db);
 for(const id of ['owner','other'])for(const action of ['restoreEmployee','setCredentials'])assert.equal((await api({action,id,login:'new',password:'new-password'},'staff_boss')).status,403);
 assert.equal((await api({action:'listStaff'},'staff_m')).status,403);
});
test('expired, malformed and tampered sessions are rejected',async()=>{
 const api=edge('mini-app-api',database({business_staff:[employee('owner','owner')]}));
 for(const t of [token('100',1),token('100','NaN'),token('100','Infinity'),token('100')+'x'])assert.equal((await api({action:'bootstrap'},'100',t)).status,401);
});
test('master bootstrap and direct API cannot access others orders or escalate roles',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('m')],orders:[{id:'1',master_staff_id:'m'},{id:'2',master_staff_id:'other'}]});const api=edge('mini-app-api',db);
 const r=await api({action:'bootstrap'},'staff_m');assert.deepEqual(r.body.orders.map(x=>x.id),['1']);
 for(const b of [{action:'updateOrder',id:'2',status:'Выполнена'},{action:'updateEmployee',id:'m',role:'owner'},{action:'createOrder',client:'x',address:'x',work:'x'}])assert.equal((await api(b,'staff_m')).status,403);
});
test('report finalization uses 35 percent master payout',async()=>{
 const db=database({business_staff:[employee('m')],orders:[{id:'1',master_staff_id:'m',original_amount:1000}]});
 const r=await edge('report-api',db)({action:'finalizeMasterReport',order_id:'1',upload_token:'audit',act_url:'https://example.test/act',photo_urls:['https://example.test/photo']},'staff_m');
 assert.equal(r.status,200);assert.equal(r.body.order.master_payout,297.5);assert.equal(r.body.order.manager_payout,159.8);assert.equal(r.body.order.dispatcher_payout,119.85);
});
test('editing comment preserves manually adjusted payouts',async()=>{
 const db=database({business_staff:[employee('owner','owner')],orders:[{id:'1',amount:1000,original_amount:1000,master_staff_id:'m',master_payout:123,manager_payout:45,dispatcher_payout:67}]});
 const r=await edge('mini-app-api',db)({action:'updateOrder',id:'1',comment:'changed'});assert.equal(r.status,200);assert.equal(r.body.order.master_payout,123);assert.equal(r.body.order.manager_payout,45);
});
test('negative and non-finite money rejected before writes',async()=>{
 for(const amount of [-1,'NaN','Infinity']){
 const db=database({business_staff:[employee('owner','owner')]});const r=await edge('mini-app-api',db)({action:'createOrder',client:'x',address:'x',work:'x',amount});assert.equal(r.status,400);assert.equal(db.tables.orders.length,0);
 }
});
test('concurrent retry returns same order and creates only one row',async()=>{
 const db=database({business_staff:[employee('owner','owner')]});const api=edge('mini-app-api',db);const b={action:'createOrder',client:'x',address:'x',work:'x',amount:1000,request_id:'request-audit-123'};
 const rs=await Promise.all([api(b),api(b)]);assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(db.tables.orders.length,1);assert.equal(rs[0].body.order.id,rs[1].body.order.id);
});
test('report rejects excessive deduction and negative extras',async()=>{
 for(const values of [{uncompleted_work_amount:1001},{extra_work_amount:-1}]){
 const db=database({business_staff:[employee('m')],orders:[{id:'1',master_staff_id:'m',original_amount:1000}]});
 const r=await edge('report-api',db)({action:'finalizeMasterReport',order_id:'1',upload_token:'audit',act_url:'https://example.test/act',photo_urls:['https://example.test/photo'],...values},'staff_m');assert.equal(r.status,400);assert.equal(db.tables.orders[0].status,undefined);
 }
});
test('empty optional order values are typed for Postgres',async()=>{
 const db=database({business_staff:[employee('owner','owner')]});const r=await edge('mini-app-api',db)({action:'createOrder',client:'x',address:'x',work:'x',scheduled_date:'',scheduled_time:''});assert.equal(r.status,200);assert.equal(r.body.order.scheduled_date,null);assert.equal(r.body.order.scheduled_time,null);assert.equal(r.body.order.extra_work_done,false);assert.equal(r.body.order.extra_work_amount,0);
});
test('duplicate staff login returns actionable conflict',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('m'),employee('other','master',{login:'taken'})]});const r=await edge('staff-admin-api',db)({action:'setCredentials',id:'m',login:'taken',password:'new-password'});assert.equal(r.status,409);assert.match(r.body.error,/занят/);
});
test('claims creation/list/close enforce master ownership',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('m'),employee('other')],orders:[{id:'1',status:'Выполнена',master_staff_id:'m',report_uploaded_at:'2026-09-12'}]});const api=edge('claims-api',db);
 assert.equal((await api({action:'reopenClaim',id:'1',reason:'Повторный монтаж'},'staff_other')).status,403);
 assert.equal((await api({action:'reopenClaim',id:'1',reason:'Повторный монтаж'})).status,200);
 assert.equal((await api({action:'bootstrap'},'staff_other')).body.claims.length,0);
 assert.equal((await api({action:'closeClaim',id:'1'},'staff_other')).status,403);
 assert.equal((await api({action:'closeClaim',id:'1'},'staff_m')).status,200);assert.equal(db.tables.order_claims[0].status,'closed');
});
test('master profile saves district/phone but cannot modify someone else',async()=>{
 const db=database({business_staff:[employee('m'),employee('other','master',{phone:'+79990000002'})]});const api=edge('profile-self-api',db);
 const r=await api({phone:'+79990000003',district:'Центральный',acting_master_vk_id:'staff_other',role:'owner'},'staff_m');assert.equal(r.status,200);assert.equal(db.tables.business_staff[0].district,'Центральный');assert.equal(db.tables.business_staff[0].role,'master');assert.equal(db.tables.business_staff[1].district,undefined);assert.ok(!JSON.stringify(r.body).includes('password_hash'));
});
test('memo text persists and role permissions are server enforced',async()=>{
 const db=database({business_staff:[employee('boss','manager'),employee('m')]});const api=edge('master-memo-api',db);
 const payload={action:'upload',category:'tips',title:'Инструкция',note:'Текст после обновления'};
 assert.equal((await api(payload,'staff_m')).status,403);assert.equal((await api(payload,'staff_boss')).status,200);
 const r=await api({action:'list'},'staff_m');assert.equal(r.body.items[0].note,payload.note);
 assert.equal((await api({action:'delete',id:r.body.items[0].id},'staff_m')).status,403);
});
test('integration and Apps Script payroll agree with master 35 percent rule',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/integration-api/index.ts','utf8').replace(/^import .*?;\s*/,''),{mode:'transform'});
 assert.equal(vm.runInNewContext(source+';payouts(1000,true).master_payout',{Deno:{serve:()=>{}}}),297.5);
 assert.equal(vm.runInNewContext(fs.readFileSync('google-apps-script/Code.gs','utf8')+';masterPayout_(1000)'),297.5);
});
test('bootstrap includes orders beyond the default PostgREST page limit',async()=>{
 const db=database({business_staff:[employee('owner','owner')],orders:Array.from({length:1205},(_,i)=>({id:String(i+1)}))});const r=await edge('mini-app-api',db)({action:'bootstrap'});assert.equal(r.body.orders.length,1205);
});
