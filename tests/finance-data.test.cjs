const {test}=require('node:test');
const assert=require('node:assert/strict');
let F;try{F=require('../finance-data.js')}catch{}
const order=(patch={})=>({id:'1',status:'Выполнена',completed_at:'2026-10-04T09:00:00Z',source:'Авито',amount:1000,master_payout:500,extra_work_amount:100,master_staff_id:'m',master_name:'Иван',city:'СПб',...patch});
test('financial page has a read model',()=>assert.ok(F,'financial read model is missing'));
test('stored payouts including zero are never recalculated; extras counted once',()=>{
 const input=[order(),order({id:'2',master_payout:0}),order({id:'3',status:'Отменена'})],copy=structuredClone(input);
 const a=F.aggregate(F.records(input,[]));
 assert.deepEqual([a.total,a.completed,a.cancelled,a.revenue,a.extras,a.pay,a.company,a.average],[3,2,1,2200,200,700,1500,1100]);
 assert.deepEqual(input,copy);
});
test('Hands uses stored pay and missing Hands company share is not fabricated',()=>{
 const rows=F.records([order({source:'Hands',master_payout:400})],[]),a=F.aggregate(rows);
 assert.equal(a.pay,500);assert.equal(a.company,null);assert.equal(a.missing.company,1);
});
test('missing historical payout stays unknown and canceled approved orders are excluded',()=>{
 const a=F.aggregate(F.records([order({master_payout:null}),order({id:'2',status:'Отменена',report_review_status:'approved'})],[]));
 assert.equal(a.completed,1);assert.equal(a.pay,null);assert.equal(a.company,null);
});
test('calendar bounds use Moscow, handle leap year, quarter, custom and previous periods',()=>{
 assert.deepEqual(F.period('today','2026-10-04T21:30:00Z'),{start:'2026-10-05',end:'2026-10-05'});
 assert.deepEqual(F.period('week','2026-10-04T09:00:00Z'),{start:'2026-09-28',end:'2026-10-04'});
 assert.deepEqual(F.previous(F.period('month','2024-03-12'),'month'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(F.period('quarter','2026-10-04'),{start:'2026-10-01',end:'2026-12-31'});
 assert.deepEqual(F.previous(F.period('year','2026-10-04'),'year'),{start:'2025-01-01',end:'2025-12-31'});
 assert.throws(()=>F.period('custom',undefined,'2026-02-30','2026-03-01'));
 assert.throws(()=>F.period('custom',undefined,'2026-10-05','2026-10-01'));
});
test('master identity uses staff IDs and preserves inactive or unassigned groups',()=>{
 const rows=F.records([order(),order({id:'2',master_staff_id:'other'}),order({id:'3',master_staff_id:null,master_name:''})],[{id:'m',full_name:'Иван'},{id:'other',full_name:'Иван'}]);
 assert.equal(F.groups(rows,'master').length,3);
 assert.equal(F.select(rows,{master:'m'}).length,1);
 assert.equal(F.select(rows,{source:'Авито',city:'СПб',master:'other'}).length,1);
});
test('work names match catalog exactly and multi-work money is not double counted',()=>{
 const rows=F.records([order({work:'Подрезка карниза по длине × 2 пил.'}),order({id:'2',work:'Замер помещения. Выезд на объект, составление обмерного плана.\nПодрезка карниза по длине'}),order({id:'3',work:'неясно',comment:'Установка декоративного карниза длиной до 2,5 метров'})],[]);
 assert.equal(F.select(rows,{work:'standard_020'}).length,2);
 assert.equal(F.select(rows,{work:'standard_005'}).length,0);
 const works=F.workGroups(rows);assert.equal(works.find(x=>x.key==='standard_020').quantity,3);
 assert.equal(works.find(x=>x.key==='standard_020').revenue,null);
});
test('all time retains missing dates and period grouping sums to the same total',()=>{
 const rows=F.records([order(),order({id:'2',completed_at:'2025-01-01T09:00:00Z'}),order({id:'3',completed_at:null})],[]);
 assert.equal(F.select(rows,{period:F.period('all')}).length,3);
 assert.equal(F.select(rows,{period:F.period('year','2026-10-04')}).length,1);
 assert.equal(F.periodGroups(rows,'year').reduce((n,g)=>n+g.revenue,0),3300);
});
test('work execution excludes stored deductions and does not assign unstructured extras to a catalog item',()=>{
 const rows=F.records([order({work:'Подрезка карниза по длине × 3 пил.',uncompleted_work_amount:200,uncompleted_work_items:[{service_id:'standard_020',quantity:1}]})],[]);
 const g=F.workGroups(rows)[0];assert.equal(g.quantity,2);assert.equal(g.revenue,1000);assert.equal(g.extras,null);
});
test('period comparison uses the previous calendar bucket, never the previous nonempty year',()=>{
 const rows=F.records([order({completed_at:'2026-10-04T08:00:00Z'}),order({id:'2',completed_at:'2026-09-01T08:00:00Z',amount:500,extra_work_amount:0}),order({id:'3',completed_at:'2024-09-01T08:00:00Z'})],[]);
 const groups=F.periodGroups(rows,'month');assert.equal(groups.find(g=>g.key==='2026-10').delta,120);assert.equal(groups.find(g=>g.key==='2026-09').delta,null);
});
