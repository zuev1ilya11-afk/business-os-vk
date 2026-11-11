const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../service-catalog.js'),D=require('../report-deduction.js'),W=require('../order-work-items.js');
const source=require('../data/lemana-price-2026-11-11.json');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
test('all 40 XLSX price rows and units are represented, including merged cells',()=>{
 assert.equal(C.lemana.services.length,40);
 assert.equal(new Set(C.lemana.services.map(s=>s.id)).size,40);
 for(const original of source.services){const row=C.lemana.services.find(s=>s.id===original.id);for(const k of ['p','u','sourceRange','kind'])assert.equal(row[k],original[k]);
  const clean=s=>s.replace(/[.\s]+/g,' ').trim();assert.equal(clean([row.n,row.note].join(' ')),clean([original.n,original.note].join(' ')));}
 assert.equal(C.lemana.services.find(s=>s.id.endsWith('_034')).u,'комплект');
 assert.equal(C.lemana.services.find(s=>s.id.endsWith('_067')).p,550);
 assert.equal(C.lemana.services.find(s=>s.id.endsWith('_066')).p,830);
 assert.equal(C.forSource('Лемана Про').length,39);
 assert.equal(C.standard[4].p,1699);assert.equal(C.standard.length,34);
 assert.deepEqual(C.forSource('Hands'),C.standard);assert.deepEqual(C.forSource('Авито'),C.standard);
 assert.equal(C.forSource({external_source:'lemana_pro'}).length,39);
});
test('new prices multiply by quantity; minimum visit is not an additive service',()=>{
 const item=C.lemana.services.find(s=>s.id.endsWith('_014'));
 const [line]=W.normalize([{name:item.n,service_id:item.id,quantity:'4,5',unit:item.u,unit_price:item.p}]);assert.equal(line.amount,4275);
 assert.equal(D.forOrder({source:'Лемана Про'}).length,39);
 assert.ok(!D.forOrder({source:'Hands'}).some(s=>s.source==='lemana_pro'));
 assert.ok(!D.catalog.some(s=>s.id.endsWith('_006')&&s.source==='lemana_pro'));
 assert.throws(()=>D.items([{service_id:'lemana_20261111_010',unit_price:1850,quantity:1}],{source:'Hands'}));
 assert.throws(()=>D.items([{service_id:'lemana_20261111_010',unit_price:1699,quantity:1}],{source:'Лемана Про'}));
});
test('finance keeps old service identity and counts new Lemana deductions by saved ID',()=>{
 const F=require('../finance-data.js');
 const base={status:'Выполнена',completed_at:'2026-11-11T09:00:00Z',amount:500,master_payout:200,source:'Лемана Про',work:'Подрезка карниза по длине × 3 пил'};
 const rows=F.records([{...base,id:'old',uncompleted_work_items:[{service_id:'standard_020',quantity:1}]},{...base,id:'new',work_items:[{service_id:'lemana_20261111_062',name:'Подрезка карниза по длине',quantity:3,unit:'пил',unit_price:200,amount:600}],uncompleted_work_items:[{service_id:'lemana_20261111_062',quantity:1}]}],[]);
 assert.equal(rows[0].works[0].key,'standard_020');assert.equal(rows[1].works[0].key,'lemana_20261111_062');
 const groups=F.workGroups(rows);assert.equal(groups.length,2);assert.ok(groups.every(g=>g.quantity===2));assert.equal(F.aggregate(rows).revenue,1000);
});
for(const [slug,action] of [['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']]){
 test(slug+'/'+action+' saves Lemana version and applies the deduction once',async()=>{
  const old={id:'old',source:'Лемана Про',status:'Выполнена',amount:1699,master_payout:999};
  const db=database({business_staff:[employee('m')],orders:[{id:'1',source:'Лемана Про',master_staff_id:'m',status:'В работе',master_workflow_stage:'started',original_amount:5000,amount:5000},structuredClone(old)]});
  db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:'https://files.test/'+path},error:null})})};
  const api=edge(slug,db),body={action,order_id:'1',upload_token:'test',act_url:attachmentUrl('1','test'),photo_urls:[attachmentUrl('1','test','p.jpg')],act_data:'YQ==',photos_json:JSON.stringify([{name:'p.jpg',data:'YQ=='}]),uncompleted_work_done:true,uncompleted_work_items:[{service_id:'lemana_20261111_014',quantity:1.5,unit_price:950}],uncompleted_work_amount:1425};
  const r=await api(body,'staff_m');assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(db.tables.orders[0].amount,3575);assert.equal(db.tables.orders[0].uncompleted_work_items[0].catalog_version,'2026-11-11');
  assert.equal((await api(body,'staff_m')).status,200);assert.equal(db.tables.orders[0].amount,3575);assert.deepEqual(db.tables.orders[1],old);
 });
}
