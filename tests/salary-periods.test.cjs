const {test}=require('node:test');
const assert=require('node:assert/strict');
const periods=require('../salary-periods.js');

test('salary weeks run Monday through Sunday across year and month boundaries',()=>{
 assert.deepEqual(periods.bounds('week','2026-01-01'),{start:'2025-12-29',end:'2026-01-04'});
 assert.deepEqual(periods.bounds('week','2026-10-04'),{start:'2026-09-28',end:'2026-10-04'});
 assert.deepEqual(periods.bounds('week','2026-10-05'),{start:'2026-10-05',end:'2026-10-11'});
 assert.equal(periods.shift('week','2026-01-01',-1),'2025-12-22');
});
test('month navigation handles leap years and December without overflowing days',()=>{
 assert.deepEqual(periods.bounds('month','2024-02-29'),{start:'2024-02-01',end:'2024-02-29'});
 assert.equal(periods.shift('month','2026-03-31',-1),'2026-02-01');
 assert.equal(periods.shift('month','2026-12-31',1),'2027-01-01');
 assert.equal(periods.valid('2026-02-29'),false);
});
test('completion belongs to the Moscow calendar day, with approved and scheduled fallbacks',()=>{
 assert.equal(periods.completedDay({completed_at:'2026-10-04T20:59:59Z'}),'2026-10-04');
 assert.equal(periods.completedDay({completed_at:'2026-10-04T21:00:00Z'}),'2026-10-05');
 assert.equal(periods.completedDay({completed_at:'bad',report_reviewed_at:'2026-09-30T21:01:00Z'}),'2026-10-01');
 assert.equal(periods.completedDay({scheduled_date:'2026-09-30'}),'2026-09-30');
 assert.equal(periods.completedDay({scheduled_date:'bad'}),'');
 assert.equal(periods.nextMidnight(Date.parse('2026-10-04T20:59:59Z')),Date.parse('2026-10-04T21:00:00Z'));
});
test('period filtering includes both boundary dates and excludes missing dates',()=>{
 const p=periods.bounds('week','2026-09-30');
 assert.equal(periods.contains(p,'2026-09-28'),true);
 assert.equal(periods.contains(p,'2026-10-04'),true);
 for(const date of ['2026-09-27','2026-10-05',''])assert.equal(periods.contains(p,date),false);
});
