(()=>{
  const touch=document.createElement('link');
  touch.rel='apple-touch-icon';
  touch.href='./app-icon.svg';
  document.head.appendChild(touch);

  const eagerScripts=[
    './role-chrome-v83.js?v=20260918-v83',
    './install-app-v84.js?v=20260918-v84',
    './master-reschedule-call-v87.js?v=20260922-v87c',
    './master-call-workflow-v26.js?v=20260922-v27',
    './dispatcher-desktop-v89.js?v=20260920-v89',
    './dispatcher-desktop-compat-v90.js?v=20260920-v90',
    './dispatcher-reschedule-v91.js?v=20260920-v91',
    './dispatcher-board-v92.js?v=20260920-v92',
    './dispatcher-board-compat-v93.js?v=20260920-v93',
    './dispatcher-board-v21.js?v=20260920-v21',
    './dispatcher-smart-assign-v22.js?v=20260920-v22',
    './dispatcher-board-v23.js?v=20260920-v23',
    './dispatcher-control-v24.js?v=20260920-v24',
    './notification-center-v26.js?v=20260921-v26',
    './employee-live-refresh-v27.js?v=20260922-v31',
    './ui-dispatch-master-v94.js?v=20260921-v94',
    './master-status-colors-v95.js?v=20260921-v95',
    './master-orders-filter-v99.js?v=20260922-v99',
    './management-order-delete-v100.js?v=20260922-v100',
    './unified-schedule-v102.js?v=20260923-v102',
    './new-order-card-v104.js?v=20260923-v104',
    './dispatcher-order-priority-v105.js?v=20260923-v105',
    './order-lifecycle-v106.js?v=20260923-v106',
    './dispatcher-order-workflow-v114.js?v=20260923-v114',
    './dispatcher-orders-v3.js?v=20260925-reassign',
    './master-upcoming-claims-v110.js?v=20260923-v111',
    './android-navigation-v112.js?v=20260923-v112',
    './session-refresh-v113.js?v=20260923-v113',
    './master-workflow-v115.js?v=20260923-v115',
    './master-workflow-v116.js?v=20260923-v116',
    './claims-role-v117.js?v=20260923-v117'
  ];

  eagerScripts.forEach(src=>{
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    document.head.appendChild(script);
  });

  const roleScripts={
    dispatcher:[
      './dispatcher-smart-assign-v119.js?v=20260923-v119',
      './dispatcher-free-slots-v120.js?v=20260923-v120',
      './dispatcher-smart-dispatch-v121.js?v=20260923-v121',
      './dispatcher-unassigned-queue-v122.js?v=20260924-v122',
      './dispatcher-attention-v123.js?v=20260924-v123'
    ],
    master:[
      './master-home-orders-v124.js?v=20260924-v124',
      './master-orders-v125.js?v=20260924-v125',
      './master-orders-v125-compat.js?v=20260924-v125b',
      './master-order-focus-v126.js?v=20260924-v126',
      './master-daily-home-v127.js?v=20260924-v127',
      './master-day-summary-v128.js?v=20260925-sync',
      './master-profile-summary-v129.js?v=20260924-v129',
      './master-money-v130.js?v=20260924-v130',
      './master-cabinet-v141.js?v=20260925-v141b'
    ]
  };
  const roleLoads=new Map();

  function loadRoleScript(src){
    if(roleLoads.has(src))return roleLoads.get(src);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src;
      script.async=false;
      script.onload=()=>resolve(src);
      script.onerror=()=>{roleLoads.delete(src);reject(new Error(`Не удалось загрузить модуль ${src}`))};
      document.head.appendChild(script);
    });
    roleLoads.set(src,promise);
    return promise;
  }
  async function loadList(list){for(const src of list)await loadRoleScript(src)}
  window.BOS_LOAD_ROLE_MODULES=async role=>{
    const value=String(role||'');
    if(value==='dispatcher')await loadList(roleScripts.dispatcher);
    else if(value==='master')await loadList(roleScripts.master);
    else if(value==='owner'||value==='manager'){
      await loadList(roleScripts.dispatcher);
      await loadList(roleScripts.master);
    }
    return true;
  };
  window.BOS_ROLE_MODULES_V171={dispatcher:roleScripts.dispatcher.length,master:roleScripts.master.length};

  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js?v=20260925-v167',{scope:'./',updateViaCache:'none'})
      .then(registration=>registration.update().catch(()=>{}))
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();