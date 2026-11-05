const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {edge,database,employee}=require('./helpers/edge.cjs');

test('unknown active staff roles cannot read bootstrap or mutate orders',async()=>{
  for(const role of ['client','customer','admin','OWNER','',null]){
    const person=employee('unknown',role),order={id:'1',client:'Private client',master_staff_id:'other'};
    const db=database({business_staff:[person],orders:[order]});
    const api=edge('mini-app-api',db);
    for(const body of [{action:'bootstrap'},{action:'updateOrder',id:'1',comment:'injected'}]){
      const response=await api(body,person.external_id);
      assert.equal(response.status,403,`Unexpected access for role ${role}`);
      assert.equal(response.body.orders,undefined);
      assert.ok(!JSON.stringify(response.body).includes('Private client'));
    }
    assert.equal(db.tables.orders[0].comment,undefined);
  }
});

test('opaque client session cannot authenticate with the existing staff API',async()=>{
  const db=database({business_staff:[employee('owner','owner')],orders:[{id:'1',client:'Private client'}]});
  const api=edge('mini-app-api',db);
  const opaqueClientToken=randomBytes(32).toString('base64url');
  for(const action of ['bootstrap','createOrder','updateEmployee']){
    const response=await api({action,role:'owner',client_id:'owner'},'100',opaqueClientToken);
    assert.equal(response.status,401);
    assert.equal(response.body.orders,undefined);
  }
});

test('claims bootstrap rejects unknown staff roles and opaque client sessions',async()=>{
  const person=employee('unknown','client');
  const db=database({business_staff:[person,employee('owner','owner')],orders:[{id:'1',client:'Private client'}]});
  const api=edge('claims-api',db);
  const unknown=await api({action:'bootstrap'},person.external_id);
  assert.equal(unknown.status,403);
  assert.equal(unknown.body.orders,undefined);
  const client=await api({action:'bootstrap'},'100',randomBytes(32).toString('base64url'));
  assert.equal(client.status,401);
  assert.equal(client.body.orders,undefined);
});

test('recognized employee roles retain their bootstrap visibility',async()=>{
  for(const role of ['owner','manager','dispatcher','master']){
    const person=employee('actor',role);
    const db=database({business_staff:[person],orders:[{id:'1',master_staff_id:'actor'},{id:'2',master_staff_id:'other'}]});
    const response=await edge('mini-app-api',db)({action:'bootstrap'},person.external_id);
    assert.equal(response.status,200);
    assert.deepEqual(response.body.orders.map(row=>row.id),role==='master'?['1']:['1','2']);
  }
});
