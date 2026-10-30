const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(command,args){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
 assert.equal(result.status,0,(result.error?.message||'')+'\n'+result.stdout+'\n'+result.stderr);
 return result.stdout+'\n'+result.stderr;
}
test('staging structure guards and existing frontend release rehearsal',()=>run('python3',['-m','unittest','discover','-s','deploy/staging','-p','test_*.py']));
test('staging partial SQL fixture cold-backup and separate restore',()=>assert.match(run(process.execPath,['--test','--test-reporter=tap','deploy/staging/test-data.cjs']),/# tests 1\b/));
