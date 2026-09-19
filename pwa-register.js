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

  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
      .then(registration=>registration.update().catch(()=>{}))
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();
