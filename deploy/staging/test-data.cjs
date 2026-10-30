const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {checkTarget,rehearse}=require('./rehearse-data.cjs');
test('cold fixture restore reopens SQL and files without overwriting later original data',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bos-data-test-'));
 try{
  const target=path.join(dir,'bos-staging-data');checkTarget(target);assert.equal(fs.existsSync(target),false);
  const result=await rehearse(target);assert.equal(result.rows,9);assert.equal(result.sql_records_equal,true);
  assert.equal(result.synthetic_files_and_config_equal,true);assert.equal(result.original_post_backup_change_preserved,true);
  assert.equal(result.real_postgres_auth_storage_restore,false);assert.throws(()=>checkTarget(target));
  assert.throws(()=>checkTarget('/opt/bos-staging-data'));assert.throws(()=>checkTarget('/tmp/production'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
