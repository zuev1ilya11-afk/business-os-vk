const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('logout keeps the gate closed when an in-flight renewal replies',async({page})=>{
 await fullStack(page,'master');
 let release,started=false;
 const barrier=new Promise(resolve=>release=resolve);
 await page.route(/\/password-session-api(?:\?|$)/,async route=>{
  if(route.request().postDataJSON()?.action!=='refresh')return route.fallback();
  started=true;await barrier;
  await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,session_token:'late-refresh-token'})}).catch(()=>{});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#authGate')).toBeHidden();
 await expect.poll(()=>started).toBe(true);
 await page.evaluate(()=>{
  window.__auditPendingRefresh=window.BOS_REFRESH_SESSION();
  window.BOS_PROFILE_LOGOUT();
 });
 release();
 await page.evaluate(()=>window.__auditPendingRefresh);
 await expect(page.locator('#authGate')).toBeVisible();
 await expect(page.locator('#authGate')).toContainText('Вы вышли');
 expect(await page.evaluate(()=>({local:localStorage.getItem('bos_vk_session_v2'),session:sessionStorage.getItem('bos_vk_session_v2'),logout:localStorage.getItem('bos_manual_logout_v1')}))).toEqual({local:null,session:null,logout:'1'});
});
