const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {edge,database,employee}=require('./helpers/edge.cjs');

test('password login is rate limited without revealing whether the account exists',async()=>{
  const db=database({business_staff:[employee('m')]});
  const api=edge('password-session-api',db);
  for(let i=0;i<8;i++)assert.equal((await api({action:'login',login:'m',password:'wrong'})).status,401);
  const blocked=await api({action:'login',login:'m',password:'wrong'});
  assert.equal(blocked.status,429);
  assert.match(blocked.body.error,/Слишком много попыток/);
  assert.ok(Number(blocked.headers.get('retry-after'))>0);
});

test('new desktop passwords require at least ten characters',async()=>{
  const db=database({business_staff:[employee('owner','owner'),employee('m')]});
  const staff=edge('staff-admin-api',db);
  assert.equal((await staff({action:'setCredentials',id:'m',login:'master-login',password:'123456789'})).status,400);
  assert.equal((await staff({action:'setCredentials',id:'m',login:'master-login',password:'1234567890'})).status,200);

  const self=edge('password-session-api',db);
  assert.equal((await self({action:'setCredentials',login:'master-login',password:'123456789'},'staff_m')).status,400);
});

test('only owner can reset another employee credentials',async()=>{
  const db=database({business_staff:[employee('owner','owner'),employee('mgr','manager'),employee('m')]});
  const staff=edge('staff-admin-api',db);
  const denied=await staff({action:'setCredentials',id:'m',login:'changed-login',password:'strong-pass-123'},'staff_mgr');
  assert.equal(denied.status,403);
  assert.equal(db.tables.business_staff.find(x=>x.id==='m').login,'m');
  const ui=fs.readFileSync('employee-form-v16.js','utf8');
  assert.match(ui,/function canAdminStaff\(\)\{return String\(state\.user\?\.role\|\|''\)==='owner'\}/);
});

test('integration administration requires a BOS session and ignores VK launch headers',async()=>{
  const db=database({business_staff:[employee('owner','owner')],api_integrations:[]});
  const api=edge('integration-api',db);
  const launchOnly=await api({action:'listIntegrations'},'100','',{'X-VK-Launch-Params':'vk_app_id=54758847&vk_user_id=100&vk_ts=1&sign=fake'});
  assert.equal(launchOnly.status,403);
  const owner=await api({action:'listIntegrations'});
  assert.equal(owner.status,200);
  const source=fs.readFileSync('supabase/functions/integration-api/index.ts','utf8');
  assert.doesNotMatch(source,/x-vk-launch-params/i);
});

test('BOS browser sessions are not persisted into localStorage',()=>{
  for(const file of ['mandatory-auth-v29.js','auth-api-session-v41.js']){
    const source=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/localStorage\.setItem\s*\([^)]*SESSION_KEY[^)]*,/);
    assert.doesNotMatch(source,/localStorage\.setItem\s*\([^)]*KEY[^)]*,/);
    assert.match(source,/localStorage\.removeItem/);
  }
});