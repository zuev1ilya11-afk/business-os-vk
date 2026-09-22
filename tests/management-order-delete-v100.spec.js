const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const runtime = fs.readFileSync(path.join(__dirname,'..','management-order-delete-v100.js'),'utf8');

async function boot(page, role='owner'){
  await page.setContent('<div id="modalRoot"></div>');
  await page.addScriptTag({content:`
    window.state={page:'orders',user:{role:${JSON.stringify(role)}},orders:[{id:'42',client:'Тест'}],claims:[{id:'c1',order_id:'42'}]};
    window.esc=v=>String(v);
    window.__apiCalls=[]; window.__reloads=0;
    window.api=async(action,payload)=>{window.__apiCalls.push({action,payload});return {ok:true,id:String(payload.id)}};
    window.reloadData=async()=>{window.__reloads++};
    window.closeModal=()=>{document.querySelector('#modalRoot').innerHTML=''};
    window.openOrder=id=>{document.querySelector('#modalRoot').innerHTML='<div class="modal"><h2>Заявка '+id+'</h2></div>'};
  `});
  await page.addScriptTag({content:runtime});
}

test('owner and manager see delete; dispatcher and master do not', async ({ page }) => {
  for(const role of ['owner','manager']){
    await page.goto('about:blank');
    await boot(page,role);
    await page.evaluate(()=>openOrder('42'));
    await expect(page.locator('[data-bos-delete-order]')).toHaveCount(1);
  }
  for(const role of ['dispatcher','master']){
    await page.goto('about:blank');
    await boot(page,role);
    await page.evaluate(()=>openOrder('42'));
    await expect(page.locator('[data-bos-delete-order]')).toHaveCount(0);
  }
});

test('delete requires confirmation, calls deleteOrder, removes local order and refreshes', async ({ page }) => {
  await boot(page,'owner');
  await page.evaluate(()=>openOrder('42'));
  await page.evaluate(()=>{window.confirm=()=>false});
  await page.locator('[data-bos-delete-order]').click();
  expect(await page.evaluate(()=>window.__apiCalls.length)).toBe(0);
  expect(await page.evaluate(()=>state.orders.length)).toBe(1);

  await page.evaluate(()=>{window.confirm=()=>true});
  await page.locator('[data-bos-delete-order]').click();
  await expect.poll(()=>page.evaluate(()=>window.__apiCalls.length)).toBe(1);
  expect(await page.evaluate(()=>window.__apiCalls[0])).toEqual({action:'deleteOrder',payload:{id:'42'}});
  await expect.poll(()=>page.evaluate(()=>state.orders.length)).toBe(0);
  expect(await page.evaluate(()=>state.claims.length)).toBe(0);
  expect(await page.evaluate(()=>window.__reloads)).toBe(1);
  await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
});

test('server deleteOrder is restricted to owner and manager and runtime is loaded', async () => {
  const apiSource=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  expect(apiSource).toContain("const leadership=(r:string)=>['owner','manager'].includes(r)");
  expect(apiSource).toContain("if(a==='deleteOrder')");
  expect(apiSource).toContain("if(!leadership(role))return j({ok:false,error:'Недостаточно прав'},403)");
  expect(apiSource).toContain("db.from('orders').delete().eq('id',id)");
  const loader=fs.readFileSync(path.join(__dirname,'..','pwa-register.js'),'utf8');
  expect(loader).toContain('management-order-delete-v100.js?v=20260922-v100');
});
