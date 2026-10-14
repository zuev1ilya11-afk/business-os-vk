const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'master-help-data.js'),'utf8'),context);
const d=context.window.BOS_MASTER_HELP_DATA;
test('training contains all approved topics and locally available illustrations',()=>{
 assert.equal(d.lessons.length,10);assert.equal(d.talk.length,6);assert.equal(d.faq.length,12);assert.equal(d.problems.length,5);
 assert.equal(new Set(d.lessons.map(x=>x.id)).size,10);
 for(const lesson of d.lessons){assert.ok(lesson.steps.length>=3&&lesson.steps.length<=6);for(const step of lesson.steps){assert.ok(step.title&&step.text&&step.alt);assert.ok(fs.existsSync(path.join(root,step.image.split('?')[0])),step.image+' missing')}}
 assert.equal(d.lessons.find(x=>x.id==='contact').steps.flatMap(x=>x.branches||[]).length,6);
});
