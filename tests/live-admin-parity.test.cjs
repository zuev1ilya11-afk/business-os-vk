const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,createHmac}=require('node:crypto');
const {edge,database,employee,token,secret}=require('./helpers/edge.cjs');
const seed=()=>database({business_staff:[employee('owner','owner'),employee('boss','manager'),employee('d','dispatcher'),employee('m')],api_integrations:[]});
const noWrites=db=>assert.equal(db.calls.filter(x=>x.rpc||x.mode!=='select').length,0);

test('integration administration accepts active owner sessions and rejects every other role',async()=>{
 const db=seed(),api=edge('integration-api',db);
 assert.equal((await api({action:'listIntegrations'})).status,200);
 for(const uid of ['staff_boss','staff_d','staff_m','unknown']){
  for(const action of ['listIntegrations','createIntegration','disableIntegration','enableIntegration','rotateKey','saveMapping','testMapping']){
   assert.equal((await api({action,id:'1',name:'test'},uid)).status,403,`${uid}: ${action}`);
  }
 }
 db.tables.business_staff[0].is_active=false;
 assert.equal((await api({action:'listIntegrations'})).status,403);
 noWrites(db);
});

test('integration sessions reject invalid expiry, long lifetime, bad subject and forged signatures before DB access',async()=>{
 const db=seed(),api=edge('integration-api',db),now=Math.floor(Date.now()/1000);
 const invalid=['',token('100',now),token('100',now-1),token('100',now+43260),token('100','NaN'),token('100','Infinity'),token('100','9999999999999'),token('bad!id'),token('x'.repeat(129)),token('100')+'x',token('100')+'.extra'];
 for(const session of invalid)assert.equal((await api({action:'listIntegrations'},'100',session)).status,403);
 assert.equal(db.calls.length,0);
 assert.equal((await edge('integration-api',db,{env:{VK_APP_SECRET:''}})({action:'listIntegrations'})).status,403);
 assert.equal(db.calls.length,0);
 assert.equal((await api({action:'listIntegrations'},'100',token('100',now+43190))).status,200);
});

test('a correctly signed VK launch string cannot substitute for an integration owner session',async()=>{
 const db=seed(),api=edge('integration-api',db);
 const params=new URLSearchParams({vk_app_id:'54758847',vk_user_id:'100'});
 params.set('sign',createHmac('sha256',secret).update(params.toString()).digest('base64url'));
 assert.equal((await api({action:'listIntegrations'},'100','',{'x-vk-launch-params':params.toString()})).status,403);
 assert.equal(db.calls.length,0);
});

test('external integration API keys retain scoped reads and never grant owner administration',async()=>{
 const db=seed(),key='fixture-integration-key';
 db.tables.api_integrations.push({id:'1',slug:'partner',is_active:true,api_key_hash:createHash('sha256').update(key).digest('hex')});
 db.tables.orders.push({id:'1',integration_slug:'partner'},{id:'2',integration_slug:'other'});
 const api=edge('integration-api',db);
 for(const headers of [{'x-api-key':key},{authorization:`Bearer ${key}`}]){
  const r=await api({action:'listOrders'},'100','',headers);
  assert.equal(r.status,200);assert.deepEqual(r.body.orders.map(x=>x.id),['1']);
  assert.equal((await api({action:'listIntegrations'},'100','',headers)).status,403);
 }
 assert.equal((await api({action:'listOrders'},'100','',{'x-api-key':'wrong'})).status,401);
 db.tables.api_integrations[0].is_active=false;
 assert.equal((await api({action:'listOrders'},'100','',{'x-api-key':key})).status,401);
});

function credentials(user,visible){
 assert.equal(user.login,visible?'m':'');assert.equal(user.has_password,visible);
 assert.equal(Object.hasOwn(user,'password_hash'),false);
 assert.ok(!JSON.stringify(user).includes('audit-password'));
}
test('staff list exposes login and password presence only to the owner',async()=>{
 const api=edge('staff-admin-api',seed());
 for(const [uid,visible] of [['100',true],['staff_boss',false]]){
  const r=await api({action:'listStaff'},uid);assert.equal(r.status,200);
  credentials(r.body.staff.find(x=>x.id==='m'),visible);
  assert.ok(!r.body.staff.some(x=>x.role==='owner'));
  if(!visible)assert.ok(r.body.staff.every(x=>['master','dispatcher'].includes(x.role)));
 }
});

test('both staff restore branches preserve owner-only credential visibility',async()=>{
 for(const active of [false,true])for(const [uid,visible] of [['100',true],['staff_boss',false]]){
  const db=seed();db.tables.business_staff.find(x=>x.id==='m').is_active=active;
  const r=await edge('staff-admin-api',db)({action:'restoreEmployee',id:'m'},uid);
  assert.equal(r.status,200);assert.equal(r.body.user.is_active,true);credentials(r.body.user,visible);
  assert.equal(Boolean(r.body.already_active),active);
 }
});

test('manager cannot change credentials even for otherwise manageable employees',async()=>{
 const db=seed(),api=edge('staff-admin-api',db);
 for(const id of ['d','m'])assert.equal((await api({action:'setCredentials',id,login:'new-login',password:'long-test-password'},'staff_boss')).status,403);
 noWrites(db);
});

test('owner credential changes enforce existing live length limits and never serialize password hashes',async()=>{
 const db=seed(),api=edge('staff-admin-api',db);
 for(const [login,password] of [['ab','1234567890'],['x'.repeat(65),'1234567890'],['new','123456789'],['new','x'.repeat(129)]]){
  assert.equal((await api({action:'setCredentials',id:'m',login,password})).status,400);
 }
 noWrites(db);
 for(const [login,password] of [['new','1234567890'],['x'.repeat(64),'x'.repeat(128)]]){
  const r=await api({action:'setCredentials',id:'m',login,password});
  assert.equal(r.status,200);assert.equal(r.body.user.login,login);assert.equal(r.body.user.has_password,true);
  assert.equal(Object.hasOwn(r.body.user,'password_hash'),false);assert.ok(!JSON.stringify(r.body).includes(password));
 }
 assert.equal(db.calls.filter(x=>x.rpc==='bos_set_staff_credentials').length,2);
});

for(const slug of ['integration-api','staff-admin-api'])test(`${slug} masks database failure details in responses and logs`,async()=>{
 const db=seed(),logs=[];
 db.beforeQuery=()=>{throw new Error('private-database-detail-fixture')};
 const api=edge(slug,db,{console:{error:(...args)=>logs.push(args)}});
 const r=await api({action:slug==='integration-api'?'listIntegrations':'listStaff'});
 assert.equal(r.status,500);assert.equal(r.body.error,'Временная ошибка сервиса. Повторите позже.');
 assert.equal(logs.length,1);assert.ok(!JSON.stringify([r,logs]).includes('private-database-detail-fixture'));
});
