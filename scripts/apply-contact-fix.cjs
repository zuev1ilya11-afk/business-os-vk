// Temporary, exact-match patch driver for the isolated contact-fix branch.
const fs=require('node:fs');
function edit(file,changes){
 let text=fs.readFileSync(file,'utf8');
 for(const [before,after] of changes){
  if(text.includes(after))continue;
  if(text.split(before).length!==2)throw Error('Patch precondition failed: '+file+' / '+before.slice(0,90));
  text=text.replace(before,()=>after);
 }
 fs.writeFileSync(file,text);
}
edit('network-direct-v86.js',[
 ['  const REVIEW_DEADLINE_MS=90000;',`  const REVIEW_DEADLINE_MS=90000;
  const CONTACT_WRITE_DEADLINE_MS=20000;`],
 ["    const writeDeadline=review?REVIEW_DEADLINE_MS:reportFinalize?REPORT_FINALIZE_DEADLINE_MS:null;",`    const contactWrite=info.slug==='master-workflow-api'&&['recordContactAttempt','recordContactResult','markCalled','confirmAgreement','setAgreementSchedule'].includes(action);
    const writeDeadline=review?REVIEW_DEADLINE_MS:reportFinalize?REPORT_FINALIZE_DEADLINE_MS:contactWrite?CONTACT_WRITE_DEADLINE_MS:null;`],
 ["    const bootstrapWrite=(info.slug==='master-workflow-api'&&action==='setStage'&&init?.bosReconcileBeforeRetry===true)||(info.slug==='order-lifecycle-api'&&action==='reviewReport');", "    const bootstrapWrite=contactWrite||(info.slug==='master-workflow-api'&&action==='setStage'&&init?.bosReconcileBeforeRetry===true)||(info.slug==='order-lifecycle-api'&&action==='reviewReport');"]
]);
edit('master-call-workflow-v26.js',[
 ["modal.querySelector('#masterReportForm,#masterRescheduleForm')", "modal.querySelector('#masterReportForm,#masterRescheduleForm,#masterContactResultForm,#masterAgreementForm,#masterOrderAgree179Form')"],
 ["function clearPendingCall(){try{sessionStorage.removeItem('bosPendingClientCall')}catch(_){}}", "function clearPendingCall(attemptId=''){if(attemptId&&pendingCall()?.attempt_id!==attemptId)return;try{sessionStorage.removeItem('bosPendingClientCall')}catch(_){}}"],
 [`async function contactApi(action,id,payload={}){
 const r=await fetch(CONTACT_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload}),keepalive:true});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.ok||!d.order)throw new Error(d.error||'Не удалось сохранить результат звонка');
 mergeOrder(id,d.order);refreshMasterUi(id);return d;
}`,`const contactActor=()=>JSON.stringify([state?.user?.role,state?.user?.id,state?.user?.vk_user_id,state?.user?.external_id]);
async function contactApi(action,id,payload={}){
 const who=contactActor(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 let saved;
 try{
  const r=await fetch(CONTACT_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload}),keepalive:true,signal:controller.signal,bosReconcileBeforeRetry:true});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok||String(d.order?.id)!==String(id)){const error=new Error(d.error||'Не удалось сохранить результат звонка');error.status=r.ok?0:r.status;throw error}
  saved=d;
 }catch(error){
  // Never replay a business write. Read the exact attempt receipt after a lost response.
  if(action==='recordContactResult'&&who===contactActor()&&liveMaster()&&(!error.status||error.status>=500)&&typeof window.api==='function'){
   try{
    const data=await window.api('bootstrap');
    const order=data?.ok&&Array.isArray(data.orders)?data.orders.find(o=>String(o.id)===String(id)):null;
    const event=Array.isArray(order?.master_contact_history)?order.master_contact_history.find(x=>String(x?.id)===String(payload.attempt_id)):null;
    if(who===contactActor()&&liveMaster()&&event&&normalizeClientPhone(event.phone)===normalizeClientPhone(payload.phone)&&String(event.result)===String(payload.result)&&String(event.comment||'')===String(payload.comment||'')&&String(event.callback_at||'')===String(payload.callback_at||''))saved={ok:true,order,reconciled:true};
   }catch(_){}
  }
  if(!saved)throw error.name==='AbortError'?new Error('Ответ на сохранение не получен. Проверьте интернет и повторите проверку заявки.'):error;
 }finally{clearTimeout(timer)}
 if(who!==contactActor()||!liveMaster())throw new Error('Аккаунт изменился. Откройте заявку заново.');
 // A late phone-attempt response must not replace a newer saved call result.
 const current=findOrder(id),oldAt=Date.parse(current?.updated_at),newAt=Date.parse(saved.order.updated_at);
 if(!Number.isFinite(oldAt)||!Number.isFinite(newAt)||newAt>=oldAt)mergeOrder(id,saved.order);
 refreshMasterUi(id);return saved;
}`],
 ['<div class="bosContactResultChoices">${options}</div><label>Комментарий', '<div class="bosContactResultChoices">${options}</div><p class="bosContactSelection" role="status" aria-live="polite">Выберите итог звонка</p><label>Комментарий'],
 [` form.addEventListener('change',()=>{
  const result=String(form.elements.result?.value||'');
  submit.disabled=!result;
  callback.hidden=result!=='call_later';
 });
 form.querySelector('.bosContactLater').onclick=()=>{clearPendingCall();closeModal();window.openOrder?.(id)};`, ` let saving=false;
 const who=contactActor();
 function refreshForm(){
  const result=String(form.elements.result?.value||'');
  form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=saving);
  submit.disabled=saving||!result;
  form.setAttribute('aria-busy',String(saving));
  callback.hidden=result!=='call_later';
  form.querySelectorAll('.bosContactResultChoice').forEach(row=>row.classList.toggle('is-selected',row.querySelector('input').checked));
  const label=resultOptions().find(x=>x[0]===result)?.[1];
  form.querySelector('.bosContactSelection').textContent=label?'Выбрано: '+label:'Выберите итог звонка';
 }
 form.addEventListener('change',refreshForm);refreshForm();
 form.querySelector('.bosContactLater').onclick=()=>{if(saving)return;clearPendingCall(attemptId);closeModal();window.openOrder?.(id)};`],
 ["  event.preventDefault();if(sending)return;", "  event.preventDefault();if(sending||saving||who!==contactActor()||!liveMaster())return;"],
 ["  sending=true;submit.disabled=true;msg.textContent='Сохраняем…';", "  sending=true;saving=true;refreshForm();msg.textContent='Сохраняем…';"],
 [`   await recordContactResult(id,phone,attemptId,result,comment,callbackAt);clearPendingCall();closeModal();
   if(result==='agreed'&&typeof window.masterOrderAgree179==='function')setTimeout(()=>window.masterOrderAgree179(id),0);
   else setTimeout(()=>window.openOrder?.(id),0);
  }catch(error){msg.textContent=error?.message||String(error);submit.disabled=false}
  finally{sending=false}`,`   await recordContactResult(id,phone,attemptId,result,comment,callbackAt);clearPendingCall(attemptId);
   if(!form.isConnected||who!==contactActor())return;
   closeModal();
   if(result==='agreed'&&typeof window.masterOrderAgree179==='function')window.masterOrderAgree179(id);
   else window.openOrder?.(id);
  }catch(error){if(form.isConnected)msg.textContent=error?.message||String(error)}
  finally{sending=false;saving=false;if(form.isConnected)refreshForm()}`],
 ['.bosContactResultChoice input{margin-top:3px}',`#masterContactResultForm .bosContactResultChoice{grid-template-columns:22px minmax(0,1fr);gap:11px;min-height:60px;box-sizing:border-box;align-items:center;touch-action:manipulation}
#masterContactResultForm .bosContactResultChoice input[type="radio"]{-webkit-appearance:none!important;appearance:none!important;display:block!important;position:static!important;width:22px!important;height:22px!important;min-width:22px!important;max-width:22px!important;min-height:22px!important;max-height:22px!important;padding:0!important;margin:0!important;border:2px solid #8398b0!important;border-radius:50%!important;background:#0c1827!important;box-shadow:none!important;cursor:pointer}
#masterContactResultForm .bosContactResultChoice input[type="radio"]:checked{border-color:#72b7ff!important;background:radial-gradient(circle,#72b7ff 0 5px,#0c1827 6px)!important}
#masterContactResultForm .bosContactResultChoice.is-selected{border-color:#72b7ff;background:#14375a;box-shadow:inset 0 0 0 1px #72b7ff}
#masterContactResultForm .bosContactResultChoice:focus-within{outline:2px solid #9dccff;outline-offset:2px}
#masterContactResultForm .bosContactResultChoice span{min-width:0;overflow-wrap:anywhere}
#masterContactResultForm .bosContactSelection{font-size:13px;color:#9dccff;margin:0 0 8px}
#masterContactResultForm .bosContactCallback[hidden]{display:none!important}
#masterContactResultForm[aria-busy="true"] .bosContactResultChoice{cursor:wait}
#masterContactResultForm .bosContactResultChoice input:disabled{cursor:wait}`]
]);
edit('master-order-actions-v179.js',[
 ["const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);", "const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),['setAgreementSchedule','confirmAgreement'].includes(action)?25000:20000);"],
 [" const msg=form.querySelector('#masterOrderAgree179Msg'),contact=form.querySelector('.moa179AgreementContact'),submit=form.querySelector('[type=submit]');", ` const msg=form.querySelector('#masterOrderAgree179Msg'),contact=form.querySelector('.moa179AgreementContact'),submit=form.querySelector('[type=submit]');
 const actorKey=()=>JSON.stringify([state?.user?.role,state?.user?.id,state?.user?.vk_user_id,state?.user?.external_id]),who=actorKey();`],
 ["  e.preventDefault();if(busy||state.busy)return;", "  e.preventDefault();if(busy||state.busy||!liveMaster()||who!==actorKey())return;"],
 [`  try{const d=await api('setAgreementSchedule',id,{scheduled_date:date,scheduled_time:time});mergeOrder(id,d.order);closeModal();window.openOrder?.(id)}
  catch(err){msg.textContent=err?.message||String(err);if(typeof setBusy==='function')setBusy(form,false)}
  finally{busy=false;state.busy=false;refreshContact()}`,`  let saved=null;
  try{const d=await api('setAgreementSchedule',id,{scheduled_date:date,scheduled_time:time});if(String(d.order?.id)===String(id))saved=d.order}
  catch(err){
   if(form.isConnected)msg.textContent='Проверяем, сохранились ли дата и время…';
   if(who===actorKey()&&liveMaster()&&(!err.status||err.status>=500)&&typeof window.api==='function'){
    try{
     const data=await window.api('bootstrap');
     const fresh=data?.ok&&Array.isArray(data.orders)?data.orders.find(x=>String(x.id)===String(id)):null;
     if(fresh&&active(fresh)&&fresh.master_agreed_at&&dateOf(fresh)===date&&timeOf(fresh)===time)saved=fresh;
    }catch(_){}
   }
   if(!saved&&form.isConnected)msg.textContent=err?.name==='AbortError'?'Ответ на сохранение не получен. Проверьте интернет и повторите проверку заявки.':err?.message||String(err);
  }
  finally{busy=false;state.busy=false;if(form.isConnected){if(typeof setBusy==='function')setBusy(form,false);refreshContact()}}
  if(saved&&who===actorKey()&&liveMaster()){mergeOrder(id,saved);if(form.isConnected){closeModal();window.openOrder?.(id)}}`]
]);
