const {edge,database,employee,token}=require('./edge.cjs');
async function fullStack(page,role='owner'){
 const me=employee(role,role,{external_id:role==='owner'?'100':`staff_${role}`,city:'Санкт-Петербург'});
 const master=role==='master'?me:employee('m','master',{full_name:'Тестовый мастер',city:'Санкт-Петербург'});
 const db=database({business_staff:[me,...(role==='master'?[]:[master])],orders:[{id:'11',client:'Анна',address:'Невский 1',work:'Монтаж',status:'В работе',amount:1000,original_amount:1000,master_staff_id:master.id,master_name:master.full_name,master_payout:552.5,source:'VK',scheduled_date:'2099-09-10',master_workflow_stage:'assigned'},{id:'12',client:'Борис',address:'Другой адрес',work:'Шторы',status:'В работе',amount:2000,original_amount:2000,master_staff_id:null,source:'Авито',master_workflow_stage:'assigned'}]});
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
