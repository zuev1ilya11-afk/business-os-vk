const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('RU static frontend release preserves live configuration and rolls back file-only failures',()=>{
 execFileSync('python3',['tests/ru-master-home-release.test.py'],{stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
});
