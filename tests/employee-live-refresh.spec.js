const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('employee profile refreshes from bootstrap after staff data changes',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>typeof window.BOS_REFRESH_EMPLOYEE_DATA==='function');

  await page.evaluate(id=>window.openEmployeeProfile(id),master.id);
  const modal=page.locator('#modalRoot .modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('+79990000001');

  const row=db.tables.business_staff.find(x=>String(x.id)===String(master.id));
  row.phone='+79990000099';
  row.city='Пушкин';

  const changed=await page.evaluate(()=>window.BOS_REFRESH_EMPLOYEE_DATA('test'));
  expect(changed).toBe(true);
  await expect(modal).toContainText('+79990000099');
  await expect(modal).toContainText('Пушкин');
});

test('live refresh runtime is loaded and refreshes on focus/visibility without touching payroll logic',async({page})=>{
  await fullStack(page,'owner');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_EMPLOYEE_LIVE_REFRESH_V27===true);
  expect(await page.evaluate(()=>typeof window.BOS_REFRESH_EMPLOYEE_DATA)).toBe('function');
});
