const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../finance-data.js'),D=require('../salary-periods.js');
const masters=[{id:'m',full_name:'Мастер',role:'master',is_active:true}];
const original={id:'1769',status:'Выполнена',source:'Hands',master_staff_id:'m',amount:1000,master_payout:552.5,extra_work_amount:100,completed_at:'2026-09-25T12:00:00Z',work:'Монтаж'};
const claim={...original,is_claim:true,status:'Выполнена',completed_at:'2026-10-31T14:24:50Z',report_reviewed_at:'2026-10-31T14:24:50Z',master_payout:900,extra_work_amount:200,financial_snapshot:original};
const total=(orders,month)=>F.aggregate(F.select(F.records(orders,masters),{period:{start:month+'-01',end:month+'-31'}}));
test('free claim completed by report review retains the original pay and month once',()=>{
 assert.equal(total([claim],'2026-10').pay,0);
 assert.equal(total([claim],'2026-09').pay,652.5);
 assert.equal(total([claim],'2026-09').revenue,1100);
 assert.equal(D.completedDay(claim),'2026-09-25');
 assert.equal(claim.master_payout,900);
});
test('opening and repeated closing of a claim never remove or repeat the original accrual',()=>{
 for(const status of ['В работе','Рекламация','Выполнена']){
  const o={...claim,status,completed_at:status==='Выполнена'?'2026-11-05T12:00:00Z':null};
  assert.equal(total([o],'2026-09').pay,652.5);assert.equal(total([o],'2026-10').pay,0);assert.equal(total([o],'2026-11').pay,0);
 }
});
test('legacy claim without a recovered snapshot cannot silently accrue in its repeat-visit period',()=>{
 const o={...claim,financial_snapshot:undefined},rows=F.records([o],masters);
 assert.equal(total([o],'2026-10').pay,0);
 assert.equal(rows[0].pay,null);assert.equal(rows[0].financialUnresolved,true);
 assert.equal(D.completedDay(o),'');
 assert.equal(F.aggregate(rows).pay,null);
});
test('financial history keeps the original master attribution after a repeat visit is reassigned',()=>{
 const reassigned={...claim,master_staff_id:'other'},first={id:'m'},next={id:'other'};
 assert.equal(D.masterFinancialOrders([reassigned],first,[])[0].master_payout,552.5);
 assert.equal(D.masterFinancialOrders([reassigned],next,[reassigned]).filter(o=>o.status==='Выполнена').length,0);
 const limited={id:'m',financial_history:[original]};
 assert.equal(D.masterFinancialOrders([],limited,[])[0].master_payout,552.5);
 assert.equal(D.masterFinancialOrders([claim],limited,[claim]).length,1);
});
test('incomplete historical snapshots never borrow a repeat visit date or salary',()=>{
 const incomplete={...claim,financial_snapshot:{id:'1769',status:'Выполнена',master_staff_id:'m',source:'Hands',completed_at:null}};
 const record=F.records([incomplete],masters)[0];
 assert.equal(D.completedDay(incomplete),'');assert.equal(record.pay,null);assert.equal(record.financialUnresolved,true);
 assert.equal(D.financialOrder(incomplete).master_payout,undefined);
});
