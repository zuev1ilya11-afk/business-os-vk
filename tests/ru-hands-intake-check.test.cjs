const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('Hands read-only intake diagnosis fails closed and keeps recovery candidates private',()=>{
  execFileSync('python3',['tests/ru-hands-intake-check.test.py'],{stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
});
