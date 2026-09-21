(()=>{
  const touch=document.createElement('link');
  touch.rel='apple-touch-icon';
  touch.href='./app-icon.svg';
  document.head.appendChild(touch);

  const roleChrome=document.createElement('script');
  roleChrome.src='./role-chrome-v83.js?v=20260918-v83';
  roleChrome.async=false;
  document.head.appendChild(roleChrome);

  const installApp=document.createElement('script');
  installApp.src='./install-app-v84.js?v=20260918-v84';
  installApp.async=false;
  document.head.appendChild(installApp);

  const masterRescheduleCall=document.createElement('script');
  masterRescheduleCall.src='./master-reschedule-call-v87.js?v=20260919-v87';
  masterRescheduleCall.async=false;
  document.head.appendChild(masterRescheduleCall);

  const masterCallWorkflow=document.createElement('script');
  masterCallWorkflow.src='./master-call-workflow-v26.js?v=20260921-v26';
  masterCallWorkflow.async=false;
  document.head.appendChild(masterCallWorkflow);

  const dispatcherDesktop=document.createElement('script');
  dispatcherDesktop.src='./dispatcher-desktop-v89.js?v=20260920-v89';
  dispatcherDesktop.async=false;
  document.head.appendChild(dispatcherDesktop);

  const dispatcherDesktopCompat=document.createElement('script');
  dispatcherDesktopCompat.src='./dispatcher-desktop-compat-v90.js?v=20260920-v90';
  dispatcherDesktopCompat.async=false;
  document.head.appendChild(dispatcherDesktopCompat);

  const dispatcherReschedule=document.createElement('script');
  dispatcherReschedule.src='./dispatcher-reschedule-v91.js?v=20260920-v91';
  dispatcherReschedule.async=false;
  document.head.appendChild(dispatcherReschedule);

  const dispatchBoard=document.createElement('script');
  dispatchBoard.src='./dispatcher-board-v92.js?v=20260920-v92';
  dispatchBoard.async=false;
  document.head.appendChild(dispatchBoard);

  const dispatchBoardCompat=document.createElement('script');
  dispatchBoardCompat.src='./dispatcher-board-compat-v93.js?v=20260920-v93';
  dispatchBoardCompat.async=false;
  document.head.appendChild(dispatchBoardCompat);

  const dispatchBoardV21=document.createElement('script');
  dispatchBoardV21.src='./dispatcher-board-v21.js?v=20260920-v21';
  dispatchBoardV21.async=false;
  document.head.appendChild(dispatchBoardV21);

  const dispatcherSmartAssign=document.createElement('script');
  dispatcherSmartAssign.src='./dispatcher-smart-assign-v22.js?v=20260920-v22';
  dispatcherSmartAssign.async=false;
  document.head.appendChild(dispatcherSmartAssign);

  const dispatchBoardV23=document.createElement('script');
  dispatchBoardV23.src='./dispatcher-board-v23.js?v=20260920-v23';
  dispatchBoardV23.async=false;
  document.head.appendChild(dispatchBoardV23);

  const dispatchControlV24=document.createElement('script');
  dispatchControlV24.src='./dispatcher-control-v24.js?v=20260920-v24';
  dispatchControlV24.async=false;
  document.head.appendChild(dispatchControlV24);

  const notificationCenterV26=document.createElement('script');
  notificationCenterV26.src='./notification-center-v26.js?v=20260921-v26';
  notificationCenterV26.async=false;
  document.head.appendChild(notificationCenterV26);

  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
      .then(registration=>registration.update().catch(()=>{}))
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();
