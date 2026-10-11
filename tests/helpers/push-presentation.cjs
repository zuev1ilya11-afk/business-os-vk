// Isolated browser/API fixtures for presentation only. No remote push service is contacted.
async function pushPresentation(page,state='default'){
 await page.evaluate(state=>{
  const present=state==='subscribed'||state==='denied-with-subscription';
  const permission=state.startsWith('denied')?'denied':state==='subscribed'?'granted':'default';
  const account=(sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||'').split('.')[0];
  const endpoint='https://fixture.invalid/push-device',binding='fixture-presentation-binding';
  window.Notification=function(){};Object.defineProperty(Notification,'permission',{value:permission});
  window.PushManager=function(){};
  const sub=present?{endpoint}:null;
  window.__pushPresentation={state,sub};
  localStorage.removeItem('bos_push_device_v1');
  const worker={postMessage:(data,ports)=>ports?.[0]?.postMessage({ok:true})};
  const reg={active:worker,pushManager:{getSubscription:async()=>{if(window.__pushPresentation.state==='unknown')throw Error('Device inspection unavailable');return window.__pushPresentation.sub}}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve(reg),getRegistration:async()=>reg,addEventListener(){}}});
  if(state==='unsupported')delete window.PushManager;
  if(state==='subscribed')localStorage.setItem('bos_push_device_v1',JSON.stringify({account,endpoint,binding_id:binding,updated_at:new Date().toISOString(),revoke_token:'fixture-only'}));
 },state);
 await page.route(/\/push-api(?:\?|$)/,async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-bos-session'}});
  const data=route.request().postDataJSON(),account=(route.request().headers()['x-bos-session']||'').split('.')[0];
  if(data.action!=='status')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Read-only presentation fixture'})});
  await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({ok:true,account,public_key:'BAE',connected:state==='subscribed',device:state==='subscribed'?{binding_id:'fixture-presentation-binding'}:null})});
 });
}
module.exports={pushPresentation};
