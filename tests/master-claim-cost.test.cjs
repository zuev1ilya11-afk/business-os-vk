const {test}=require('node:test'),assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
for(const source of ['Hands','Авито'])test('claim closure returns only source-permitted cost: '+source,async()=>{
 const original={id:'1',status:'В работе',is_claim:true,master_staff_id:'m',source,amount:800,original_amount:1000,master_payout:123,manager_payout:45,dispatcher_payout:67};
 const db=database({business_staff:[employee('m'),employee('other'),employee('owner','owner')],orders:[original]});const api=edge('claims-api',db);
 assert.equal((await api({action:'closeClaim',id:'1'},'staff_other')).status,403);
 const r=await api({action:'closeClaim',id:'1',source:'Авито'},'staff_m');assert.equal(r.status,200);
 assert.equal(r.body.order.amount,source==='Hands'?undefined:800);assert.equal(r.body.order.original_amount,source==='Hands'?undefined:1000);
 assert.equal(r.body.order.master_payout,123);assert.equal(r.body.order.manager_payout,undefined);assert.equal(r.body.order.dispatcher_payout,undefined);
 for(const field of ['amount','original_amount','master_payout','manager_payout','dispatcher_payout'])assert.equal(db.tables.orders[0][field],original[field]);
});
