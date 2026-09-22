const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('dispatcher order list puts new requests first and newest first inside groups', async ({ page }) => {
  await page.setContent(`
    <main id="content">
      <div id="bosOrderList">
        <section class="opsCompactOrder" onclick="openOrder('1')"><div class="opsCompactTop"><b>№ 1</b><span>old active</span></div></section>
        <section class="opsCompactOrder" onclick="openOrder('2')"><div class="opsCompactTop"><b>№ 2</b><span>new older</span></div></section>
        <section class="opsCompactOrder" onclick="openOrder('3')"><div class="opsCompactTop"><b>№ 3</b><span>new newest</span></div></section>
        <section class="opsCompactOrder" onclick="openOrder('4')"><div class="opsCompactTop"><b>№ 4</b><span>active newest</span></div></section>
      </div>
    </main>
  `);
  await page.addScriptTag({content:`
    window.state={page:'orders',user:{role:'dispatcher'},orders:[
      {id:'1',status:'В работе',created_at:'2026-09-20T10:00:00Z'},
      {id:'2',status:'Новая',created_at:'2026-09-21T10:00:00Z'},
      {id:'3',status:'Новая',created_at:'2026-09-22T10:00:00Z'},
      {id:'4',status:'Назначена',created_at:'2026-09-22T12:00:00Z'}
    ]};
    window.show=()=>{};
    window.openOrder=()=>{};
  `});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','dispatcher-orders-polish-v98.js'),'utf8')});
  await expect.poll(()=>page.locator('#bosOrderList>.opsCompactOrder').evaluateAll(cards=>cards.map(c=>(c.getAttribute('onclick').match(/'([^']+)'/)||[])[1]))).toEqual(['3','2','4','1']);
  await expect(page.locator(".opsCompactOrder[onclick=\"openOrder('3')\"] .dmNewBadge")).toHaveText('Новая');
  await expect(page.locator('#content')).toHaveClass(/dmDispatcherOrdersPolished/);
});

test('dispatcher polish runtime is loaded after mobile dispatcher runtime', async () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  expect(html).toContain('dispatcher-orders-polish-v98.js?v=20260922-v98');
  expect(html.indexOf('dispatcher-orders-polish-v98.js')).toBeGreaterThan(html.indexOf('dispatcher-mobile-v97.js'));
});
