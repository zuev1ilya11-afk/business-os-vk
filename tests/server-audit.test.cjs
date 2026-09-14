const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

// Report responses to masters intentionally expose only the master's payout;
// manager/dispatcher payouts and order totals remain server-side/private.
test('report finalization subtracts 15 percent and then 35 percent for master payout',async()=>{
 const db=database({business_staff:[employee('m')],orders:[{id:'1',master_staff_id:'m',original_amount:1000}]});
 const r=await edge('report-api',db)({action:'finalizeMasterReport',order_id:'1',upload_token:'audit',act_url:'https://example.test/act',photo_urls:['https://example.test/photo']},'staff_m');
 assert.equal(r.status,200);
 assert.equal(r.body.order.master_payout,552.5);
 assert.equal(r.body.order.amount,undefined);
 assert.equal(r.body.order.original_amount,undefined);
 assert.equal(r.body.order.manager_payout,undefined);
 assert.equal(r.body.order.dispatcher_payout,undefined);
});
