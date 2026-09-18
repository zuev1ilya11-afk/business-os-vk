(()=>{
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
      .then(registration=>registration.update().catch(()=>{}))
      .catch(error=>console.warn('PWA service worker registration failed',error));
  });
})();
