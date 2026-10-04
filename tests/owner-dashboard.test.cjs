const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function core(){
 const ctx={module:{exports:{}},pages:{home:()=>''},document:{createElement:()=>({}),head:{appendChild(){}}}};
 vm.runInNewContext(fs.readFileSync('owner-dashboard-v9.js','utf8'),ctx);
 return ctx.module.exports;
}
for(const [now,expected] of [
 ['2026-10-04T09:00:00Z',['2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']],
 ['2026-10-30T09:00:00Z',['2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05']],
 ['2026-12-30T09:00:00Z',['2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05']],
 ['2026-10-03T21:01:00Z',['2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']]
])test('rolling seven business days from '+now,()=>{
 const api=core();assert.equal(typeof api.days,'function','dashboard exposes its rolling date range');
 const result=api.days(new Date(now));
 assert.deepEqual(Array.from(result,x=>x.date),expected);
 assert.equal(result[0].label,'Сегодня');
 assert.notEqual(result[1].label,'Сегодня');
});
