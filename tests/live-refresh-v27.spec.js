const {test,expect}=require('@playwright/test');
const path=require('path');

async function boot(page){
  await page.setContent('<div id="authGate" style="display:none"></div><header><div>Brand</div><button id="profileBtn">БО</button></header><main id="content"></main><div id="modalRoot"></div>');
  await page.addScriptTag({content:`
    document.body.classList.add('bos-auth-ok');
    window.state={page:'home',busy:false,user:{id:'u1',role:'master'},orders:[],masters:[],users:[],sources:[],settings:{},masterSchedule:[]};
    window.apiCalls=0;
    window.api=async action=>{window.apiCalls++;return {ok:true,user:state.user,orders:[{id:'1',status:'В работе'}],masters:[],users:[],sources:[],settings:{},masterSchedule:[]}};
    window.show=()=>{};
    window.closeModal=()=>{document.querySelector('#modalRoot').innerHTML=''};
    window.openEmployeeProfile=()=>{};
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','employee-live-refresh-v27.js')});
}

test('manual refresh button reloads bootstrap data',async({page})=>{
  await boot(page);
  await expect(page.locator('#bosManualRefresh')).toBeVisible();
  await page.evaluate(()=>{window.apiCalls=0;state.orders=[]});
  await page.locator('#bosManualRefresh').click();
  await expect.poll(()=>page.evaluate(()=>window.apiCalls)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>state.orders.length)).toBe(1);
});

test('fresh modal close does not reload bootstrap, while a data mutation still refreshes immediately',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{window.apiCalls=0;state.orders=[];closeModal()});
  await page.waitForTimeout(700);
  expect(await page.evaluate(()=>window.apiCalls)).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bos:data-mutated')));
  await expect.poll(()=>page.evaluate(()=>window.apiCalls),{timeout:2000}).toBe(1);
  await expect.poll(()=>page.evaluate(()=>state.orders.length),{timeout:2000}).toBe(1);
});


test('first focus refresh stays immediate but duplicate return events are coalesced',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{window.apiCalls=0;state.orders=[];window.dispatchEvent(new Event('focus'))});
  await expect.poll(()=>page.evaluate(()=>window.apiCalls),{timeout:2000}).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.apiCalls)).toBe(1);
});
