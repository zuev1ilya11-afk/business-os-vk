const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const payroll=require('../order-payroll.js');
const {edge,database,employee,attachmentUrl,token}=require('./helpers/edge.cjs');
const staff=[employee('owner','owner'),employee('m'),employee('other')];
const draft=(source={source:'Авито',external_source:'avito'})=>({id:'1',client:'Test',status:'В работе',original_amount:1000,amount:1000,master_staff_id:'m',master_workflow_stage:'started',...source});
const report=action=>({action,order_id:'1',upload_token:'source-payroll',act_url:attachmentUrl('1','source-payroll'),photo_urls:[attachmentUrl('1','source-payroll','photo.jpg')],act_data:'YQ==',act_name:'act.pdf',photos_json:JSON.stringify([{name:'photo.jpg',mime:'image/jpeg',data:'YQ=='}]),uncompleted_work_amount:200,extra_work_amount:300,source:'Hands',external_source:'hands',master_payout:1,manager_payout:1});
const directSources=[{source:'Авито',external_source:'avito'},{source:'Телефон',external_source:'mini_app'},{source:'VK'},{source:'Рекомендация'},{external_source:'api:website'},{source:'Другое'}];
const handsSources=[{source:'Hands'},{source:' Руки '},{external_source:'HANDS',source:'Авито'},{external_id:'hands:123',source:'Телефон'}];
for(const src of handsSources)test('Hands marker always preserves rates: '+JSON.stringify(src),()=>{
 assert.equal(payroll.isHands(src),true);assert.deepEqual(payroll.calculate(1000,src),{master_payout:552.5,manager_payout:0,dispatcher_payout:0});assert.equal(payroll.directMaster({...src,amount:1000}),null);assert.equal(payroll.companyShare({...src,amount:1000}),447.5);
});
for(const src of directSources)test('direct source has one 60/40 split: '+JSON.stringify(src),()=>{
 assert.deepEqual(payroll.calculate(1000,src),{master_payout:600,manager_payout:0,dispatcher_payout:0});assert.equal(payroll.directCompany({...src,amount:1000}),400);
});
test('kopecks conserve the full base; no second subtraction of unfinished work',()=>{
 for(const amount of [0,0.01,0.02,0.03,799.99,1000.01,999999.99]){
  const o={source:'Авито',amount,uncompleted_work_amount:200};const master=payroll.directMaster(o),company=payroll.directCompany(o);
  assert.equal(Math.round((master+company)*100),Math.round(amount*100));assert.equal(master,Math.round(amount*.6*100)/100);
 }
 assert.equal(payroll.directMaster({source:'Авито',status:'Отменена',amount:1000,master_payout:600}),0);
 assert.equal(payroll.directCompany({source:'Авито',status:'Отменена',amount:1000}),0);
});
test('source-less legacy records retain the master contract without management payroll and direct historical zero is not recomputed',()=>{
 assert.deepEqual(payroll.calculate(1000,{}),{master_payout:552.5,manager_payout:0,dispatcher_payout:0});
 for(const value of [0,123,552.5,600])assert.equal(payroll.directMaster({source:'VK',status:'Выполнена',amount:1000,master_payout:value}),value);
});
for(const [slug,action] of [['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']]){
 for(const src of [directSources[0],directSources[1],handsSources[0]])test(`${slug}/${action} source-aware stored payout and role reads: ${src.source}`,async()=>{
  const old={...draft(src),id:'historic',status:'Выполнена',report_review_status:'approved',master_payout:123,extra_work_amount:17,manager_payout:45,dispatcher_payout:67};
  const db=database({business_staff:staff,orders:[draft(src),old]});const before=structuredClone(old);
  db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async p=>({data:{signedUrl:'https://test.invalid/'+p},error:null})})};
  const api=edge(slug,db);const res=await api(report(action),'staff_m');assert.equal(res.status,200);
  const saved=db.tables.orders[0],hands=payroll.isHands(src),base=hands?442:480;
  assert.equal(saved.amount,800);assert.equal(saved.master_payout,base);assert.equal(saved.extra_work_amount,300);
  assert.equal(saved.manager_payout,0);assert.equal(saved.dispatcher_payout,0);
  assert.equal(saved.master_payout+saved.extra_work_amount,hands?742:780);
  assert.equal(res.body.order.amount,hands?undefined:800);assert.equal(res.body.order.original_amount,hands?undefined:1000);assert.equal(res.body.order.manager_payout,undefined);
  for(const who of ['100','staff_m']){const r=await edge('mini-app-api',db)({action:'bootstrap'},who);assert.equal(r.body.orders[0].master_payout,base);if(!hands)assert.equal(r.body.orders[1].master_payout,123);}
  const writes=db.calls.filter(c=>c.table==='orders'&&c.mode==='update').length;
  assert.equal((await api(report(action),'staff_m')).status,200);assert.equal(db.calls.filter(c=>c.table==='orders'&&c.mode==='update').length,writes,'receipt must not reprice or rewrite');
  assert.deepEqual(db.tables.orders[1],before);
 });
}
for(const source of ['Авито','Телефон','VK','Рекомендация','Другое','Руки'])test('create and later assignment use channel '+source,async()=>{
 const db=database({business_staff:staff});const api=edge('mini-app-api',db);
 let r=await api({action:'createOrder',client:'x',address:'x',work:'x',source,amount:1000,master_vk_id:'staff_m',external_source:'hands',master_payout:999});
 assert.equal(r.status,200);assert.equal(r.body.order.external_source,'mini_app');assert.equal(r.body.order.master_payout,source==='Руки'?552.5:600);
 assert.equal(r.body.order.manager_payout,0);assert.equal(r.body.order.dispatcher_payout,0);
 r=await api({action:'updateOrder',id:r.body.order.id,master_vk_id:''});assert.equal(r.status,200);assert.equal(r.body.order.master_payout,0);
 r=await api({action:'updateOrder',id:r.body.order.id,master_vk_id:'staff_m'});assert.equal(r.body.order.master_payout,source==='Руки'?552.5:600);
});
test('source switching reprices drafts but refuses changing submitted report scheme',async()=>{
 const db=database({business_staff:staff,orders:[draft({source:'Руки',external_source:'mini_app'})]});const api=edge('mini-app-api',db);
 let r=await api({action:'updateOrder',id:'1',source:'Телефон'});assert.equal(r.body.order.master_payout,600);assert.equal(r.body.order.manager_payout,0);
 Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved',master_payout:123});
 const before=structuredClone(db.tables.orders[0]);r=await api({action:'updateOrder',id:'1',source:'Руки'});assert.equal(r.status,409);assert.deepEqual(db.tables.orders[0],before);
 r=await api({action:'updateOrder',id:'1',comment:'note'});assert.equal(r.status,200);assert.equal(r.body.order.master_payout,123);
});
test('concurrent source edit fails the report comparison rather than storing wrong rate',async()=>{
 const db=database({business_staff:staff,orders:[draft()]});db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update')db.tables.orders[0].source='Hands'};
 const r=await edge('order-lifecycle-api',db)(report('finalizeMasterReport'),'staff_m');assert.equal(r.status,409);assert.equal(db.tables.orders[0].report_uploaded_at,undefined);
});
test('integration imports use new scheme and protect accepted historical rows',async()=>{
 const key='fixture-key',db=database({api_integrations:[{id:'i',slug:'website',name:'Website',api_key_hash:createHash('sha256').update(key).digest('hex'),is_active:true}],orders:[{...draft({source:'Website',external_source:'api:website',external_id:'one'}),master_staff_id:'m'}]});
 const api=edge('integration-api',db),body={action:'upsertOrder',order:{external_id:'one',client:'x',address:'x',work:'x',amount:1000}};
 let r=await api(body,'100',token('100'),{'x-api-key':key});assert.equal(r.status,200);assert.equal(r.body.order.master_payout,600);assert.equal(r.body.order.manager_payout,0);
 Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved',master_payout:123});r=await api(body,'100',token('100'),{'x-api-key':key});assert.equal(r.body.preserved,true);assert.equal(r.body.order.master_payout,123);
});
