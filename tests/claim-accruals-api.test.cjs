const {test}=require('node:test'),assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
const old={id:'1769',status:'Выполнена',completed_at:'2026-09-25T12:00:00Z',master_staff_id:'m',source:'Hands',amount:1000,master_payout:552.5,extra_work_amount:100,work:'Монтаж',manager_payout:777,report_upload_token:'PRIVATE_REPORT'};
const setup=()=>{const db=database({business_staff:[employee('owner','owner'),employee('manager','manager'),employee('dispatcher','dispatcher'),employee('m')],orders:[{...old,is_claim:true,completed_at:'2026-10-31T12:00:00Z',master_payout:900}],order_financial_snapshots:[{order_id:'1769',financial_data:old}]});return {db,api:edge('mini-app-api',db)}};
test('server export uses original accrual in its original period, never the new report completion',async()=>{
 const {api}=setup(),filters={master:'m',format:'master',period:{start:'2026-10-01',end:'2026-10-31'}};
 const current=await api({action:'previewFinanceExport',filters});assert.equal(current.status,200);assert.equal(current.body.empty,true);assert.equal(current.body.total.pay,0);
 const original=await api({action:'previewFinanceExport',filters:{...filters,period:{start:'2026-09-01',end:'2026-09-30'}}});
 assert.equal(original.status,200);assert.equal(original.body.count,1);assert.equal(original.body.total.pay,652.5);
});
test('master bootstrap exposes only their own original accrual and dispatcher gets no historical snapshot',async()=>{
 const {db,api}=setup();
 const master=await api({action:'bootstrap'},'staff_m');assert.equal(master.status,200);
 const saved=master.body.orders[0].financial_snapshot;
 assert.equal(saved.master_payout,552.5);assert.equal(saved.extra_work_amount,100);
 for(const key of ['amount','manager_payout','dispatcher_payout','report_upload_token'])assert.equal(saved[key],undefined);
 const dispatcher=await api({action:'bootstrap'},'staff_dispatcher');assert.equal(dispatcher.status,200);assert.equal(dispatcher.body.orders[0].financial_snapshot,undefined);
 db.tables.order_financial_snapshots[0].financial_data={...old,master_staff_id:'different'};
 const reassigned=await api({action:'bootstrap'},'staff_m');assert.equal(reassigned.body.orders[0].financial_snapshot,undefined);assert.equal(reassigned.body.orders[0].financial_snapshot_status,'other_master');
});
test('unknown historical claim blocks a master statement instead of presenting a false complete total',async()=>{
 const {db,api}=setup();db.tables.order_financial_snapshots=[];
 const result=await api({action:'previewFinanceExport',filters:{master:'m',format:'master',period:{start:'2026-10-01',end:'2026-10-31'}}});
 assert.equal(result.status,409);assert.equal(result.body.code,'CLAIM_HISTORY_REQUIRED');
});
test('reassigning the repeat visit preserves the first master history without exposing the new visit',async()=>{
 const {db,api}=setup();db.tables.orders[0].master_staff_id='different';db.tables.orders[0].address='CURRENT_PRIVATE_ADDRESS';
 const result=await api({action:'bootstrap'},'staff_m');assert.equal(result.status,200);
 assert.equal(result.body.orders.length,0);
 const history=result.body.user.financial_history;
 assert.equal(history.length,1);assert.equal(history[0].id,'1769');assert.equal(history[0].master_payout,552.5);
 assert.ok(!JSON.stringify(history).includes('CURRENT_PRIVATE'));
 assert.equal(history[0].amount,undefined);assert.equal(history[0].manager_payout,undefined);
});
