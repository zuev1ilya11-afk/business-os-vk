const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

function fixture(){
 return database({
  business_staff:[employee('m','master',{full_name:'Первый мастер'}),employee('owner','owner')],
  orders:[{id:'1',master_staff_id:'m',master_name:'Первый мастер',status:'В работе',master_workflow_stage:'assigned',amount:1000,original_amount:1000,source:'Hands',external_source:'hands',external_id:'hands:JOURNAL-1',phone:'+79990000002; +79990000003'}]
 });
}
test('attempt stores the exact number but is not a successful contact',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 const r=await api({action:'recordContactAttempt',id:'1',phone:'+79990000003',attempt_id:'attempt_two_001'},'staff_m');
 assert.equal(r.status,200);const o=db.tables.orders[0];
 assert.equal(o.master_called_at,undefined);assert.equal(o.master_contact_status,'pending');
 assert.deepEqual(o.master_contact_history.map(x=>[x.phone,x.result]),[['+79990000003','pending']]);
});
test('no answer remains unsuccessful; later client conversation creates first receipt',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000003',attempt_id:'attempt_no_answer'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000003',attempt_id:'attempt_no_answer',result:'no_answer',comment:'Не отвечает'},'staff_m')).status,200);
 assert.equal(db.tables.orders[0].master_called_at,undefined);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'attempt_delivery'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'attempt_delivery',result:'waiting_delivery',comment:'Ждёт доставку'},'staff_m')).status,200);
 const o=db.tables.orders[0];assert.ok(o.master_called_at);assert.equal(o.master_called_by_staff_id,'m');
 assert.deepEqual(o.master_contact_history.map(x=>[x.phone,x.result]),[['+79990000003','no_answer'],['+79990000002','waiting_delivery']]);
});
test('journal rejects a number outside the order and requires comment for other',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 assert.equal((await api({action:'recordContactAttempt',id:'1',phone:'+79990000999',attempt_id:'foreign_phone_01'},'staff_m')).status,400);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'other_result_01'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'other_result_01',result:'other',comment:''},'staff_m')).status,400);
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'other_result_01',result:'other',comment:'Нужно уточнить детали'},'staff_m')).status,200);
});

test('new journal blocks agreement until the result is agreed',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'thinking_gate_01'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'thinking_gate_01',result:'thinking',comment:'Клиент решает'},'staff_m')).status,200);
 db.tables.orders[0].scheduled_date='2099-09-10';db.tables.orders[0].scheduled_time='10:00';db.tables.orders[0].time_slot='10:00–11:00';
 assert.equal((await api({action:'confirmAgreement',id:'1'},'staff_m')).status,409);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'agreed_gate_02'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'agreed_gate_02',result:'agreed',comment:''},'staff_m')).status,200);
 assert.equal((await api({action:'confirmAgreement',id:'1'},'staff_m')).status,200);
});

test('a saved attempt cannot be moved to another phone',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 await api({action:'recordContactAttempt',id:'1',phone:'+79990000003',attempt_id:'immutable_phone_01'},'staff_m');
 assert.equal((await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'immutable_phone_01',result:'agreed'},'staff_m')).status,409);
 assert.equal(db.tables.orders[0].master_contact_history[0].phone,'+79990000003');
});
test('finishing an older pending call does not replace the latest attempt summary',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 for(const [id,phone] of [['old_pending_01','+79990000002'],['new_pending_02','+79990000003']])await api({action:'recordContactAttempt',id:'1',phone,attempt_id:id},'staff_m');
 await api({action:'recordContactResult',id:'1',phone:'+79990000003',attempt_id:'new_pending_02',result:'waiting_delivery',comment:'6 октября'},'staff_m');
 await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'old_pending_01',result:'agreed'},'staff_m');
 assert.equal(db.tables.orders[0].master_contact_status,'waiting_delivery');
 assert.equal((await api({action:'setAgreementSchedule',id:'1',scheduled_date:'2099-10-10',scheduled_time:'12:00'},'staff_m')).status,409);
});
for(const result of ['thinking','waiting_delivery','call_later','no_answer','other'])test(`${result} blocks both agreement endpoints`,async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);
 await api({action:'recordContactResult',id:'1',phone:'+79990000002',attempt_id:'status_gate_0001',result,comment:'Комментарий',callback_at:'2099-10-10T10:00:00Z'},'staff_m');
 Object.assign(db.tables.orders[0],{scheduled_date:'2099-10-10',scheduled_time:'12:00'});
 for(const action of ['confirmAgreement','setAgreementSchedule'])assert.equal((await api({action,id:'1',scheduled_date:'2099-10-10',scheduled_time:'12:00'},'staff_m')).status,409);
 if(result==='call_later')assert.equal(db.tables.orders[0].master_contact_callback_at,'2099-10-10T10:00:00.000Z');
 if(result==='thinking')assert.ok(db.tables.orders[0].master_called_at);
});
test('history stores and exposes the last 50 attempts and rejects other actors',async()=>{
 const db=fixture(),api=edge('master-workflow-api',db);db.tables.business_staff.push(employee('other','master'));
 for(const uid of ['100','staff_other'])assert.equal((await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'unauthorized_01'},uid)).status,403);
 for(let i=0;i<52;i++)await api({action:'recordContactAttempt',id:'1',phone:'+79990000002',attempt_id:'attempt_history_'+i},'staff_m');
 const o=db.tables.orders[0];assert.equal(o.master_contact_history.length,50);assert.equal(o.master_contact_history[0].id,'attempt_history_2');
 const html=require('../contact-status.js').html(o,{details:true});assert.equal((html.match(/class="bosContactEvent /g)||[]).length,50);
});
