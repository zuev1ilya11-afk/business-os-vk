const {test}=require('node:test');
const assert=require('node:assert/strict');
const payroll=require('../order-payroll.js');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const hands=[{source:'Hands'},{source:' Руки '},{source:'Авито',external_source:'HANDS'},{source:'Телефон',external_id:'hands:42'},{}];
const direct=[{source:'Авито',external_source:'avito'},{source:'Телефон',external_source:'mini_app'},{source:'VK'},{source:'Рекомендация'},{external_source:'api:site'}];
const order=src=>({id:'1',status:'В работе',master_staff_id:'m',amount:800,original_amount:1000,uncompleted_work_amount:200,extra_work_amount:300,master_payout:480,manager_payout:127.84,dispatcher_payout:95.88,scheduled_date:'2099-01-01',scheduled_time:'10:00',master_workflow_stage:'assigned',...src});
const seed=src=>database({business_staff:[employee('owner','owner'),employee('m'),employee('other')],orders:[order(src),{...order(src),id:'2',master_staff_id:'other'}]});
function visibility(view,isDirect){
 assert.equal(view.amount,isDirect?800:undefined);assert.equal(view.original_amount,isDirect?1000:undefined);
 assert.equal(view.manager_payout,undefined);assert.equal(view.dispatcher_payout,undefined);
}
for(const src of [...hands,...direct])test('master response visibility uses persisted source: '+JSON.stringify(src),async()=>{
 const reveal=payroll.isDirect(src),db=seed(src),before=JSON.stringify(db.tables.orders);
 for(const slug of ['mini-app-api','claims-api']){
  const r=await edge(slug,db)({action:'bootstrap',source:'Авито',external_source:'avito'},'staff_m');
  assert.equal(r.status,200);assert.deepEqual(r.body.orders.map(x=>x.id),['1']);visibility(r.body.orders[0],reveal);
 }
 assert.equal(JSON.stringify(db.tables.orders),before,'reads must not change financial rows');
 const ops=await edge('mini-app-api',db)({action:'bootstrap'});assert.equal(ops.body.orders[0].amount,800);assert.equal(ops.body.orders[0].manager_payout,127.84);
});
for(const src of [hands[2],direct[0]])test('workflow actions retain cost visibility through writes and receipts: '+JSON.stringify(src),async()=>{
 const db=seed(src),api=edge('master-workflow-api',db),reveal=payroll.isDirect(src);
 for(const b of [{action:'markCalled',id:'1'},{action:'markCalled',id:'1'},{action:'confirmAgreement',id:'1'},{action:'setStage',id:'1',stage:'departed'},{action:'setStage',id:'1',stage:'started'}]){
  const r=await api({...b,source:'Авито',external_source:'avito'},'staff_m');assert.equal(r.status,200);visibility(r.body.order,reveal);
  assert.equal(db.tables.orders[0].master_payout,480,'visibility is not payroll recalculation');
 }
 assert.equal((await api({action:'markCalled',id:'2'},'staff_m')).status,403);
 assert.equal((await api({action:'markCalled',id:'1'},'staff_m','')).status,401);
});
for(const slug of ['order-lifecycle-api','report-api'])for(const src of [hands[2],direct[0]])test(slug+' report response and retry preserve source-specific visibility: '+JSON.stringify(src),async()=>{
 const db=seed(src),api=edge(slug,db),reveal=payroll.isDirect(src);
 db.tables.orders[0].master_workflow_stage='started';
 const b={action:'finalizeMasterReport',order_id:'1',upload_token:'cost-view',act_url:attachmentUrl('1','cost-view'),photo_urls:[attachmentUrl('1','cost-view','photo.jpg')],uncompleted_work_amount:200,extra_work_amount:300,source:'Авито',external_source:'avito'};
 const r=await api(b,'staff_m');assert.equal(r.status,200);visibility(r.body.order,reveal);assert.equal(r.body.order.master_payout,reveal?480:442);
 const before=JSON.stringify(db.tables.orders);visibility((await api(b,'staff_m')).body.order,reveal);assert.equal(JSON.stringify(db.tables.orders),before);
 assert.equal((await api({...b,order_id:'2'},'staff_m')).status,403);
 const unsigned=await api(b,'staff_m','');assert.ok([401,403].includes(unsigned.status));
});
test('cost breakdown conserves current 60/40 plus separate extras and never reprices stored history',()=>{
 const o=Object.freeze(order(direct[0])),before=JSON.stringify(o),d=payroll.masterBreakdown(o);
 assert.deepEqual([d.original,d.deduction,d.amount,d.extras,d.total,d.master,d.masterTotal,d.company],[1000,200,800,300,1100,480,780,320]);
 assert.equal(d.masterTotal+d.company,d.total);assert.equal(d.standard,true);assert.equal(JSON.stringify(o),before);
 for(const payout of [0,123,480]){
  const historical={...o,status:'Выполнена',report_review_status:'approved',master_payout:payout};
  const stored=payroll.masterBreakdown(historical);assert.equal(stored.master,payout);assert.equal(stored.masterTotal,payout+300);assert.equal(stored.company,800-payout);assert.equal(stored.saved,true);assert.equal(stored.standard,payout===480);
 }
 for(const src of hands)assert.equal(payroll.masterBreakdown({...o,...src,source:src.source,external_source:src.external_source,external_id:src.external_id}),null);
 assert.equal(payroll.masterBreakdown({source:'Авито'}),null,'missing server cost is not zero');
 const zero=payroll.masterBreakdown({source:'Авито',amount:0,original_amount:0});assert.equal(zero.total,0);
 const cancelled=payroll.masterBreakdown({...o,status:'Отменена'});assert.equal(cancelled.masterTotal,0);assert.equal(cancelled.company,0);
 for(const amount of [0.01,0.02,799.99,1000.01]){const d=payroll.masterBreakdown({...o,amount});assert.equal(Math.round((d.masterTotal+d.company)*100),Math.round(d.total*100));}
});
test('server redaction copies rather than mutating source data',()=>{
 const o=Object.freeze(order(hands[0]));const view=payroll.masterView(o);assert.notEqual(view,o);assert.equal(o.amount,800);visibility(view,false);
 const directView=payroll.masterView(Object.freeze(order(direct[0])));visibility(directView,true);
});
