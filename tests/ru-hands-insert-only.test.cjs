const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('RU Hands insert-only deployment and recovery guards',()=>{
 execFileSync('python3',['tests/ru-hands-insert-only.test.py'],{stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
});
