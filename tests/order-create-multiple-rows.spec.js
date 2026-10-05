const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

async function openCreation(page,role='dispatcher',width=390){
 const context=await fullStack(page,role);
 await page.setViewportSize({width,height:900});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrderForm());
 const form=page.locator('#orderForm.newOrderForm');await expect(form).toBeVisible();
 return {...context,form};
}
async function details(form){
 await form.locator('[name=client]').fill('Несколько строк');
 await form.locator('[name=address]').fill('Тестовая улица, 1');
 await form.locator('[name=original_amount]').fill('2500');
}

// Removing the creation/editor branch in either row renderer must break these tests.
for(const [role,width] of [['owner',1440],['manager',390],['dispatcher',320]])test(`${role}: create, reload and edit multiple phone/work rows at ${width}px`,async({page},testInfo)=>{
 const {db,form}=await openCreation(page,role,width);await details(form);
 await expect(form.locator('.bosPhoneInput')).toHaveCount(1);
 await expect(form.locator('.bosWorkSelect')).toHaveCount(1);
 await expect(form.locator('.bosRemovePhone')).toBeHidden();
 await expect(form.locator('.bosRemoveWork')).toBeHidden();
 await form.locator('.bosPhoneInput').fill('9991234567');
 await form.locator('#bosAddPhone').click();
 await form.locator('.bosPhoneInput').nth(1).fill('9217654321');
 await form.locator('.bosWorkSelect').selectOption('4');
 await form.locator('#bosAddWork').click();
 await form.locator('.bosWorkSelect').nth(1).selectOption('custom');
 await form.locator('.bosCustomWork:visible').fill('Нестандартный монтаж <без сверления>');
 await form.locator('[name=comment]').fill('Позвонить за 30 минут');
 await expect(form.locator('[name=original_amount]')).toHaveValue('2500');
 const layout=await form.evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...el.querySelectorAll('.bosAddField,.bosRemoveField')].filter(b=>!b.hidden).every(b=>b.getBoundingClientRect().height>=44)}));
 expect(layout).toEqual({overflow:false,buttons:true});
 await form.locator('.bosPhoneEditor').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('creation-phones-'+width+'.png')});
 await form.locator('#bosWorkStack').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('creation-works-'+width+'.png')});
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form).toHaveCount(0);
 const saved=db.tables.orders.find(o=>o.client==='Несколько строк');
 expect(saved).toMatchObject({phone:'+79991234567; +79217654321',work:'Установка декоративного карниза длиной до 2,5 метров\nНестандартный монтаж <без сверления>',original_amount:2500,comment:'Позвонить за 30 минут'});
 expect(db.tables.orders).toHaveLength(3);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(id=>openOrderForm(id),saved.id);
 await expect(page.locator('.bosPhoneInput')).toHaveCount(2);await expect(page.locator('.bosWorkSelect')).toHaveCount(2);
 await expect(page.locator('.bosWorkSelect').nth(1)).toHaveValue('legacy');
 await expect(page.locator('[name=comment]')).toHaveValue('Позвонить за 30 минут');
});

test('invalid extra phone blocks creation, removal keeps first-field hooks, and retry retains every row',async({page})=>{
 const {db,form}=await openCreation(page);await details(form);
 await form.locator('.bosPhoneInput').fill('9991234567');
 await form.locator('#bosAddPhone').click();await form.locator('.bosPhoneInput').nth(1).fill('12');
 await form.locator('.bosWorkSelect').selectOption('4');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();
 await expect(form.locator('#formMsg')).toContainText('10 цифр');expect(db.tables.orders).toHaveLength(2);
 await form.locator('.bosPhoneInput').nth(1).fill('9217654321');
 await form.locator('.bosRemovePhone').first().click();await expect(form.locator('#bosPhone')).toHaveValue('9217654321');
 await form.locator('#bosAddWork').click();await form.locator('.bosWorkSelect').nth(1).selectOption('5');
 await form.locator('.bosRemoveWork').first().click();await expect(form.locator('#bosService')).toHaveValue('5');
 await form.locator('#bosAddPhone').click();await form.locator('.bosPhoneInput').nth(1).fill('9990001122');
 await form.locator('#bosAddWork').click();await form.locator('.bosWorkSelect').nth(1).selectOption('custom');
 await form.locator('.bosCustomWork:visible').fill('Отдельная работа');
 await page.evaluate(()=>{const previous=window.api;let fail=true;window.api=async function(action,...args){if(action==='createOrder'&&fail){fail=false;return {ok:false,error:'Временная ошибка'}}return previous.call(this,action,...args)}});
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form.locator('#formMsg')).toContainText('Временная ошибка');
 await expect(form.locator('.bosPhoneInput')).toHaveCount(2);await expect(form.locator('.bosWorkSelect')).toHaveCount(2);await expect(form.locator('.bosCustomWork:visible')).toHaveValue('Отдельная работа');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form).toHaveCount(0);
 expect(db.tables.orders.filter(o=>o.client==='Несколько строк')).toHaveLength(1);
 expect(db.tables.orders.find(o=>o.client==='Несколько строк')).toMatchObject({phone:'+79217654321; +79990001122',work:'Установка декоративного карниза длиной до 3,5 метров\nОтдельная работа'});
});

test('blank works are rejected; duplicate rows normalize and cancel starts a clean draft',async({page})=>{
 const {db,form}=await openCreation(page);await details(form);await form.locator('.bosPhoneInput').fill('9991234567');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form.locator('#formMsg')).toContainText('Добавьте хотя бы одну работу');
 await form.locator('.bosWorkSelect').selectOption('custom');await form.locator('.bosCustomWork:visible').fill('   ');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();expect(db.tables.orders).toHaveLength(2);
 await form.locator('.bosCustomWork:visible').fill('Работа');await form.locator('#bosAddPhone').click();await form.locator('.bosPhoneInput').nth(1).fill('9991234567');
 await form.locator('#bosAddWork').click();await form.locator('.bosWorkSelect').nth(1).selectOption('custom');await form.locator('.bosCustomWork:visible').nth(1).fill('Работа');
 await form.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(form).toHaveCount(0);
 expect(db.tables.orders.find(o=>o.client==='Несколько строк')).toMatchObject({phone:'+79991234567',work:'Работа'});
 await page.evaluate(()=>openOrderForm());await expect(form).toBeVisible();await form.locator('#bosAddPhone').click();await form.locator('#bosAddWork').click();
 await form.getByRole('button',{name:'Отмена',exact:true}).click();await expect(form).toHaveCount(0);
 await page.evaluate(()=>openOrderForm());await expect(form).toBeVisible();await expect(form.locator('.bosPhoneInput')).toHaveCount(1);await expect(form.locator('.bosWorkSelect')).toHaveCount(1);
 await expect(form.locator('#bosPhone')).toHaveValue('');await expect(form.locator('#bosService')).toHaveValue('');
});


test('master cannot open the creation form',async({page})=>{
 await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrderForm());await expect(page.locator('#orderForm')).toHaveCount(0);
});
