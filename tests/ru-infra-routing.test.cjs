const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const networkSource=fs.readFileSync(path.join(process.cwd(),'network-direct-v86.js'),'utf8');
const configSource=fs.readFileSync(path.join(process.cwd(),'config.js'),'utf8');

function boot(ruBase=''){
  const window={
    fetch:async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}})
  };
  if(ruBase)window.BOS_RU_API_BASE=ruBase;
  const context={
    window,
    location:{href:'https://business-os.example/',origin:'https://business-os.example'},
    URL,Request,Response,Headers,AbortController,
    setTimeout,clearTimeout,encodeURIComponent,decodeURIComponent,console
  };
  vm.createContext(context);
  vm.runInContext(networkSource,context,{filename:'network-direct-v86.js'});
  vm.runInContext(configSource,context,{filename:'config.js'});
  return context.window;
}

test('RU migration routing keeps current production route by default',()=>{
  const win=boot();
  assert.equal(win.BOS_INFRA_ENDPOINTS.mode,'legacy');
  assert.equal(win.BOS_INFRA_ENDPOINTS.primaryGateway,'https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e');
  assert.equal(win.BUSINESS_OS_CONFIG.API_URL,'https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/mini-app-api');
  assert.equal(win.BOS_NETWORK_DIRECT_V86.primaryGateway,win.BOS_INFRA_ENDPOINTS.primaryGateway);
});

test('RU HTTPS endpoint becomes primary without changing feature modules',()=>{
  const win=boot('https://api.business-os.ru');
  assert.equal(win.BOS_INFRA_ENDPOINTS.mode,'ru-primary');
  assert.equal(win.BOS_INFRA_ENDPOINTS.primaryGateway,'https://api.business-os.ru');
  assert.equal(win.BUSINESS_OS_CONFIG.API_URL,'https://api.business-os.ru/api/proxy/mini-app-api');
  assert.equal(win.BOS_NETWORK_DIRECT_V86.primaryGateway,'https://api.business-os.ru');
  assert.equal(win.BOS_NETWORK_DIRECT_V86.ruMigrationAware,true);
});

test('unsafe or malformed RU endpoint is ignored',()=>{
  for(const value of ['http://api.business-os.ru','not-a-url','https://user:pass@api.business-os.ru']){
    const win=boot(value);
    assert.equal(win.BOS_INFRA_ENDPOINTS.mode,'legacy');
  }
});
