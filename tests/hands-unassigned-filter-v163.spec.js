const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('Hands specialist without Business OS master link stays in Без мастера',async({page})=>{
  const {db}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='12');
  Object.assign(order,{
    status:'В работе',
    external_source:'hands',
    external_id:'hands:7327843',
    source:'Hands',
    master_name:'ИП Шапалина И.Б.',
    master_staff_id:null,
    master_vk_id:null,
    master_id:null
  });

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  const filter=page.locator('.bosOrderFilters button').filter({hasText:'Без мастера'});
  await expect(filter).toContainText('1');
  await filter.click();

  await expect(page.locator('#bosOrderList')).toContainText('№ 7327843');
  await expect(page.locator('#bosOrderList')).toContainText('Мастер не назначен');
  await expect(page.locator('#bosOrderList')).toContainText('Hands');
});
