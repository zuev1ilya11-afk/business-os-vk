(()=>{
  const local=/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  window.BOS_LOCAL_DEV=local;
  window.BOS_VK_LAUNCH_PARAMS='';
  let launchPromise=null;

  function signed(raw){
    raw=String(raw||'').replace(/^\?/,'');
    const p=new URLSearchParams(raw);
    return p.has('vk_app_id')&&p.has('vk_user_id')&&p.has('sign')?raw:'';
  }
  function fromObject(obj){
    if(!obj||!obj.vk_app_id||!obj.vk_user_id||!obj.sign)return '';
    const p=new URLSearchParams();
    Object.keys(obj).filter(k=>k==='sign'||k.startsWith('vk_')).sort().forEach(k=>{
      const v=obj[k];if(v!==undefined&&v!==null)p.set(k,String(v));
    });
    return signed(p.toString());
  }
  function immediateLaunch(){
    let raw=signed(location.search);
    if(raw)return raw;
    const hash=String(location.hash||'');
    const q=hash.includes('?')?hash.slice(hash.indexOf('?')+1):hash.replace(/^#/,'');
    raw=signed(q);if(raw)return raw;
    try{const ref=new URL(document.referrer);raw=signed(ref.search);if(raw)return raw}catch(_){}
    return '';
  }
  async function bridgeLaunch(){
    const started=Date.now();
    while(Date.now()-started<2500){
      if(window.vkBridge&&typeof window.vkBridge.send==='function'){
        try{
          await window.vkBridge.send('VKWebAppInit',{}).catch(()=>{});
          const d=await window.vkBridge.send('VKWebAppGetLaunchParams',{});
          const raw=fromObject(d);if(raw)return raw;
        }catch(_){}
        break;
      }
      await new Promise(r=>setTimeout(r,100));
    }
    return '';
  }
  async function ensureLaunchParams(){
    if(window.BOS_VK_LAUNCH_PARAMS)return window.BOS_VK_LAUNCH_PARAMS;
    if(launchPromise)return launchPromise;
    launchPromise=(async()=>{
      let raw=immediateLaunch();
      if(!raw&&!local)raw=await bridgeLaunch();
      window.BOS_VK_LAUNCH_PARAMS=raw||'';
      return window.BOS_VK_LAUNCH_PARAMS;
    })().finally(()=>{launchPromise=null});
    return launchPromise;
  }
  window.BOS_ENSURE_VK_LAUNCH_PARAMS=ensureLaunchParams;

  async function authedApi(action,payload={}){
    const url=cfg.API_URL||cfg.GAS_WEB_APP_URL;
    if(!url)throw new Error('Не настроен API');
    const launch=await ensureLaunchParams();
    if(!launch&&!local)throw new Error('Не удалось получить данные запуска VK. Закройте Mini App и откройте его снова.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const headers={'Content-Type':'application/json'};
    if(launch)headers['X-VK-Launch-Params']=launch;
    if(local)headers['X-BOS-Local-Dev']='1';
    try{
      const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload}),signal:controller.signal});
      let d;try{d=await r.json()}catch(_){throw new Error('Сервер вернул неверный ответ')}
      if(!r.ok||d?.ok===false)throw new Error(d?.error||('Ошибка сервера '+r.status));
      return d;
    }catch(e){if(e&&e.name==='AbortError')throw new Error('Сервер не ответил');throw e}
    finally{clearTimeout(timer)}
  }
  api=authedApi;

  init=async function(){
    try{
      $('#content').innerHTML='<section class="hero"><h2>Проверяем доступ…</h2><p class="muted">Авторизация через ВКонтакте</p></section>';
      const launch=await ensureLaunchParams();
      if(!launch&&!local){
        $('#roleBadge').textContent='Нет доступа';
        $('#content').innerHTML='<section class="hero"><h2>Не удалось подтвердить вход</h2><p class="muted">Закройте Mini App и откройте его заново из ВКонтакте.</p><button class="primary" onclick="init()">Повторить</button></section>';
        return;
      }
      await reloadData(false);
    }catch(e){
      state.busy=false;
      $('#content').innerHTML=`<section class="hero"><h2>Не удалось войти</h2><p class="muted">${esc(e.message)}</p><button class="primary" onclick="init()">Повторить</button></section>`;
    }
  };

  // app-public.js starts once before this patch is loaded. Always re-run after
  // auth patch initialization so iOS VK WebView does not stay in an unauthenticated state.
  setTimeout(()=>init(),0);
})();