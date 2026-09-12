(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  function getSession(){
    try{return sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}
  }
  function isLocalDev(){
    try{return !!window.BOS_LOCAL_DEV||/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname)&&!new URLSearchParams(location.search).has('force_vk_auth')}catch(_){return false}
  }
  let ensurePromise=null;
  async function ensureSessionBeforeApi(){
    if(isLocalDev()||getSession())return;
    if(typeof window.BOS_ENSURE_VK_SESSION!=='function')return;
    if(!ensurePromise)ensurePromise=Promise.resolve().then(()=>window.BOS_ENSURE_VK_SESSION()).finally(()=>{ensurePromise=null});
    await ensurePromise;
  }
  async function sessionApi(action,payload={}){
    const cfg=window.BUSINESS_OS_CONFIG||{};
    const url=cfg.API_URL||cfg.GAS_WEB_APP_URL;
    if(!url)return Promise.reject(new Error('Не настроен API'));
    await ensureSessionBeforeApi();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    const headers={'Content-Type':'application/json'};
    const session=getSession();
    if(session)headers['X-BOS-Session']=session;
    if(isLocalDev())headers['X-BOS-Local-Dev']='1';
    try{
      const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload}),signal:controller.signal});
      let d;
      try{d=await r.json()}catch(_){throw new Error('Сервер вернул неверный ответ')}
      if(!r.ok&&!d?.error)throw new Error('Ошибка сервера '+r.status);
      return d;
    }catch(e){
      if(e&&e.name==='AbortError')throw new Error('Сервер не ответил');
      throw e;
    }finally{clearTimeout(timer)}
  }
  window.api=sessionApi;
  try{api=sessionApi}catch(_){ }
  window.BOS_SESSION_API_READY=true;

  // Late compatibility layer for the live master dashboard. Several older
  // feature patches wrap pages.home; keep the compact profile while restoring
  // the role marker and salary summary expected by the production UI contract.
  if(typeof pages!=='undefined'&&pages?.home){
    const previousHome=pages.home;
    const masterNow=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview());
    const masterOrders=()=>{
      if(typeof ownOrders==='function'){try{return ownOrders()||[]}catch(_){}}
      const ids=new Set([state?.user?.id,state?.user?.vk_user_id,state?.user?.user_id,state?.user?.external_id].filter(Boolean).map(String));
      return (state?.orders||[]).filter(o=>[o.master_id,o.master_vk_id,o.master_user_id,o.master_external_id].filter(Boolean).map(String).some(id=>ids.has(id)));
    };
    const totalSalary=()=>masterOrders().filter(o=>String(o.status||'')==='Выполнена').reduce((sum,o)=>sum+Number(o.master_payout||0)+Number(o.extra_work_amount||0),0);
    pages.home=function(){
      const html=previousHome();
      if(!masterNow())return html;
      const s=String(html);
      const head=s.includes('КАБИНЕТ МАСТЕРА')?'':'<div class="eyebrow" style="margin:2px 0 10px">КАБИНЕТ МАСТЕРА</div>';
      const salary=s.includes('Общая зарплата')?'':`<section class="card masterSalarySummary"><div class="row"><span class="muted">Общая зарплата</span><strong>${money(totalSalary())}</strong></div></section>`;
      return `<div class="masterContractV42">${head}${html}${salary}</div>`;
    };
  }
})();