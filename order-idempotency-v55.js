(()=>{
  if(window.BOS_CREATE_ORDER_IDEMPOTENCY_V55||typeof window.api!=='function')return;
  const nextApi=window.api;
  window.BOS_CREATE_ORDER_IDEMPOTENCY_V55=true;
  window.api=function(action,payload={}){
    if(action==='createOrder'&&!payload.request_id){
      const form=document.querySelector('#orderForm');
      let requestId=form?.dataset?.requestId||'';
      if(!requestId){
        requestId=globalThis.crypto?.randomUUID?.()||('req_'+Date.now()+'_'+Math.random().toString(36).slice(2));
        if(form?.dataset)form.dataset.requestId=requestId;
      }
      payload={...payload,request_id:requestId};
    }
    return nextApi(action,payload);
  };
})();
