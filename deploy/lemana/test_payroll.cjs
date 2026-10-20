const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const variants={'a47464c3002e':'mini-app-api','c1807125b6a0':'profile-self-api','74f9c8dfd44f':'integration-api'};
const load=file=>{const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);return context.BOS_ORDER_PAYROLL};
const plain=x=>JSON.parse(JSON.stringify(x));
for(const [revision,handler] of Object.entries(variants)){
 const before=load('fixtures/payroll-'+revision+'.js'),after=load('package/backend/'+handler+'/order-payroll.js');
 test(revision+': every existing calculation/snapshot/export preserves non-Lemana behavior',()=>{
  for(const source of ['Hands','Руки','Руки (Hands)','VK','Авито','Телефон',''])for(const status of ['Новая','В работе','Выполнена','Отменена'])for(const snapshot of [false,true]){
   const order={source,external_source:source==='Hands'?'hands':'mini_app',external_id:'existing',status,amount:1234.56,original_amount:1400,master_payout:321,manager_payout:44,dispatcher_payout:55,extra_work_amount:100,uncompleted_work_amount:165.44,report_review_status:snapshot?'approved':null,completed_at:'2026-10-20T10:00:00Z',manual_completion_history:snapshot?[{at:'2026-10-20T10:00:00Z'}]:[]};
   for(const name of Object.keys(before))if(typeof before[name]==='function'&&!['label','calculate'].includes(name))assert.deepEqual(plain(after[name](order)),plain(before[name](order)),name+':'+source+':'+status);
   for(const amount of [0,.01,1.005,1000,1234.56])for(const master of [true,false])assert.deepEqual(plain(after.calculate(amount,order,master)),plain(before.calculate(amount,order,master)));
  }
 });
 test(revision+': new Lemana delegates exactly to deployed Hands calculation including rounding',()=>{
  for(const amount of [0,.01,1.005,99.99,1000,999999.99])for(const master of [true,false])assert.deepEqual(plain(after.calculate(amount,{source:'Лемана Про',external_source:'lemana_pro'},master)),plain(before.calculate(amount,{source:'Hands',external_source:'hands'},master)));
  const saved={source:'Лемана Про',external_source:'lemana_pro',external_id:'hands:42',amount:1000,master_payout:123.45,status:'Выполнена'};
  assert.equal(after.directMaster(saved),123.45);assert.equal(after.isHandsLinked(saved),false);assert.equal(after.isHands(saved),false);
  if(after.masterView){const row={...saved,work_items:[{name:'Синтетическая работа',quantity:2,unit:'шт.',unit_price:500,amount:1000}]};assert.deepEqual(plain(after.masterView(row).work_items),[{name:'Синтетическая работа',quantity:2,unit:'шт.'}]);assert.equal(row.work_items[0].amount,1000)}
 });
}
