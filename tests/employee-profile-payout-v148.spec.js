const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('owner master cards recalculate payout from current completed amount',async({page})=>{
  const {db}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.status='Выполнена';
  order.amount=1000;
  order.master_payout=297.5;

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=team]').click();

  const teamCard=page.getByRole('button',{name:/Тестовый мастер/});
  await expect(teamCard).toContainText('552,5');
  await expect(teamCard).not.toContainText('297,5');
  await teamCard.click();

  const modal=page.locator('#modalRoot');
  const payoutCard=modal.getByText('Выплата',{exact:true}).locator('..');
  await expect(payoutCard).toContainText('552,5');
  await expect(payoutCard).not.toContainText('297,5');
});
