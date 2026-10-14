const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
function read(s){const c={window:{}};vm.runInNewContext(s,c);return JSON.parse(JSON.stringify(c.window.BOS_MASTER_HELP_DATA))}
const old=read(cp.execFileSync('git',['show','cf73b2b:master-help-data.js'],{encoding:'utf8'}));
const current=read(fs.readFileSync('master-help-data.js','utf8'));
const removed=['Как и кому оплачивать?','Можно в следующий раз вызвать вас напрямую?'];
test('remove only the two requested FAQ cards and preserve every other field',()=>{
 old.faq=old.faq.filter(x=>!removed.includes(x.question));
 const strip=(k,v)=>k==='id'?undefined:v;
 assert.equal(JSON.stringify(current,strip),JSON.stringify(old,strip));
 assert.ok(!removed.some(q=>fs.readFileSync('master-help-data.js','utf8').includes(q)));
});
test('all materials and lesson steps have unique stable identifiers',()=>{
 const ids=[];for(const k of ['lessons','talk','faq','problems'])for(const x of current[k]){
  assert.match(x.id,/^[a-z][a-z0-9_-]+$/);ids.push(x.id);
  if(x.steps){const steps=x.steps.map(s=>s.id);assert.ok(steps.every(Boolean));assert.equal(new Set(steps).size,steps.length)}
 }assert.equal(new Set(ids).size,ids.length);
});
