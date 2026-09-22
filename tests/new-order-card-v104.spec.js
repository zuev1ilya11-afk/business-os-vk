const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher new order card is grouped and touch friendly on mobile',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>String(window.openOrderForm||'').includes('enhanceNewOrderForm'));

  await page.locator('nav button[data-page="orders"]').click();
  await page.getByRole('button',{name:'+ Заявка',exact:true}).click();

  const form=page.locator('#orderForm.newOrderForm');
  await expect(form).toBeVisible();
  await expect(page.locator('.newOrderTitle')).toHaveText('Новая заявка');
  for(const heading of ['Клиент','Работа','Дата и назначение','Стоимость','Комментарий']){
    await expect(form.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }
  await expect(form.locator('.newOrderCompletionSection')).toBeHidden();

  for(const name of ['client','phone','address','work','scheduled_date','time_slot','status','master_vk_id','source','original_amount','comment']){
    await expect(form.locator(`[name="${name}"]`)).toHaveCount(1);
  }

  const layout=await form.evaluate(node=>{
    const vw=document.documentElement.clientWidth;
    const controls=[...node.querySelectorAll('input:not([type="checkbox"]),select,textarea,.newOrderActions button')]
      .filter(el=>getComputedStyle(el).display!=='none')
      .map(el=>{const r=el.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}});
    const sections=[...node.querySelectorAll('.newOrderSection:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right}});
    return {
      pageOverflow:document.documentElement.scrollWidth-vw,
      controlsTouchSafe:controls.every(x=>x.height>=44),
      controlsInside:controls.every(x=>x.left>=-1&&x.right<=vw+1),
      sectionsInside:sections.every(x=>x.left>=-1&&x.right<=vw+1)
    };
  });
  expect(layout).toEqual({pageOverflow:0,controlsTouchSafe:true,controlsInside:true,sectionsInside:true});

  await expect(page.getByRole('button',{name:'Создать заявку',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await expect(page.locator('#orderForm')).toHaveCount(0);
});
