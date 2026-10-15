const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('RU mobile header package preserves runtime and supports guarded rollback',()=>{
 execFileSync('python3',['deploy/mobile-header/test_release.py'],{cwd:process.cwd(),stdio:'pipe'});
});
