const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const payroll=require('../order-payroll.js');
const {edge,database,employee}=require('./helpers/edge.cjs');
const source={source:'Кабинет клиента',external_source:'client_portal'};

test('client portal inherits existing direct payroll and preserves accepted snapshots',()=>{
  assert.equal(payroll.sourceLabel(source),'Кабинет клиента');
  assert.equal(payroll.isHands(source),false);
  assert.equal(payroll.isLemana(source),false);
  for(const amount of [0,.01,1250.55,10000]){
    assert.deepEqual(payroll.calculate(amount,source),payroll.calculate(amount,{source:'Телефон',external_source:'mini_app'}));
    assert.equal(payroll.calculate(amount,source,false).master_payout,0);
  }
  for(const master_payout of [0,123,600])assert.equal(payroll.directMaster({...source,status:'Выполнена',report_review_status:'approved',amount:1000,master_payout}),master_payout);
  assert.equal(payroll.directMaster({...source,status:'Отменена',amount:1000,master_payout:600}),0);
});

test('original staff bootstrap, assignment and ownership work with the same client order',async()=>{
  const order={id:'42',...source,client:'Синтетический клиент',address:'Тестовый адрес',phone:'+79990000001',work:'Тестовая работа',status:'Новая',amount:1200,original_amount:1200,master_staff_id:null,work_items:[{name:'Работа',unit:'шт.',quantity:2,unit_price:600,amount:1200}],cp_client_id:'client-42'};
  const db=database({business_staff:[employee('owner','owner'),employee('dispatch','dispatcher'),employee('master'),employee('other')],orders:[order]});
  const app=edge('mini-app-api',db);
  let result=await app({action:'bootstrap'},'staff_dispatch');
  assert.equal(result.status,200);assert.equal(result.body.orders.length,1);assert.equal(result.body.orders[0].id,'42');
  result=await app({action:'updateOrder',id:'42',master_vk_id:'staff_master'},'staff_dispatch');
  assert.equal(result.status,200);assert.equal(result.body.order.master_staff_id,'master');
  assert.equal(result.body.order.master_payout,720);assert.equal(result.body.order.external_source,'client_portal');
  assert.deepEqual(result.body.order.work_items,order.work_items);
  assert.equal((await app({action:'bootstrap'},'staff_master')).body.orders.length,1);
  assert.equal((await app({action:'bootstrap'},'staff_other')).body.orders.length,0);
  const before=structuredClone(db.tables.orders[0]);
  assert.equal((await app({action:'updateOrder',id:'42',master_vk_id:'staff_other'},'staff_master')).status,403);
  assert.deepEqual(db.tables.orders[0],before);
});

test('portal integration is inert unless explicitly enabled, with no credential or network access',()=>{
  const source=fs.readFileSync(require.resolve('../client-portal-staff.js'),'utf8');
  const context={window:{},fetch(){throw Error('Unexpected network access')},document:new Proxy({},{get(){throw Error('Unexpected document access')}})};
  vm.runInNewContext(source,context);
  assert.equal(context.window.BOS_CLIENT_PORTAL_STAFF,undefined);
});

test('portal staff refuses an off-origin credential destination before touching DOM',()=>{
  const source=fs.readFileSync(require.resolve('../client-portal-staff.js'),'utf8');
  const context={window:{BOS_CLIENT_PORTAL_CONFIG:{enabled:true,apiBase:'https://other.invalid/client-api/'}},location:{origin:'https://staff.invalid'},URL,document:new Proxy({},{get(){throw Error('Unexpected document access')}})};
  vm.runInNewContext(source,context);
  assert.equal(context.window.BOS_CLIENT_PORTAL_STAFF,undefined);
});
