const {test,expect}=require('@playwright/test');

test('new employee registers by phone without VK ID',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:`window.vkBridge={send:async(name)=>{if(name==='VKWebAppGetAuthToken')return {access_token:'phone_reg_token'};if(name==='VKWebAppGetLaunchParams')return {};return {}}};`}));
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'22334455.9999999999.testsig',registration_required:true})}));
  let registered=false;
  const user={id:'staff1',external_id:'22334455',vk_user_id:'22334455',full_name:'Новый мастер',role:'master',phone:'+7 999 123-45-67',city:'Москва',is_active:true};
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',async route=>{
    const req=route.request(),body=req.postDataJSON()||{},headers=req.headers();
    expect(headers['x-bos-session']).toBeTruthy();
    if(body.action==='registerByPhone'){
      expect(body.phone.replace(/\D/g,'')).toContain('9991234567');
      registered=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'22334455.9999999999.testsig',user})});
    }
    if(body.action==='bootstrap'){
      if(!registered)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Требуется регистрация по номеру телефона',registration_required:true})});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user,orders:[],users:[user],masters:[user],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.goto('/?force_vk_auth=1',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Регистрация',exact:true})).toBeVisible({timeout:20000});
  await expect(page.locator('input[name="phone"]')).toBeVisible();
  await expect(page.locator('input[name="vk_user_id"]')).toHaveCount(0);
  await page.locator('input[name="phone"]').fill('+7 999 123-45-67');
  await page.getByRole('button',{name:'Продолжить'}).click();
  await expect.poll(()=>registered).toBeTruthy();
  await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible({timeout:10000});
});