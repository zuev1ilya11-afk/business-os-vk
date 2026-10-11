const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('RU report-review release guards and rollback',()=>{
 execFileSync('python3',['tests/ru-report-review-release.test.py'],{cwd:process.cwd(),stdio:'pipe'});
});
