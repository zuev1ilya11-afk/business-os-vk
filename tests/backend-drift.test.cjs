const {test}=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');const {check}=require('../scripts/check-backend-drift.cjs');
const baseline=[{name:'api',version:2,verify_jwt:false,status:'ACTIVE',files:[{name:'index.ts',source_sha256:createHash('sha256').update('code').digest('hex')}]}];
const live=()=>[{slug:'api',version:2,verify_jwt:false,status:'ACTIVE',files:[{name:'index.ts',content:'code'}]}];
test('drift gate accepts exact snapshot and rejects omitted, changed and unexpected deployment data',()=>{
 assert.deepEqual(check(live(),baseline),[]);
 for(const change of [x=>x[0].version++,x=>x[0].verify_jwt=true,x=>x[0].files[0].content='different',x=>x[0].files=[],x=>x.push({...x[0],slug:'extra'})]){const x=live();change(x);assert.ok(check(x,baseline).length)}
 assert.throws(()=>check([],baseline));assert.ok(check(live(),[...baseline,{...baseline[0],name:'missing'}]).some(x=>x.includes('missing')));
});
test('drift gate rejects rollback of either captured administration handler in the repository',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bos-admin-parity-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['integration-api','staff-admin-api']){
  const repository_path=`supabase/functions/${name}/index.ts`,local=path.join(root,repository_path);
  const expected=[{...baseline[0],name,files:[{...baseline[0].files[0],repository_path}]}];
  const observed=[{...live()[0],slug:name}];
  fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,'code');
  assert.deepEqual(check(observed,expected,root),[]);
  fs.writeFileSync(local,'old repository implementation');
  assert.deepEqual(check(observed,expected,root),[`${name}: critical repository/production mismatch`]);
  fs.unlinkSync(local);
  assert.deepEqual(check(observed,expected,root),[`${name}: critical repository/production mismatch`]);
 }
});
