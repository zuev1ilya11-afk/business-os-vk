(()=>{
  const core=window.BOS_AUTH_CORE;
  if(!core)throw new Error('BOS auth core is not loaded');
  window.api=(action,payload={})=>core.api(action,payload);
  try{api=window.api}catch(_){ }
  window.BOS_SESSION_API_READY=true;
})();