const {test}=require('node:test');const assert=require('node:assert/strict');const {edge,database,employee}=require('./helpers/edge.cjs');const {workbook}=require('./helpers/lemana-xlsx.cjs');
const file=()=>({action:'previewLemanaImport',file_name:'synthetic.xlsx',file_base64:Buffer.from(workbook()).toString('base64'),timezone:'Europe/Moscow'});
const setup=()=>{const db=database({business_staff:[employee('owner','owner'),employee('m','master',{full_name:'Тестовый мастер'})]});return {db,api:edge('mini-app-api',db)}};
test('preview never writes; master is denied; signed preview cannot be changed or reused by another actor',async()=>{
 const {db,api}=setup();const p=await api(file());assert.equal(p.status,200);assert.equal(p.body.preview.counts.new,1);assert.equal(db.tables.orders.length,0);assert.equal(db.calls.some(c=>c.mode==='insert'||c.mode==='update'||c.rpc),false);
 db.tables.business_staff.push(employee('dispatcher','dispatcher'));const other=await api({action:'confirmLemanaImport',preview_token:p.body.preview_token,selected:[2]},'staff_dispatcher');assert.equal(other.status,400);
 const forbidden=await api(file(),'staff_m');assert.equal(forbidden.status,403);
 const tampered=await api({action:'confirmLemanaImport',preview_token:p.body.preview_token+'x',selected:[2]});assert.equal(tampered.status,400);
 const empty=await api({action:'confirmLemanaImport',preview_token:p.body.preview_token,selected:[]});assert.equal(empty.status,400);
 const arbitrary=await api({action:'confirmLemanaImport',preview_token:p.body.preview_token,selected:[999]});assert.equal(arbitrary.status,400);
 assert.equal(db.tables.orders.length,0);
});
test('confirm calls create-only atomic RPC with shared payout; no client supplied financial fields',async()=>{
 const {db,api}=setup();db.rpc=async(name,p)=>{assert.equal(name,'bos_import_lemana_order');assert.equal(p.p_actor,'owner');assert.equal(p.p_order.master_payout,552.5);assert.equal(p.p_order.external_id,'00042');return {data:{kind:'created',order:{id:'42',...p.p_order}},error:null}};
 const preview=await api(file());assert.equal(preview.status,200);const r=await api({action:'confirmLemanaImport',preview_token:preview.body.preview_token,selected:[2],amount:1,status:'Выполнена'});assert.equal(r.status,200);assert.equal(r.body.created,1);assert.equal(r.body.orders[0].amount,1000);assert.equal(r.body.orders[0].status,'Назначена');assert.equal(r.body.orders[0].master_vk_id,'staff_m');
});

test('oversized signed preview is rejected before offering confirmation',async()=>{
 const {api}=setup();const rows=Array.from({length:1000},(_,i)=>[String(i).padStart(6,'0'),'Тест','+79990000001','Я'.repeat(2000),'Категория',500,'20.10.2026','','','','Подтвержден','']);
 const r=await api({...file(),file_base64:Buffer.from(workbook(rows)).toString('base64')});assert.equal(r.status,400);assert.match(r.body.error,/Разделите/);assert.equal(r.body.preview_token,undefined);
});
