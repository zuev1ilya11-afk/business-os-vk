const {test,expect}=require('@playwright/test');
const fs=require('node:fs');

test('VK Bridge starts from Netlify without direct CDN dependency',async({page})=>{
  const html=fs.readFileSync('index.html','utf8');
  expect(html).not.toContain('https://unpkg.com/');
  expect(html).toContain('https://business-os-api-gateway.netlify.app/vendor/vk-bridge.js');
  let bridgeCalls=0;
  await page.route('https://business-os-api-gateway.netlify.app/vendor/vk-bridge.js',route=>{bridgeCalls++;return route.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'})});
  await page.route('https://business-os-api-gateway.netlify.app/api/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Доступ не подтверждён"}'}));
  await page.goto('/');
  await expect.poll(()=>bridgeCalls).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#authGate')).toBeVisible();
});

test('legacy Supabase and Google URLs rewrite through Netlify',async({page})=>{
  await page.route('https://business-os-api-gateway.netlify.app/vendor/vk-bridge.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route('https://business-os-api-gateway.netlify.app/api/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Доступ не подтверждён"}'}));
  await page.goto('/');
  const urls=await page.evaluate(()=>[
    window.BOS_NETWORK_GATEWAY_V85.rewrite('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-api'),
    window.BOS_NETWORK_GATEWAY_V85.rewrite('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/drive-archive-api'),
    window.BOS_NETWORK_GATEWAY_V85.rewrite('https://script.google.com/macros/s/example/exec')
  ]);
  expect(urls[0]).toBe('https://business-os-api-gateway.netlify.app/api/proxy/report-api');
  expect(urls[1]).toBe('https://business-os-api-gateway.netlify.app/api/proxy/drive-archive-api');
  expect(urls[2]).toBe('https://business-os-api-gateway.netlify.app/api/gas-report');
});
