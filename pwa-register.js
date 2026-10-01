(()=>{
  const touch=document.createElement('link');
  touch.rel='apple-touch-icon';
  touch.href='./app-icon.svg';
  document.head.appendChild(touch);

  const eagerScripts=[
    './role-chrome-v83.js',
    './install-app-v84.js',
    './master-reschedule-call-v87.js',
    './master-call-workflow-v26.js',
    './dispatcher-desktop-v89.js',
    './dispatcher-desktop-compat-v90.js',
    './dispatcher-reschedule-v91.js',
    './dispatcher-board-v92.js',
    './dispatcher-board-compat-v93.js',
    './dispatcher-board-v21.js',
    './dispatcher-smart-assign-v22.js',
    './dispatcher-board-v23.js',
    './dispatcher-control-v24.js',
    './notification-center-v26.js',
    './web-push-v211.js',
    './order-control-tasks.js',
    './employee-live-refresh-v27.js',
    './ui-dispatch-master-v94.js',
    './master-status-colors-v95.js',
    './master-orders-filter-v99.js',
    './management-order-delete-v100.js',
    './unified-schedule-v102.js',
    './new-order-card-v104.js',
    './dispatcher-order-priority-v105.js',
    './order-lifecycle-v106.js',
    './dispatcher-order-workflow-v114.js',
    './dispatcher-orders-v3.js',
    './master-upcoming-claims-v110.js',
    './android-navigation-v112.js',
    './session-refresh-v113.js',
    './master-workflow-v115.js',
    './master-workflow-v116.js',
    './master-order-actions-v179.js',
    './claims-role-v117.js'
  ];

  eagerScripts.forEach(src=>{
    if([...document.scripts].some(script=>script.src===window.BOS_ASSET_URL(src)))return;
    const script=document.createElement('script');
    script.src=window.BOS_ASSET_URL(src);
    script.async=false;
    document.head.appendChild(script);
  });

  const roleScripts={
    dispatcher:[
      './dispatcher-smart-assign-v119.js',
      './dispatcher-free-slots-v120.js',
      './dispatcher-smart-dispatch-v121.js',
      './dispatcher-unassigned-queue-v122.js',
      './dispatcher-attention-v123.js',
      './order-control.js',
      './dispatcher-ui-redesign-v183.js',
      './dispatcher-ui-redesign-v183-compat.js',
      './dispatcher-ui-polish-v184.js',
      './dispatcher-ui-stability-v185.js',
      './dispatcher-unified-schedule-v187.js',
      './dispatcher-horizontal-schedule-v190.js',
      './dispatcher-horizontal-schedule-v190-fix.js'
    ],
    master:[
      './master-home-orders-v124.js',
      './master-orders-v125.js',
      './master-orders-v125-compat.js',
      './master-order-focus-v126.js',
      './master-daily-home-v127.js',
      './master-day-summary-v128.js',
      './master-profile-summary-v129.js',
      './salary-periods.js',
      './master-money-v130.js',
      './master-cabinet-v141.js'
    ]
  };
  const roleLoads=new Map();

  function loadRoleScript(src){
    if(roleLoads.has(src))return roleLoads.get(src);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=window.BOS_ASSET_URL(src);
      script.async=false;
      script.onload=()=>resolve(src);
      script.onerror=()=>{roleLoads.delete(src);reject(new Error(`Не удалось загрузить модуль ${src}`))};
      document.head.appendChild(script);
    });
    roleLoads.set(src,promise);
    return promise;
  }
  // async=false preserves execution order while every download starts together.
  async function loadList(list){await Promise.all(list.map(loadRoleScript))}
  window.BOS_LOAD_ROLE_MODULES=async role=>{
    const value=String(role||'');
    const list=[];
    if(window.BOS_PERMISSIONS.canUseDispatcherWorkspace({role:value}))list.push(...roleScripts.dispatcher);
    if(['master','owner','manager'].includes(value))list.push(...roleScripts.master);
    await loadList(list);
    return true;
  };
  window.BOS_ROLE_MODULES_V171={dispatcher:roleScripts.dispatcher.length,master:roleScripts.master.length};
  window.BOS_ROLE_MODULES_V183=window.BOS_ROLE_MODULES_V171;
  window.BOS_ROLE_MODULES_V185=window.BOS_ROLE_MODULES_V171;
  window.BOS_ROLE_MODULES_V186=window.BOS_ROLE_MODULES_V171;
  window.BOS_ROLE_MODULES_V187=window.BOS_ROLE_MODULES_V171;
  window.BOS_ROLE_MODULES_V190=window.BOS_ROLE_MODULES_V171;

  const loadAfterLegacyUnlock=()=>{
    if(!document.body.classList.contains('bos-auth-ok'))return;
    let role='';
    try{role=typeof state!=='undefined'?String(state?.user?.role||''):''}catch(_){}
    if(role)window.BOS_LOAD_ROLE_MODULES(role).catch(error=>console.warn('Role module fallback failed',error));
  };
  new MutationObserver(loadAfterLegacyUnlock).observe(document.body,{attributes:true,attributeFilter:['class']});
  loadAfterLegacyUnlock();

  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
      .then(registration=>{window.BOS_WATCH_UPDATE(registration);return registration.update().catch(()=>{})})
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();