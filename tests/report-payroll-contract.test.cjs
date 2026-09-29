const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

const routes=[['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']];
const cases=[
 {name:'base without tax withholding',original:1000,unfinished:0,extra:0,base:1000,payout:552.5,total:552.5,manager:159.8,dispatcher:119.85},
 {name:'partial work and full extras',original:1000,unfinished:200,extra:300,base:800,payout:442,total:742,manager:127.84,dispatcher:95.88},
 {name:'kopeck rounding',original:1000.01,unfinished:200.02,extra:0.03,base:799.99,payout:441.99,total:442.02,manager:127.84,dispatcher:95.88},
 {name:'no base, extras only',original:1000,unfinished:1000,extra:300,base:0,payout:0,total:300,manager:0,dispatcher:0},
];
function fixture(original=1000){
 const historical={id:'old',master_staff_id:'m',status:'Выполнена',original_amount:1000,amount:1000,master_payout:123,extra_work_amount:17,manager_payout:45,dispatcher_payout:67,completed_at:'2020-01-01T10:00:00Z'};
 const db=database({business_staff:[employee('owner','owner'),employee('d','dispatcher'),employee('m'),employee('other')],orders:[{id:'new',master_staff_id:'m',status:'В работе',original_amount:original,amount:original,master_workflow_stage:'started'},historical]});
 db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:'https://files.test/'+path},error:null})})};
 return {db,historical:structuredClone(historical)};
}
function body(action,c,token='report-1'){
 return {action,order_id:'new',upload_token:token,act_url:'https://files.test/act',photo_urls:['https://files.test/photo'],act_data:'YQ==',act_name:'act.pdf',act_mime:'application/pdf',photos_json:JSON.stringify([{name:'photo.jpg',mime:'image/jpeg',data:'YQ=='}]),uncompleted_work_done:c.unfinished>0,uncompleted_work_amount:c.unfinished,extra_work_done:c.extra>0,extra_work_amount:c.extra};
}
const money=n=>Math.round(n*100)/100;
for(const [slug,action] of routes)for(const c of cases)test(`${slug}/${action}: ${c.name}, persisted and both role views agree`,async()=>{
 const {db,historical}=fixture(c.original);
 const r=await edge(slug,db)(body(action,c),'staff_m');
 assert.equal(r.status,200);const saved=db.tables.orders[0];
 assert.equal(saved.amount,c.base);assert.equal(saved.original_amount,c.original);
 assert.equal(saved.master_payout,c.payout);assert.equal(saved.extra_work_amount,c.extra);
 assert.equal(saved.manager_payout,c.manager);assert.equal(saved.dispatcher_payout,c.dispatcher);
 assert.equal(money(saved.master_payout+saved.extra_work_amount),c.total);
 assert.equal(r.body.order.master_payout,c.payout);
 for(const uid of ['100','staff_m']){
  const bootstrap=await edge('mini-app-api',db)({action:'bootstrap'},uid);
  assert.equal(bootstrap.status,200);const o=bootstrap.body.orders.find(x=>x.id==='new');
  assert.equal(o.master_payout,c.payout);assert.equal(money(o.master_payout+o.extra_work_amount),c.total);
 }
 assert.deepEqual(db.tables.orders[1],historical,'unrelated historical/manual payouts must not be written');
 if(slug==='order-lifecycle-api'){assert.equal(saved.status,'В работе');assert.equal(saved.report_review_status,'pending');assert.equal(saved.completed_at,null)}
});

test('reject, resubmit and approve retain one deduction and one extra payment',async()=>{
 const {db,historical}=fixture();let archived=0;
 const api=edge('order-lifecycle-api',db,{fetch:async()=>{archived++;return new Response(JSON.stringify({ok:true,order:{...db.tables.orders[0],drive_archive_status:'archived',drive_archive_url:'https://drive.test/archive'}}))}});
 const c=cases[1];assert.equal((await api(body('finalizeMasterReport',c),'staff_m')).status,200);
 assert.equal((await api({action:'reviewReport',id:'new',decision:'rejected',comment:'Добавьте фото'},'staff_d')).status,200);
 // Production rejection trigger clears report pointers. Model its post-trigger row here.
 Object.assign(db.tables.orders[0],{master_workflow_stage:'assigned',report_uploaded_at:null,report_act_url:null,report_photo_urls:'[]',report_upload_token:null,completed_at:null});
 assert.equal((await api(body('finalizeMasterReport',c,'report-2'),'staff_m')).status,200);
 assert.equal(db.tables.orders[0].amount,800);assert.equal(db.tables.orders[0].master_payout,442);assert.equal(db.tables.orders[0].extra_work_amount,300);
 assert.equal((await api({action:'reviewReport',id:'new',decision:'approved'},'staff_d')).status,200);
 assert.equal(archived,1);assert.equal(db.tables.orders[0].status,'Выполнена');
 assert.equal(money(db.tables.orders[0].master_payout+db.tables.orders[0].extra_work_amount),742);
 assert.deepEqual(db.tables.orders[1],historical);
});

for(const [slug,action] of routes)test(`${slug}/${action}: invalid money and another master cannot change payouts`,async()=>{
 for(const change of [{unfinished:1001},{unfinished:-1},{extra:-1},{extra:'Infinity'}]){
  const {db}=fixture();const before=structuredClone(db.tables.orders);
  assert.equal((await edge(slug,db)(body(action,{...cases[0],...change}),'staff_m')).status,400);
  assert.deepEqual(db.tables.orders,before);
 }
 const {db}=fixture();const before=structuredClone(db.tables.orders);
 assert.equal((await edge(slug,db)(body(action,cases[0]),'staff_other')).status,403);
 assert.deepEqual(db.tables.orders,before);
});
