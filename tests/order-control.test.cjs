const {test}=require('node:test');
const assert=require('node:assert/strict');
const {collect,businessDay,dateOnly}=require('../order-control.js');
const now=new Date('2026-09-30T22:30:00Z');
const order=patch=>({id:'1',status:'В работе',scheduled_date:'2026-10-01',scheduled_time:'10:00',master_staff_id:'m1',master_name:'Мастер',master_workflow_stage:'assigned',master_agreed_at:'2026-09-30T14:00:00Z',report_review_status:'not_submitted',...patch});
const codes=o=>collect([o],now).flatMap(x=>x.issues.map(y=>y.code));

test('business date uses Moscow rather than UTC or device timezone',()=>{
 assert.equal(businessDay(now),'2026-10-01');
 assert.equal(businessDay(new Date('2026-09-30T20:59:59Z')),'2026-09-30');
});
test('calendar validation rejects impossible dates',()=>{
 assert.equal(dateOnly('2026-02-29'),'');assert.equal(dateOnly('2028-02-29'),'2028-02-29');
 assert.equal(dateOnly('not a date'),'');assert.equal(dateOnly(null),'');
});
test('ready upcoming order is not a problem',()=>assert.deepEqual(codes(order({})),[]));
test('closed and cancelled historical orders never produce tasks',()=>{
 assert.deepEqual(collect([order({status:'Выполнена',scheduled_date:null,master_staff_id:null,master_name:null,report_review_status:'rejected'}),order({id:'2',status:'Отменена',reschedule_requested:true})],now),[]);
});
test('multiple reasons are grouped under one unique order',()=>{
 const o=order({master_staff_id:null,master_name:null,scheduled_date:null});
 const result=collect([o,o],now);
 assert.equal(result.length,1);assert.deepEqual(result[0].issues.map(x=>x.code).sort(),['unassigned','undated']);
});
test('nearest unassigned orders come before remote work',()=>{
 const future=order({id:'2',scheduled_date:'2026-12-01',master_staff_id:null,master_name:null});
 const near=order({master_staff_id:null,master_name:null});
 assert.deepEqual(collect([future,near],now).map(x=>x.id),['1','2']);
 assert.equal(collect([near],now)[0].priority,0);
});
test('late visit is a request to check rather than proof of missing work',()=>{
 const item=collect([order({scheduled_date:'2026-09-30',master_agreed_at:null})],now)[0];
 assert.deepEqual(item.issues.map(x=>x.code),['overdue']);
 assert.equal(item.issues[0].role,'dispatcher');
 assert.match(item.issues[0].next,/Уточнить результат/);
});
test('call and agreement are different facts; only nearby visits require a check',()=>{
 const item=order({master_agreed_at:null});
 assert.match(collect([item],now)[0].issues[0].title,/Звонок/);
 assert.match(collect([{...item,master_called_at:'2026-09-30T12:00Z'}],now)[0].issues[0].title,/Договорённость/);
 assert.deepEqual(codes({...item,scheduled_date:'2026-10-03'}),[]);
});
test('workflow already in progress suppresses stale agreement warnings',()=>{
 for(const stage of ['departed','arrived','started'])assert.deepEqual(codes(order({master_agreed_at:null,master_workflow_stage:stage})),[]);
});
test('pending report belongs to reviewer, not overdue master queue',()=>{
 const item=order({scheduled_date:'2026-09-29',master_agreed_at:null,report_uploaded_at:'2026-09-30T18:00Z',report_review_status:'pending'});
 assert.deepEqual(codes(item),['report_review']);
 assert.equal(collect([item],now)[0].issues[0].role,'dispatcher');
 assert.deepEqual(codes({...item,report_review_status:null}),['report_review']);
});
test('pending without upload does not invent a submitted report',()=>{
 assert.ok(!codes(order({report_review_status:'pending'})).includes('report_review'));
});
test('rejected report replaces obsolete visit tasks and preserves literal reason',()=>{
 const comment='<img src=x onerror=alert(1)> исправить';
 const item=collect([order({scheduled_date:'2026-09-28',report_review_status:'rejected',report_review_comment:comment})],now)[0];
 assert.deepEqual(item.issues.map(x=>x.code),['report_rejected']);
 assert.equal(item.issues[0].next,comment);assert.equal(item.issues[0].role,'master');
});
test('missing assignee for correction is routed to dispatcher',()=>{
 const item=collect([order({report_review_status:'rejected',master_staff_id:null,master_name:null})],now)[0];
 assert.equal(item.issues[0].role,'dispatcher');
});
test('only explicit true reschedule flags raise a task',()=>{
 for(const value of [false,'false',null,undefined,0])assert.deepEqual(codes(order({reschedule_requested:value})),[]);
 assert.deepEqual(codes(order({reschedule_requested:true})),['reschedule']);
});
test('missing/invalid visit time is not an invented hour',()=>{
 assert.deepEqual(codes(order({scheduled_time:'25:00'})),['untimed']);
 assert.deepEqual(codes(order({scheduled_time:null,time_slot:'10:00–12:00'})),[]);
});
test('Hands public order number is preserved without changing internal identity',()=>{
 const item=collect([order({external_id:'hands:90210',external_source:'hands',reschedule_requested:true})],now)[0];
 assert.equal(item.id,'1');assert.equal(item.number,'90210');
});
test('classification never changes orders or payroll fields',()=>{
 const input=[Object.freeze(order({reschedule_requested:true,master_payout:552.5,amount:1000}))];
 const before=JSON.stringify(input);collect(input,now);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(collect([null,undefined,{},'text'],now),[]);
});

test('active unfinished work stays actionable when replacing the legacy problem list',()=>{
 const item=collect([order({uncompleted_work_amount:300,uncompleted_work_description:'Остался угол'})],now)[0];
 assert.deepEqual(item.issues.map(x=>x.code),['unfinished_work']);
 assert.equal(item.issues[0].next,'Остался угол');
 assert.deepEqual(codes(order({status:'Выполнена',uncompleted_work_amount:300})),[]);
});
