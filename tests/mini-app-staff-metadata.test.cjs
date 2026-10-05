const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

function setup(role){
  return database({business_staff:[employee('owner','owner',{has_password:true}),employee('actor',role,{has_password:true}),employee('target','master',{has_password:true})]});
}
function publicOnly(staff){
  assert.equal(Object.hasOwn(staff,'login'),false);
  assert.equal(Object.hasOwn(staff,'has_password'),false);
  assert.equal(Object.hasOwn(staff,'password_hash'),false);
  assert.ok(staff.id);assert.ok(staff.full_name);assert.ok(staff.role);
}
for(const role of ['manager','dispatcher','master'])test(`mini-app ${role} bootstrap omits staff credential metadata in every projection`,async()=>{
  const db=setup(role),r=await edge('mini-app-api',db)({action:'bootstrap'},'staff_actor');
  assert.equal(r.status,200);
  for(const staff of [r.body.user,...r.body.users,...r.body.masters])publicOnly(staff);
  assert.equal(db.tables.business_staff[0].login,'owner');
  assert.equal(db.tables.business_staff[0].has_password,true);
});
for(const role of ['manager','dispatcher'])test(`mini-app ${role} staff update response omits credential metadata`,async()=>{
  const db=setup(role),r=await edge('mini-app-api',db)({action:'updateEmployee',id:'target',city:'Казань'},'staff_actor');
  assert.equal(r.status,200);publicOnly(r.body.user);
  assert.equal(db.tables.business_staff.find(x=>x.id==='target').city,'Казань');
  assert.equal(db.tables.business_staff.find(x=>x.id==='target').login,'target');
});
test('mini-app owner retains existing login metadata without password material',async()=>{
  const db=setup('manager'),api=edge('mini-app-api',db);
  for(const body of [{action:'bootstrap'},{action:'updateEmployee',id:'target',city:'Казань'}]){
    const r=await api(body);assert.equal(r.status,200);
    for(const staff of [r.body.user,...(r.body.users||[]),...(r.body.masters||[])]){
      assert.ok(staff.login);assert.equal(staff.has_password,true);assert.equal(Object.hasOwn(staff,'password_hash'),false);
    }
  }
});
