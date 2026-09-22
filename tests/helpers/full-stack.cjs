const {edge,database,employee,token}=require('./edge.cjs');
async function fullStack(page,role='owner'){
 const me=employee(role,role,{external_id:role==='owner'?'100':`staff_${role}`,city:'Санкт-Петербург'});
 const master=role==='master'?me:employee('m','master',{full_name:'Тестовый мастер',city:'Санкт-Петербург'});
 const db=database({business_staff:[me,...(role==='master'?[]:[master])],orders:[{id:'11',client:'Анна',address:'Невский 1',work:'Монтаж',status:'В работе',amount:1000,original_amount:1000,master_staff_id:master.id,master_name:master.full_name,master_payout:552.5,source:'VK',scheduled_date:'2099-09-10',master_workflow_stage:'assigned'},{id:'12',client:'Борис',address:'Другой адрес',work:'Шторы',status:'В работе',amount:2000,original_amount:2000,master_staff_id:null,source:'Авито',master_workflow_stage:'assigned'}]});
 // Model the existing SQL BEFORE UPDATE trigger, which the in-memory DB does not execute.
 // See 20260922104500_master_workflow_profile_bridge.sql.
 db.beforeUpdate=(table,staff,patch)=>{
  // The reschedule bridge likewise persists requests before bootstrap refreshes.
  if(table==='business_staff'&&String(patch.district||'').startsWith('@@BOS_R1@@|')){
   const [,id,reason]=patch.district.match(/^@@BOS_R1@@\|(\d+)\|([\s\S]*)$/)||[];
   const order=db.tables.orders.find(o=>String(o.id)===id&&o.master_staff_id===staff.id&&!['Выполнена','Отменена'].includes(o.status));
   if(staff.role!=='master'||!order||!reason||reason.trim().length<3||reason.trim().length>80)throw new Error('Invalid reschedule request');
   const now=new Date().toISOString();
   Object.assign(order,{reschedule_requested:true,reschedule_reason:reason.trim(),reschedule_requested_at:now,reschedule_requested_by:staff.id,updated_at:now});
   patch.district=staff.district;
   return patch;
  }
  const marker='@@BOS_WF1@@|';
  if(table!=='business_staff'||!String(patch.district||'').startsWith(marker))return patch;
  const [id,stage]=patch.district.slice(marker.length).split('|');
  if(staff.role!=='master'||!/^\d+$/.test(id)||!['departed','started'].includes(stage))throw new Error('Invalid workflow request');
  const order=db.tables.orders.find(o=>String(o.id)===id&&o.master_staff_id===staff.id&&!['Выполнена','Отменена'].includes(o.status));
  if(!order)throw new Error('Order unavailable to master');
  const current=order.master_workflow_stage==='arrived'?'departed':(['assigned','departed','started'].includes(order.master_workflow_stage)?order.master_workflow_stage:'assigned');
  if(stage!==current){
   if(!((current==='assigned'&&stage==='departed')||(current==='departed'&&stage==='started')))throw new Error('Invalid workflow transition');
   const now=new Date().toISOString(),time=stage==='departed'?'master_departed_at':'master_started_at';
   Object.assign(order,{master_workflow_stage:stage,[time]:order[time]||now,updated_at:now,sync_status:'pending_sheet'});
  }
  patch.district=staff.district;
  return patch;
 };
 const handlers={};for(const s of ['mini-app-api','staff-admin-api','claims-api','profile-self-api','employee-meta-api','master-memo-api','order-meta-api','report-api','master-workflow-api'])handlers[s]=edge(s,db);
 await page.addInitScript(t=>localStorage.setItem('bos_vk_session_v2',t),token(me.external_id));
 await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
 await page.route(/https:\/\/.*(?:api\/proxy|functions\/v1)\/[^/?]+/,async r=>{
  const slug=r.request().url().split('/').pop();const h=handlers[slug];
  if(!h)return r.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"unsupported test service"}'});
  const result=await h(r.request().postDataJSON()||{},me.external_id,r.request().headers()['x-bos-session']||'');
  await r.fulfill({status:result.status,contentType:'application/json',body:JSON.stringify(result.body)});
 });
 return {db,me,master};
}
module.exports={fullStack};
