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
  for(const heading of ['Клиент','Услуги','Дата и назначение','Стоимость','Комментарий']){
    await expect(form.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }

  for(const name of ['client','address','work','scheduled_date','time_slot','status','master_vk_id','wall_over_3m','wall_material','original_amount','comment']){
    await expect(form.locator(`[name="${name}"]`)).toHaveCount(1);
  }
  await expect(form.locator('#bosPhone')).toHaveCount(1);
  await expect(form.locator('textarea#bosService[name=work]')).toHaveCount(1);
  await expect(form.locator('[name=order_type]')).toHaveCount(0);
  await expect(form.locator('.newOrderChannel')).toHaveCount(6);
  expect(await form.locator('.newOrderChannel').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=44))).toBe(true);
  await expect(form.locator(':scope > label')).toHaveCount(0);

  const sections=form.locator('.newOrderSection');
  await expect(sections.filter({hasText:'Клиент'}).locator('#bosPhone')).toHaveCount(1);
  await expect(sections.filter({hasText:'Услуги'}).locator('#bosService')).toHaveCount(1);
  await expect(sections.filter({hasText:'Дата и назначение'}).locator('[name="scheduled_date"]')).toHaveCount(1);
  await expect(sections.filter({hasText:'Стоимость'}).locator('[name="original_amount"]')).toHaveCount(1);
  await expect(sections.filter({hasText:'Комментарий'}).locator('[name="comment"]')).toHaveCount(1);

  const layout=await form.evaluate(node=>{
    const vw=document.documentElement.clientWidth;
    const controls=[...node.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea,.newOrderActions button')]
      .filter(el=>getComputedStyle(el).display!=='none')
      .map(el=>{const r=el.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}});
    const visibleSections=[...node.querySelectorAll('.newOrderSection:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right}});
    return {
      pageOverflow:document.documentElement.scrollWidth-vw,
      controlsTouchSafe:controls.every(x=>x.height>=44),
      controlsInside:controls.every(x=>x.left>=-1&&x.right<=vw+1),
      sectionsInside:visibleSections.every(x=>x.left>=-1&&x.right<=vw+1)
    };
  });
  expect(layout).toEqual({pageOverflow:0,controlsTouchSafe:true,controlsInside:true,sectionsInside:true});

  await expect(page.getByRole('button',{name:'Создать заявку',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await expect(page.locator('#orderForm')).toHaveCount(0);
});

for(const [source,role,width]of [['Авито','dispatcher',390],['Руки','owner',1440],['VK','dispatcher',320],['Телефон','owner',1440],['Рекомендация','dispatcher',390],['Другое','owner',1440]])test('manual order persists services and channel: '+source,async({page})=>{
 const {db}=await fullStack(page,role);await page.setViewportSize({width,height:900});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>String(window.openOrderForm||'').includes('enhanceNewOrderForm'));
 await page.evaluate(()=>openOrderForm());const form=page.locator('#orderForm');
 await expect(form).toHaveClass(/newOrderForm/);
 await form.locator('[name=client]').fill('Новая '+source);await form.locator('#bosPhone').fill('9991234567');
 await form.locator('[name=address]').fill('Адрес проверки');await form.getByRole('radio',{name:source,exact:true}).check();
 await form.locator('[name=original_amount]').fill('1000');
 const work='Установка карниза — 2 шт.\nНавеска штор <без подрезки>';
 await form.locator('#bosService').fill(work);
 await expect(form.locator('[name=original_amount]')).toHaveValue('1000');
 await form.locator('[name=master_vk_id]').selectOption('staff_m');
 await expect(form.locator('#bosMasterPay')).toContainText(source==='Руки'?'552':'600');
 await form.locator('[name=wall_over_3m]').check();await form.locator('[name=possible_extra_work]').check();
 await form.locator('[name=wall_material]').selectOption('Кирпич');
 await form.locator('[name=comment]').fill('Позвонить заранее');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form).toHaveCount(0);
 const saved=db.tables.orders.find(o=>o.client==='Новая '+source);
 expect(saved).toMatchObject({work,source,original_amount:1000,amount:1000,master_staff_id:'m',master_payout:source==='Руки'?552.5:600,wall_over_3m:true,wall_material:'Кирпич',possible_extra_work:true,comment:'Позвонить заранее'});
 expect(db.tables.orders).toHaveLength(3);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();
 expect(await page.evaluate(id=>state.orders.find(o=>String(o.id)===String(id)).work,saved.id)).toBe(work);
 expect(await page.evaluate(id=>state.orders.find(o=>String(o.id)===String(id)).source,saved.id)).toBe(source);
 await page.evaluate(id=>openOrder(id),saved.id);await expect(page.locator('#modalRoot')).toContainText('Навеска штор <без подрезки>');
});
test('empty services cannot save and a failed create preserves the complete draft for retry',async({page})=>{
 const {db}=await fullStack(page,'dispatcher');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>String(window.openOrderForm||'').includes('enhanceNewOrderForm'));
 await page.evaluate(()=>openOrderForm());const form=page.locator('#orderForm');await expect(form).toHaveClass(/newOrderForm/);
 await form.locator('[name=client]').fill('Повтор');await form.locator('#bosPhone').fill('9991234567');await form.locator('[name=address]').fill('Адрес');
 await form.locator('#bosService').fill('   ');await form.getByRole('button',{name:'Создать заявку',exact:true}).click();
 await expect(form.locator('#formMsg')).toContainText('Опишите услуги');expect(db.tables.orders).toHaveLength(2);
 await form.locator('#bosService').fill('Нестандартный монтаж');await form.getByRole('radio',{name:'Телефон',exact:true}).check();await form.locator('[name=original_amount]').fill('1200');
 await page.evaluate(()=>{const previous=window.api;let fail=true;window.api=async function(action,...args){if(action==='createOrder'&&fail){fail=false;return {ok:false,error:'Временная ошибка'}}return previous.call(this,action,...args)}});
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form.locator('#formMsg')).toContainText('Временная ошибка');
 await expect(form.locator('#bosService')).toHaveValue('Нестандартный монтаж');await expect(form.getByRole('radio',{name:'Телефон',exact:true})).toBeChecked();await expect(form.locator('[name=original_amount]')).toHaveValue('1200');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form).toHaveCount(0);expect(db.tables.orders.filter(o=>o.client==='Повтор')).toHaveLength(1);
});
