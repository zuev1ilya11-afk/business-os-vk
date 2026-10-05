const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {edge,database,employee,secret,token,attachmentUrl}=require('./helpers/edge.cjs');
const now=()=>Math.floor(Date.now()/1000);
function launch(uid,ts){
  const p=new URLSearchParams({vk_app_id:'54758847',vk_user_id:uid});
  if(ts!==undefined)p.set('vk_ts',String(ts));
  const canonical=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  p.set('sign',createHmac('sha256',secret).update(canonical).digest('base64url'));
  return p.toString();
}
function setup(slug){
  const uid=slug==='avito-api'?'100':'200';
  const me=employee('actor',slug==='avito-api'?'owner':'master',{external_id:uid});
  const order={id:'1',master_staff_id:'actor',status:'В работе',report_review_status:'',master_workflow_stage:'started'};
  if(slug==='report-api')Object.assign(order,{status:'Выполнена',report_review_status:'approved',report_upload_token:'receipt',report_uploaded_at:'2026-10-01'});
  const db=database({business_staff:[me],orders:[order],avito_connections:[]});
  let uploads=0;
  db.storage={from:()=>({upload:async()=>{uploads++;return {error:null}},createSignedUrl:async()=>({error:null,data:{signedUrl:attachmentUrl('1','receipt')}})})};
  const api=edge(slug,db);
  let body;
  if(slug==='avito-api')body={action:'status'};
  else if(slug==='profile-self-api')body={action:'presence'};
  else if(slug==='report-api')body={action:'finalizeMasterReport',order_id:'1',upload_token:'receipt'};
  else {body=new FormData();body.set('order_id','1');body.set('upload_token','receipt');body.set('file_kind','act');body.set('file',new File(['synthetic'], 'act.pdf',{type:'application/pdf'}));}
  return {db,uid,uploads:()=>uploads,call:(ts,session='')=>api(body,uid,session,{'x-vk-launch-params':launch(uid,ts)})};
}
for(const slug of ['avito-api','profile-self-api','report-api','report-file-upload']){
  for(const [name,ts] of [['old',()=>now()-86401],['missing',()=>undefined],['zero',()=>0],['NaN',()=> 'NaN'],['infinite',()=> 'Infinity'],['fractional',()=>now()+0.5],['far future',()=>now()+86401]])test(`${slug} rejects ${name} signed launch before data access`,async()=>{
    const x=setup(slug),r=await x.call(ts());
    assert.equal(r.status,401);assert.equal(r.body.ok,false);assert.equal(r.body.session_token,undefined);
    assert.equal(x.db.calls.length,0);assert.equal(x.uploads(),0);
  });
  for(const delta of [0,-86399,86399])test(`${slug} preserves valid launch inside existing 24h window (${delta})`,async()=>{
    const x=setup(slug),r=await x.call(now()+delta);assert.equal(r.status,200);assert.equal(r.body.ok,true);
    if(slug==='report-api')assert.ok(r.body.session_token);
  });
  test(`${slug} existing BOS session does not depend on stale launch timestamp`,async()=>{
    const x=setup(slug),r=await x.call(1,token(x.uid));assert.equal(r.status,200);assert.equal(r.body.ok,true);
  });
  test(`${slug} rejects a fresh launch with a forged signature`,async()=>{
    const x=setup(slug),api=edge(slug,x.db);
    const payload=slug==='report-api'?{action:'finalizeMasterReport'}:{};
    const r=await api(payload,x.uid,'',{'x-vk-launch-params':launch(x.uid,now())+'x'});
    assert.equal(r.status,401);assert.equal(x.db.calls.length,0);
  });
}
