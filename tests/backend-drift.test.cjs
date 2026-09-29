const {test}=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');const {check}=require('../scripts/check-backend-drift.cjs');
const baseline=[{name:'api',version:2,verify_jwt:false,status:'ACTIVE',files:[{name:'index.ts',source_sha256:createHash('sha256').update('code').digest('hex')}]}];
const live=()=>[{slug:'api',version:2,verify_jwt:false,status:'ACTIVE',files:[{name:'index.ts',content:'code'}]}];
test('drift gate accepts exact snapshot and rejects omitted, changed and unexpected deployment data',()=>{
 assert.deepEqual(check(live(),baseline),[]);
 for(const change of [x=>x[0].version++,x=>x[0].verify_jwt=true,x=>x[0].files[0].content='different',x=>x[0].files=[],x=>x.push({...x[0],slug:'extra'})]){const x=live();change(x);assert.ok(check(x,baseline).length)}
 assert.throws(()=>check([],baseline));assert.ok(check(live(),[...baseline,{...baseline[0],name:'missing'}]).some(x=>x.includes('missing')));
});
