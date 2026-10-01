const {test}=require('node:test'),assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
const payroll=require('../order-payroll.js');
test('explicit edit never switches a completed direct order to Hands rates; reads alone preserve history',async()=>{
 const o={id:'1',status:'Выполнена',report_review_status:'approved',source:'Телефон',external_source:'mini_app',original_amount:1000,amount:1000,master_staff_id:'m',master_payout:600,manager_payout:0,dispatcher_payout:0};
 const db=database({business_staff:[employee('owner','owner'),employee('m')],orders:[o]});
 const r=await edge('mini-app-api',db)({action:'updateOrder',id:'1',original_amount:2000});
 assert.equal(r.status,200);assert.equal(r.body.order.master_payout,1200);assert.equal(r.body.order.manager_payout,0);assert.equal(r.body.order.dispatcher_payout,0);
 assert.equal(payroll.directMaster({...o,master_payout:123}),123);
});
