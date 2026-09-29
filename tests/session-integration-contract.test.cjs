const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

for(const role of ['owner','manager','dispatcher','master'])test(`real ${role} login and refresh retain integration authorization`,async()=>{
 const me=employee(role,role),db=database({business_staff:[me],api_integrations:[]});
 const password=edge('password-session-api',db),integrations=edge('integration-api',db);
 const login=await password({action:'login',login:role,password:'audit-password'});
 assert.equal(login.status,200);
 const refresh=await password({action:'refresh'},me.external_id,login.body.session_token);
 assert.equal(refresh.status,200);
 for(const session of [login.body.session_token,refresh.body.session_token]){
  const result=await integrations({action:'listIntegrations'},me.external_id,session);
  assert.equal(result.status,role==='owner'?200:403);
  if(role==='owner'){
   assert.deepEqual(result.body.integrations,[]);
   const forged=await integrations({action:'listIntegrations'},me.external_id,session+'x');
   assert.equal(forged.status,403);
  }
 }
 db.tables.business_staff[0].is_active=false;
 assert.equal((await integrations({action:'listIntegrations'},me.external_id,login.body.session_token)).status,403);
});
