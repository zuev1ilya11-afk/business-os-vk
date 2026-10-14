const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createHash}=require('node:crypto');
function read(s){const c={window:{}};vm.runInNewContext(s,c);return JSON.parse(JSON.stringify(c.window.BOS_MASTER_HELP_DATA))}
const baseline=require('./fixtures/help-content-baseline.json');
const digest=x=>createHash('sha256').update(JSON.stringify(x,(k,v)=>k==='id'?undefined:v)).digest('hex');
const current=read(fs.readFileSync('master-help-data.js','utf8'));
const removed=['Как и кому оплачивать?','Можно в следующий раз вызвать вас напрямую?'];
test('remove only the two requested FAQ cards and preserve every other field',()=>{
 assert.deepEqual(Object.keys(current),baseline.keys);
 for(const key of baseline.keys){
  const expected=baseline.materials[key];
  if(Array.isArray(expected)){assert.equal(current[key].length,expected.length,key);for(const [i,x] of current[key].entries())assert.equal(digest(x),expected[i].sha256,key+': '+expected[i].name)}
  else assert.equal(digest(current[key]),expected,key);
 }
 assert.ok(!removed.some(q=>fs.readFileSync('master-help-data.js','utf8').includes(q)));
});
test('all materials and lesson steps have unique stable identifiers',()=>{
 const ids=[];for(const k of ['lessons','talk','faq','problems'])for(const x of current[k]){
  assert.match(x.id,/^[a-z][a-z0-9_-]+$/);ids.push(x.id);
  if(x.steps){const steps=x.steps.map(s=>s.id);assert.ok(steps.every(Boolean));assert.equal(new Set(steps).size,steps.length)}
 }assert.equal(new Set(ids).size,ids.length);
});
