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

test('closing a profile/form schedules an immediate refresh',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{window.apiCalls=0;state.orders=[];closeModal()});
  await expect.poll(()=>page.evaluate(()=>window.apiCalls),{timeout:2000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>state.orders.length),{timeout:2000}).toBe(1);
});
