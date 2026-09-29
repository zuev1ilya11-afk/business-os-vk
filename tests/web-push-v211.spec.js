const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {token}=require('./helpers/edge.cjs');
const endpoint='https://fcm.googleapis.com/fcm/send/browser-device-v211';
const binding='b1111111-1111-4111-8111-111111111111';
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
async function setup(page,role='owner',options={}){
 const base=await fullStack(page,role);const requests=[];let device=null;
 await page.addInitScript(({endpoint,binding,permission,ios})=>{
  const p=window.__push={permission:permission||'default',nextPermission:'granted',calls:[],messages:[],subscription:null,listeners:[],permissionGestures:[]};
  if(ios){Object.defineProperty(navigator,'userAgent',{value:'iPhone'});Object.defineProperty(navigator,'standalone',{value:false})}
  window.Notification=function(){};
  Object.defineProperty(Notification,'permission',{get:()=>p.permission});
  Notification.requestPermission=()=>{p.permissionGestures.push(navigator.userActivation.isActive);p.permission=p.nextPermission;return Promise.resolve(p.permission)};
  window.PushManager=function(){};
  const sub={endpoint,toJSON:()=>({endpoint,keys:{p256dh:btoa(String.fromCharCode(4)+String.fromCharCode(1).repeat(64)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),auth:btoa(String.fromCharCode(2).repeat(16)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}}),unsubscribe:async()=>{p.calls.push('unsubscribe');p.subscription=null;return true}};
  const worker={scriptURL:location.origin+'/sw.js',state:'activated',postMessage:(data,ports)=>{
   p.messages.push(data);if(data.type==='BOS_GET_BUILD')ports?.[0]?.postMessage({build:window.BOS_BUILD?.id});
   else if(data.type==='BOS_PUSH_BIND'||data.type==='BOS_PUSH_CLEAR')ports?.[0]?.postMessage({ok:true});
  }};
  const reg={scope:location.origin+'/',active:worker,installing:null,waiting:null,addEventListener(){},update:async()=>reg,pushManager:{getSubscription:async()=>p.subscription,subscribe:async config=>{p.calls.push('subscribe');p.subscribeConfig={userVisibleOnly:config.userVisibleOnly,keyBytes:config.applicationServerKey.length};p.subscription=sub;return sub}}};
  Object.defineProperty(navigator,'serviceWorker',{value:{ready:Promise.resolve(reg),controller:worker,register:async()=>reg,addEventListener:(name,fn)=>{if(name==='message')p.listeners.push(fn)}}});
  p.emit=data=>p.listeners.forEach(fn=>fn({data}));
 },{endpoint,binding,permission:options.permission,ios:options.ios});
 await page.route(/\/push-api(?:\?|$)/,async route=>{
  const data=route.request().postDataJSON(),account=(route.request().headers()['x-bos-session']||'').split('.')[0];requests.push({data,account});
  if(options.delaySubscribe&&data.action==='subscribe')await options.delaySubscribe();
  let result={ok:true};
  if(data.action==='status')result={ok:true,account,public_key:publicKey,connected:!!device?.active&&device.account===account&&data.endpoint===endpoint,device:device?.active&&device.account===account?device:null};
  if(data.action==='subscribe'){device={id:'d1111111-1111-4111-8111-111111111111',binding_id:binding,account,active:true,expires_at:new Date(Date.now()+86400000).toISOString()};result={ok:true,account,device}}
  if(data.action==='revoke'){if(device)device.active=false}
  if(data.action==='test')result={ok:true,queued:true};
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>!!window.BOS_PUSH);
 return {...base,requests,get device(){return device}};
}
async function settings(page){await page.evaluate(()=>BOS_PUSH.open());await expect(page.locator('#bosPushEnable')).toBeEnabled()}
async function connect(page){await settings(page);await page.locator('#bosPushEnable').click();await expect(page.locator('#bosPushTest')).toBeVisible()}
test('push v211: opt-in, real gesture, server subscription, test queue and disable',async({page})=>{
 const f=await setup(page);expect(await page.evaluate(()=>__push.permissionGestures)).toEqual([]);expect(f.requests.some(x=>x.data.action==='subscribe')).toBe(false);
 await connect(page);expect(await page.evaluate(()=>__push.permissionGestures)).toEqual([true]);expect(await page.evaluate(()=>__push.subscribeConfig)).toEqual({userVisibleOnly:true,keyBytes:65});
 expect(f.requests.find(x=>x.data.action==='subscribe').account).toBe('100');
 await page.locator('#bosPushTest').click();await expect(page.locator('#bosPushMessage')).toContainText('Тест поставлен в очередь');expect(f.requests.some(x=>x.data.action==='test')).toBe(true);
 await page.locator('#bosPushDisable').click();await expect(page.locator('#bosPushEnable')).toBeVisible();expect(f.requests.some(x=>x.data.action==='revoke')).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('bos_push_device_v1'))).toBeNull();expect(await page.evaluate(()=>__push.calls)).toContain('unsubscribe');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
test('push v211: denied permission has no subscription or fake success',async({page})=>{
 const f=await setup(page);await settings(page);await page.evaluate(()=>__push.nextPermission='denied');await page.locator('#bosPushEnable').click();await expect(page.locator('#bosPushMessage')).toContainText('Разрешение не получено');expect(f.requests.some(x=>x.data.action==='subscribe')).toBe(false);await expect(page.locator('#bosPushTest')).toBeHidden();
});
test('push v211: iPhone browser explains Home Screen installation instead of asking permission',async({page})=>{
 await setup(page,'owner',{ios:true});await page.evaluate(()=>BOS_PUSH.open());await expect(page.locator('#bosPushMessage')).toContainText('На экран Домой');await expect(page.locator('#bosPushEnable')).toBeDisabled();expect(await page.evaluate(()=>__push.permissionGestures.length)).toBe(0);
});
test('push v211: unsupported browser is explicit',async({page})=>{
 await setup(page);await page.evaluate(()=>delete window.PushManager);await page.evaluate(()=>BOS_PUSH.open());await expect(page.locator('#bosPushMessage')).toContainText('может не поддерживать');await expect(page.locator('#bosPushEnable')).toBeDisabled();
});
test('push v211: logout clears local binding, unsubscribes and queues capability revocation',async({page})=>{
 const f=await setup(page);await connect(page);await page.evaluate(()=>BOS_PROFILE_LOGOUT());await expect(page.locator('#authGate')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>__push.messages.filter(m=>m.type==='BOS_PUSH_CLEAR').length)).toBeGreaterThan(0);
 await expect.poll(()=>f.requests.filter(x=>x.data.action==='revoke').length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>localStorage.getItem('bos_push_device_v1'))).toBeNull();expect(await page.evaluate(()=>__push.calls)).toContain('unsubscribe');
});
test('push v211: logout while server subscribe is in flight cannot rebind old account',async({page})=>{
 let release;const barrier=new Promise(r=>release=r);const f=await setup(page,'owner',{delaySubscribe:()=>barrier});await settings(page);await page.locator('#bosPushEnable').click();
 await expect.poll(()=>f.requests.some(x=>x.data.action==='subscribe')).toBe(true);await page.evaluate(()=>BOS_PROFILE_LOGOUT());release();
 await expect.poll(()=>f.requests.some(x=>x.data.action==='revoke')).toBe(true);expect(await page.evaluate(()=>localStorage.getItem('bos_push_device_v1'))).toBeNull();
 expect(await page.evaluate(()=>__push.messages.filter(m=>m.type==='BOS_PUSH_BIND').length)).toBe(0);
});
test('push v211: role preview never changes subscription recipient',async({page})=>{
 const f=await setup(page);await page.evaluate(()=>{state.user={...state.user,role:'master',vk_user_id:'staff_other'}});await connect(page);expect(f.requests.find(x=>x.data.action==='subscribe').account).toBe('100');
});
test('push v211: profile entry appears exactly once without idle mutations',async({page})=>{
 await setup(page);await page.evaluate(()=>openOwnerProfile());const entry=page.locator('[data-bos-push-entry]');await expect(entry).toHaveCount(1);await entry.getByRole('button').click();await expect(page.locator('#bosPushMessage')).toBeVisible();
 await expect(page.locator('[data-bos-push-entry]')).toHaveCount(0);
 await page.evaluate(()=>{window.__pushMutations=0;new MutationObserver(list=>window.__pushMutations+=list.length).observe(document.querySelector('#modalRoot'),{childList:true,subtree:true});});
 await page.waitForTimeout(150);const before=await page.evaluate(()=>__pushMutations);await page.waitForTimeout(500);expect(await page.evaluate(()=>__pushMutations)).toBe(before);
});
test('push v211: an old tab cannot revoke another account\'s shared binding',async({page})=>{
 const f=await setup(page);await connect(page);const revokes=f.requests.filter(x=>x.data.action==='revoke').length;
 await page.evaluate(newToken=>{sessionStorage.setItem('bos_vk_session_v2',localStorage.getItem('bos_vk_session_v2'));localStorage.setItem('bos_vk_session_v2',newToken);localStorage.setItem('bos_push_device_v1',JSON.stringify({account:'staff_other',endpoint:'https://fcm.googleapis.com/fcm/send/other-device',binding_id:'c1111111-1111-4111-8111-111111111111',revoke_token:'e'.repeat(43)}));window.dispatchEvent(new StorageEvent('storage',{key:'bos_vk_session_v2'}));},token('staff_other'));
 await page.waitForTimeout(200);expect(f.requests.filter(x=>x.data.action==='revoke').length).toBe(revokes);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bos_push_device_v1')).account)).toBe('staff_other');
});
test('push v211: click refreshes authorization and refuses unavailable order',async({page})=>{
 await setup(page,'master');await connect(page);await page.evaluate(()=>{closeModal();__push.emit({type:'BOS_PUSH_OPEN',order_id:'999999',binding_id:'b1111111-1111-4111-8111-111111111111'})});await expect(page.getByRole('heading',{name:'Заявка недоступна'})).toBeVisible();
});
