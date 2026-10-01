const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const D=require('../report-deduction.js');
const prices=require('../service-catalog.js');
const routes=[['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']];
const row={service_id:'standard_016',quantity:1.25,unit_price:300};
function fixture(source='Hands'){
 const db=database({business_staff:[employee('m')],orders:[{id:'1',source,master_staff_id:'m',status:'В работе',master_workflow_stage:'started',original_amount:1000,amount:800,uncompleted_work_amount:200},{id:'old',status:'Выполнена',report_review_status:'approved',amount:777,master_payout:111}]});
 db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:'https://files.test/'+path},error:null})})};return db;
}
function body(action,patch={}){return {action,order_id:'1',upload_token:'test',act_url:attachmentUrl('1','test'),photo_urls:[attachmentUrl('1','test','p.jpg')],act_data:'YQ==',photos_json:JSON.stringify([{name:'p.jpg',data:'YQ=='}]),uncompleted_work_done:true,uncompleted_work_items:[row],uncompleted_work_amount:375,uncompleted_work_description:'Размер не подошёл',extra_work_done:true,extra_work_amount:100,...patch};}
for(const [slug,action] of routes){
 for(const source of ['Hands','Телефон'])test(`${slug}/${action}: ${source} snapshot, original base, extras and receipt`,async()=>{
  const db=fixture(source),api=edge(slug,db),old=structuredClone(db.tables.orders[1]);
  const res=await api(body(action),'staff_m');assert.equal(res.status,200,JSON.stringify(res.body));
  const saved=db.tables.orders[0];assert.equal(saved.amount,625);assert.equal(saved.original_amount,1000);assert.equal(saved.extra_work_amount,100);
  assert.equal(saved.master_payout,source==='Hands'?345.31:375);
  assert.equal(saved.uncompleted_work_items[0].unit,'п.м.');assert.equal(saved.uncompleted_work_items[0].amount,375);
  assert.equal(saved.uncompleted_work_description,'Размер не подошёл');assert.equal(saved.report_review_status,'pending');
  assert.equal(res.body.order.original_amount,source==='Hands'?undefined:1000);
  assert.equal((await api(body(action),'staff_m')).status,200);assert.equal(db.tables.orders[0].amount,625);
  Object.assign(saved,{report_review_status:'rejected',report_upload_token:null,report_uploaded_at:null});
  const again=await api(body(action,{upload_token:'again',act_url:attachmentUrl('1','again'),photo_urls:[attachmentUrl('1','again','p.jpg')]}),'staff_m');
  assert.equal(again.status,200);assert.equal(db.tables.orders[0].amount,625);assert.deepEqual(db.tables.orders[1],old);
 });
 test(`${slug}/${action}: everything done ignores cached selection and deduction`,async()=>{
  const db=fixture();const r=await edge(slug,db)(body(action,{uncompleted_work_done:false,uncompleted_work_amount:9999}),'staff_m');
  assert.equal(r.status,200);assert.equal(db.tables.orders[0].amount,1000);assert.equal(db.tables.orders[0].uncompleted_work_amount,0);assert.deepEqual(db.tables.orders[0].uncompleted_work_items,[]);assert.equal(db.tables.orders[0].uncompleted_work_description,'');
 });
 for(const [name,patch] of Object.entries({
  empty:{uncompleted_work_items:[]},unknown:{uncompleted_work_items:[{...row,service_id:'fake'}]},duplicate:{uncompleted_work_items:[row,row]},negative:{uncompleted_work_items:[{...row,quantity:-1}]},zero:{uncompleted_work_items:[{...row,quantity:0}]},fractionalPieces:{uncompleted_work_items:[{service_id:'standard_015',quantity:1.5,unit_price:180}]},precision:{uncompleted_work_items:[{...row,quantity:1.0001}]},priceTamper:{uncompleted_work_items:[{...row,unit_price:1}]},totalTamper:{uncompleted_work_amount:1},lineTamper:{uncompleted_work_items:[{...row,amount:1}]},overflow:{uncompleted_work_items:[{...row,quantity:4}],uncompleted_work_amount:1200},fromNotAgreed:{uncompleted_work_items:[{service_id:'avito_socket_install',quantity:1,unit_price:350}],uncompleted_work_amount:350},negativePrice:{uncompleted_work_items:[{service_id:'avito_socket_install',quantity:1,unit_price:-1,price_confirmed:true}]},invalidType:{uncompleted_work_items:[{...row,quantity:'1.25'}]},tooMany:{uncompleted_work_items:Array(101).fill(row)}
 }))test(`${slug}/${action}: reject ${name} without writes`,async()=>{
  const db=fixture(),before=structuredClone(db.tables.orders);const r=await edge(slug,db)(body(action,patch),'staff_m');assert.equal(r.status,400,JSON.stringify(r.body));assert.deepEqual(db.tables.orders,before);
 });
 test(`${slug}/${action}: explicitly agreed from-price is snapshotted`,async()=>{
  const db=fixture('Авито');const r=await edge(slug,db)(body(action,{uncompleted_work_items:[{service_id:'avito_socket_install',quantity:2,unit_price:350,price_confirmed:true}],uncompleted_work_amount:700}),'staff_m');assert.equal(r.status,200);assert.equal(db.tables.orders[0].uncompleted_work_items[0].price_confirmed,true);assert.equal(db.tables.orders[0].amount,300);
 });
}
test('catalog preserves actual Avito data and measurement rules',()=>{
 assert.deepEqual(prices.avito,require('../supabase/functions/_shared/avito-price-catalog.json'));
 assert.equal(prices.standard.length,34);assert.equal(prices.standard[4].p,1699);
 assert.equal(D.fractional('пог. м'),true);assert.equal(D.fractional('шт.'),false);
});
test('legacy original amount is recovered once',()=>{
 const p=D.normalize({uncompleted_work_done:true,uncompleted_work_items:[row],uncompleted_work_amount:375},{amount:800,uncompleted_work_amount:200});assert.equal(p.original_amount,1000);
});
