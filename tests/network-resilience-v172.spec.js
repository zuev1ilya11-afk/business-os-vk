const {test,expect}=require('@playwright/test');

const PRIMARY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
const BACKUP='https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew';
const NETLIFY='https://business-os-api-gateway.netlify.app';
const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';

async function openLogin(page){
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
}

test('safe bootstrap fails over to backup and pins later writes to that healthy route',async({page})=>{
  let primary=0,backup=0,netlify=0,direct=0;
  await page.route(PRIMARY+'/api/proxy/mini-app-api',r=>{primary++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"UPSTREAM_UNAVAILABLE"}'})});
  await page.route(BACKUP+'/api/proxy/mini-app-api',r=>{backup++;const action=r.request().postDataJSON()?.action;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(action==='bootstrap'?{ok:true,route:'backup'}:{ok:true,route:'backup-write'})})});
  await page.route(NETLIFY+'/api/proxy/mini-app-api',r=>{netlify++;return r.abort('failed')});
  await page.route(EDGE+'/mini-app-api',r=>{direct++;return r.abort('failed')});
  await openLogin(page);

  const bootstrap=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bootstrap'})}).then(r=>r.json()));
  expect(bootstrap).toEqual({ok:true,route:'backup'});
  expect(await page.evaluate(()=>BOS_NETWORK_DIRECT_V86.preferredTarget().base)).toBe(BACKUP);

  const write=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'addEmployee',full_name:'Тест',role:'master'})}).then(r=>r.json()));
  expect(write).toEqual({ok:true,route:'backup-write'});
  expect(primary).toBe(1);
  expect(backup).toBe(2);
  expect(netlify).toBe(0);
  expect(direct).toBe(0);
});

test('mutation network failure on the preferred route is not replayed elsewhere',async({page})=>{
  let primary=0,backup=0,netlify=0,direct=0;
  await page.route(PRIMARY+'/api/proxy/mini-app-api',r=>{primary++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"UPSTREAM_UNAVAILABLE"}'})});
  await page.route(BACKUP+'/api/proxy/mini-app-api',r=>{
    backup++;
    const action=r.request().postDataJSON()?.action;
    if(action==='bootstrap')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    return r.abort('failed');
  });
  await page.route(NETLIFY+'/api/proxy/mini-app-api',r=>{netlify++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await page.route(EDGE+'/mini-app-api',r=>{direct++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await openLogin(page);

  await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bootstrap'})}));
  const result=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'addEmployee',full_name:'Тест',role:'master'})}).then(()=> 'resolved',e=>e.name+':'+e.message));
  expect(result).not.toBe('resolved');
  expect(primary).toBe(1);
  expect(backup).toBe(2);
  expect(netlify).toBe(0);
  expect(direct).toBe(0);
});
