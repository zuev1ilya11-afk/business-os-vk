const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../order-payroll.js');
const {edge,database,employee}=require('./helpers/edge.cjs');
test('Lemana uses Hands payroll but never its integration identity',()=>{
 for(const source of ['Лемана Про','lemana_pro']){
  const o={source,external_source:'mini_app'};
  assert.equal(P.isHands(o),false);
  assert.equal(P.isDirect(o),false);
  for(const amount of [0,0.01,799.99,1000,999999.99])assert.deepEqual(P.calculate(amount,o),P.calculate(amount,{source:'Hands'}));
 }
 assert.equal(P.isHands({source:'Лемана Про',external_source:'lemana_pro',external_id:'hands:42'}),false);
 assert.equal(P.isHandsLinked({source:'Лемана Про',external_source:'lemana_pro',external_id:'hands:42'}),false);
 assert.equal(P.sourceLabel({source:'Руки'}),'Руки (Hands)');
 assert.equal(P.sourceLabel({source:'Hands'}),'Руки (Hands)');
 assert.equal(P.sourceLabel({source:'Лемана Про'}),'Лемана Про');
 assert.equal(P.sourceLabel({source:'Телефон'}),'Телефон');
 assert.equal(P.directMaster({source:'Лемана Про',status:'Выполнена',amount:1000,master_payout:123}),123);
 const master=P.masterView({source:'Лемана Про',work_items:[{name:'Тест',quantity:2,unit_price:500,amount:1000}]});assert.equal(master.work_items[0].quantity,2);assert.equal(master.work_items[0].unit_price,undefined);assert.equal(master.work_items[0].amount,undefined);
});
test('work quantities use a stored line total only once and accept decimal comma for meters',()=>{
 const W=require('../order-work-items.js');
 const rows=W.normalize([{name:'Тест карниза',unit:'шт.',quantity:'2',unit_price:500},{name:'Тест длины',unit:'пог. м',quantity:'1,5',unit_price:100}]);
 assert.equal(rows[0].amount,1000);assert.equal(rows[1].amount,150);assert.equal(W.total(rows),1150);
 assert.equal(W.text(rows),'Тест карниза × 2 шт.\nТест длины × 1,5 пог. м');
 for(const quantity of ['',0,-1,1.5,null])assert.throws(()=>W.normalize([{name:'Тест',unit:'шт.',quantity,unit_price:500}]));
 assert.throws(()=>W.normalize([{name:'Тест',unit:'шт.',quantity:2,unit_price:500,amount:2000}]));
});
test('API saves quantities without overriding manual cost; legacy edit preserves all old amounts',async()=>{
 const old={id:'old',client:'Тест',address:'Тест',work:'Старая работа × 2',source:'Hands',status:'Выполнена',report_review_status:'approved',amount:3333,original_amount:4000,uncompleted_work_amount:667,master_payout:123,manager_payout:14,dispatcher_payout:15};
 const db=database({business_staff:[employee('owner','owner'),employee('m')],orders:[old]});const api=edge('mini-app-api',db);
 const r=await api({action:'createOrder',client:'Тест',address:'Тест',work:'Монтаж',source:'Лемана Про',original_amount:2700,work_items:[{name:'Монтаж',unit:'шт.',quantity:2,unit_price:500}],master_vk_id:'staff_m'});
 assert.equal(r.status,200);assert.equal(r.body.order.work_items[0].amount,1000);assert.equal(r.body.order.amount,2700);assert.equal(r.body.order.master_payout,1491.75);
 const edit=await api({action:'updateOrder',id:r.body.order.id,work_items:[{name:'Монтаж',unit:'шт.',quantity:3,unit_price:500}]});assert.equal(edit.body.order.amount,2700);assert.equal(edit.body.order.work_items[0].quantity,3);assert.equal(edit.body.order.work,'Монтаж × 3 шт.');
 const historic=await api({action:'updateOrder',id:'old',comment:'Комментарий'});assert.equal(historic.status,200);
 for(const key of ['amount','original_amount','master_payout','manager_payout','dispatcher_payout'])assert.equal(historic.body.order[key],old[key]);assert.equal(historic.body.order.work_items,undefined);
 const bad=await api({action:'createOrder',client:'Тест',address:'Тест',work:'Тест',work_items:[{name:'Тест',quantity:0}]});assert.equal(bad.status,400);
});

test('unchanged cost preserves historical stored totals even when legacy fields do not reconcile',async()=>{
 const old={id:'history',source:'Hands',status:'Выполнена',report_review_status:'approved',work:'Текст',client:'Тест',address:'Тест',original_amount:4000,amount:3210,uncompleted_work_amount:100,master_payout:123,manager_payout:14,dispatcher_payout:15};
 const db=database({business_staff:[employee('owner','owner')],orders:[old]});const api=edge('mini-app-api',db);
 const r=await api({action:'updateOrder',id:'history',original_amount:4000,amount:4000,comment:'Тест',work_items:[{name:'Новая работа',quantity:2,unit:'шт.',unit_price:500}]});assert.equal(r.status,200);
 for(const k of ['amount','original_amount','uncompleted_work_amount','master_payout','manager_payout','dispatcher_payout'])assert.equal(db.tables.orders[0][k],old[k]);
});
