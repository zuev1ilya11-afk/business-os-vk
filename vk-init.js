(function(){
  function sendInit(){
    try{
      if(window.vkBridge&&typeof window.vkBridge.send==='function'){
        window.vkBridge.send('VKWebAppInit',{}).catch(function(){});
        return;
      }
      if(window.AndroidBridge&&typeof window.AndroidBridge.VKWebAppInit==='function'){
        window.AndroidBridge.VKWebAppInit(JSON.stringify({}));
        return;
      }
      if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.VKWebAppInit&&typeof window.webkit.messageHandlers.VKWebAppInit.postMessage==='function'){
        window.webkit.messageHandlers.VKWebAppInit.postMessage({});
        return;
      }
      if(window.ReactNativeWebView&&typeof window.ReactNativeWebView.postMessage==='function'){
        window.ReactNativeWebView.postMessage(JSON.stringify({handler:'VKWebAppInit',params:{}}));
        return;
      }
      if(window.parent&&window.parent!==window&&typeof window.parent.postMessage==='function'){
        window.parent.postMessage({handler:'VKWebAppInit',params:{},type:'vk-connect',connectVersion:'2.14.0'},'*');
      }
    }catch(_){ }
  }
  sendInit();
  document.addEventListener('DOMContentLoaded',sendInit,{once:true});
  setTimeout(sendInit,300);
  setTimeout(sendInit,1200);
})();
