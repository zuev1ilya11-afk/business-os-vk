const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('retry in the same manual order form recovers an order committed before its response was lost',async({page})=>{
 const {db}=await fullStack(page,'owner');
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>String(window.openOrderForm).includes('enhanceNewOrderForm'));
 await page.evaluate(()=>{
  const previous=window.api;let loseResponse=true;
  window.api=async function(action,...args){
   const result=await previous.call(this,action,...args);
   if(action==='createOrder'&&result.ok&&loseResponse){loseResponse=false;throw Error('Ответ потерян после сохранения')}
   return result;
  };
  openOrderForm();
 });
 const form=page.locator('#orderForm');
 await form.locator('[name=client]').fill('Проверка потерянного ответа');
 await form.locator('#bosPhone').fill('9991234567');
 await form.locator('[name=address]').fill('Синтетический адрес');
 await form.locator('#bosWorkDescription').fill('Синтетическая работа');
 const submit=form.getByRole('button',{name:'Создать заявку',exact:true});
 await submit.click();
 await expect(form.locator('#formMsg')).toHaveText('Ответ потерян после сохранения');
 const created=()=>db.tables.orders.filter(o=>o.client==='Проверка потерянного ответа');
 expect(created()).toHaveLength(1);
 const id=String(created()[0].id),request=await form.getAttribute('data-request-id');
 expect(request).toBeTruthy();
 await submit.click();await expect(form).toHaveCount(0);
 expect(created()).toHaveLength(1);expect(String(created()[0].id)).toBe(id);
 expect(await page.evaluate(id=>state.orders.filter(o=>String(o.id)===id).length,id)).toBe(1);
});
