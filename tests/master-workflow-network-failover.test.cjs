const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

test('master workflow writes are failover-safe and schedule replay is idempotent',()=>{
  const network=fs.readFileSync(path.join(root,'network-direct-v86.js'),'utf8');
  const safeActions=(network.match(/const SAFE_ACTIONS=new Set\(\[([^\]]+)\]\)/)||[])[1]||'';
  for(const action of ['markCalled','confirmAgreement','setAgreementSchedule','setStage']){
    assert.ok(safeActions.includes(`'${action}'`),`${action} must be eligible for route failover`);
  }

  const backend=fs.readFileSync(path.join(root,'supabase/functions/master-workflow-api/index.ts'),'utf8');
  assert.match(backend,/cur\.master_agreed_at&&currentDate===date&&currentTime===time/);
  assert.match(backend,/idempotent:true/);
});
