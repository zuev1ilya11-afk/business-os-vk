(()=>{
  const touch=document.createElement('link');
  touch.rel='apple-touch-icon';
  touch.href='./app-icon.svg';
  document.head.appendChild(touch);

  const roleChrome=document.createElement('script');
  roleChrome.src='./role-chrome-v83.js?v=20260918-v83';
  roleChrome.async=false;
  document.head.appendChild(roleChrome);

  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
      .then(registration=>registration.update().catch(()=>{}))
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();
