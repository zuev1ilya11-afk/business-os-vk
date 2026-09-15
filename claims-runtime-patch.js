claimsApi=async function(action,payload={}){const headers=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{'Content-Type':'application/json'};const r=await fetch('https://business-os-api-gateway.netlify.app/api/proxy/claims-api',{method:'POST',headers,body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));if(d?.session_token&&window.BOS_STORE_SESSION)window.BOS_STORE_SESSION(d.session_token);if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка сервера');return d};

// Compact management view for problem orders/claims. Full details remain in openClaimDetails().
claimCardHtml=function(c){
  const o=claimOrder(c),late=claimOverdue(c);
  const orderNo=o?.id??c.order_id;
  const status=c.status==='closed'?'Закрыта':late?'Просрочена':'Открыта';
  const date=c.scheduled_date?String(c.scheduled_date):'';
  const time=c.scheduled_time?String(c.scheduled_time).slice(0,5):'';
  const client=o?.client_name||o?.client||o?.customer_name||'';
  const amount=Number(o?.amount||0);
  const meta=[date,time,client,amount?money(amount):''].filter(Boolean).map(esc).join(' · ');
  return `<section class="card bos-claim-compact" onclick="openClaimDetails('${esc(c.id)}')" style="padding:10px 12px;margin-bottom:8px;cursor:pointer"><div class="row" style="gap:8px"><b>№${esc(orderNo)}</b><span class="status ${late?'danger':'info'}">${status}</span></div>${meta?`<div class="muted" style="margin-top:5px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</div>`:''}<div class="muted" style="margin-top:3px;font-size:13px">Мастер: ${esc(claimMasterName(c))}</div></section>`;
};