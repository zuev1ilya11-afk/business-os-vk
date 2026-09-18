const {test,expect}=require('@playwright/test');

test('production shell exposes an installable PWA without unsafe asset fallback',async({page,request})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});

  const manifestLink=page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  await expect(manifestLink).toHaveAttribute('href',/manifest\.webmanifest/);
  await expect(page.locator('script[src^="pwa-register.js"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content','yes');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href','./app-icon.svg');

  const manifestResponse=await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest=await manifestResponse.json();
  expect(manifest.name).toContain('Business OS');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({src:'app-icon.svg',purpose:'any'}),
    expect.objectContaining({src:'app-icon.svg',purpose:'maskable'}),
  ]));

  const iconResponse=await request.get('/app-icon.svg');
  expect(iconResponse.ok()).toBeTruthy();
  expect(await iconResponse.text()).toContain('viewBox="0 0 512 512"');

  const workerResponse=await request.get('/sw.js');
  expect(workerResponse.ok()).toBeTruthy();
  const worker=await workerResponse.text();
  expect(worker).toContain("request.mode==='navigate'");
  expect(worker).toContain("caches.match(request)");
  expect(worker).not.toContain("hit||caches.match('./index.html')");
});
