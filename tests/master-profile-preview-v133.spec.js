const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master payment panel is rendered in owner master preview',async({page})=>{
  await fullStack(page,'owner');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_PROFILE_SUMMARY_V129===true);
  await page.evaluate(()=>{
    const master=state.users.find(u=>u.role==='master');
    previewRole='master';
    previewUser=master;
    show('team');
    window.BOS_MASTER_PROFILE_SUMMARY_V129_API.refresh();
  });
  const panel=page.locator('#masterProfileSummaryV129');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Допработы',{exact:true})).toBeVisible();
  await expect(panel.getByText('Вычеты',{exact:true})).toBeVisible();
  await expect(panel.getByText('ЗП за неделю',{exact:true})).toBeVisible();
  await expect(panel.getByText('ЗП за месяц',{exact:true})).toBeVisible();
});
