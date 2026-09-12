const {test,expect}=require('@playwright/test');

test('new employee registers by phone after signed VK launch',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:`window.vkBridge={send:async(name)=>{if(name==='VKWebAppGetAuthToken'){window.__authTokenCalls=(window.__authTokenCalls||0)+1;throw new Error('unexpected auth token call')}return {}}};`
  }));
  const sessionHandler=route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ok:true,session_token:'22334455.9999999999.testsig',registration_required:true})
  });
  await page.route('**/api/proxy/vk-session-api',sessionHandler);

  let registered=false;
  const user={id:'staff1',external_id:'22334455',vk_user_id:'22334455',full_name:'Новый мастер',role:'master',phone:'+7 999 123-45-67',city:'Москва',is_active:true};
  const miniAppHandler=async route=>{
    const req=route.request(),body=req.postDataJSON()||{},headers=req.headers();
    if(body.action==='registerByPhone'){
      expect(headers['x-bos-session']).toBe('22334455.9999999999.testsig');
      expect(body.phone.replace(/\D/g,'')).toContain('9991234567');
      registered=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'22334455.9999999999.testsig',user})});
    }
    if(body.action==='bootstrap'){
      if(!registered)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Требуется регистрация по номеру телефона',registration_required:true})});
      expect(headers['x-bos-session']).toBe('22334455.9999999999.testsig');
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user,orders:[],users:[user],masters:[user],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  };
  await page.route('**/api/proxy/mini-app-api',miniAppHandler);

  await page.goto('/?force_vk_auth=1&vk_app_id=54758847&vk_user_id=22334455&vk_language=ru&sign=signed_test_value',{waitUntil:'domcontentloaded'});
  const registrationForm=page.locator('#simplePhoneForm');
  await expect(registrationForm).toBeVisible({timeout:10000});
  const phone=registrationForm.locator('input[name="phone"]');
  await expect(phone).toBeVisible();
  await expect(page.locator('input[name="vk_user_id"]')).toHaveCount(0);
  await phone.fill('+7 999 123-45-67');
  await registrationForm.getByRole('button',{name:'Продолжить'}).click();
  await expect.poll(()=>registered).toBeTruthy();
  await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible({timeout:10000});
  expect(await page.evaluate(()=>window.__authTokenCalls||0)).toBe(0);
});
