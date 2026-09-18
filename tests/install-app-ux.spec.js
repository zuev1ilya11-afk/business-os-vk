const {test,expect}=require('@playwright/test');

async function stubNetwork(page){
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route('**/api/proxy/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Доступ не подтверждён"}'}));
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Доступ не подтверждён"}'}));
}

test('desktop install control uses the browser install prompt',async({page})=>{
  await stubNetwork(page);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const button=page.locator('.bosInstallAppBtn--auth');
  await expect(button).toBeVisible({timeout:10000});

  await page.evaluate(()=>{
    window.__bosInstallPrompted=false;
    const event=new Event('beforeinstallprompt');
    event.prompt=async()=>{window.__bosInstallPrompted=true};
    event.userChoice=Promise.resolve({outcome:'accepted',platform:'web'});
    window.dispatchEvent(event);
  });

  await button.click();
  await expect.poll(()=>page.evaluate(()=>window.__bosInstallPrompted)).toBe(true);
  await expect(button).toBeHidden();
});

test('iPhone install control explains Add to Home Screen flow',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'iPhone'});
  });
  await stubNetwork(page);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const button=page.locator('.bosInstallAppBtn--auth');
  await expect(button).toBeVisible({timeout:10000});
  await button.click();
  await expect(page.locator('#bosInstallHelp')).toContainText('Поделиться');
  await expect(page.locator('#bosInstallHelp')).toContainText('На экран Домой');
});
