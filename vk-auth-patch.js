(()=>{
  const rawSearch=String(location.search||'').replace(/^\?/,'');
  const params=new URLSearchParams(rawSearch);
  const hasSignedVk=params.has('vk_app_id')&&params.has('vk_user_id')&&params.has('sign');
  const local=/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  window.BOS_VK_LAUNCH_PARAMS=hasSignedVk?rawSearch:'';
  window.BOS_LOCAL_DEV=local;

  function authedApi(action,payload={}){
    const url=cfg.API_URL||cfg.GAS_WEB_APP_URL;
    if(!url)return Promise.reject(new Error('Не настроен API'));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const headers={'Content-Type':'application/json'};
    if(window.BOS_VK_LAUNCH_PARAMS)headers['X-VK-Launch-Params']=window.BOS_VK_LAUNCH_PARAMS;
    if(local)headers['X-BOS-Local-Dev']='1';
    return fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload}),signal:controller.signal})
      .then(async r=>{let d;try{d=await r.json()}catch(_){throw new Error('Сервер вернул неверный ответ')}if(!r.ok&&!d?.error)throw new Error('Ошибка сервера '+r.status);return d})
      .catch(e=>{if(e&&e.name==='AbortError')throw new Error('Сервер не ответил');throw e})
      .finally(()=>clearTimeout(timer));
  }

  api=authedApi;

  const oldInit=init;
  init=async function(){
    try{
      if(!hasSignedVk&&!local){
        $('#roleBadge').textContent='Нет доступа';
        $('#content').innerHTML='<section class="hero"><h2>Откройте приложение во ВКонтакте</h2><p class="muted">Для входа нужна подтверждённая сессия VK.</p></section>';
        return;
      }
      $('#content').innerHTML='<section class="hero"><h2>Проверяем доступ…</h2><p class="muted">Авторизация через ВКонтакте</p></section>';
      await reloadData(false);
    }catch(e){
      state.busy=false;
      $('#content').innerHTML=`<section class="hero"><h2>Не удалось войти</h2><p class="muted">${esc(e.message)}</p><button class="primary" onclick="init()">Повторить</button></section>`;
    }
  };

  if(hasSignedVk){setTimeout(()=>init(),0)}
})();
