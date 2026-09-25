const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('management sees master online status and last seen on team card',async({page})=>{
  await fullStack(page,'owner');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_PRESENCE_V147);

  await page.evaluate(()=>{
    const stamp=new Date().toISOString();
    const master=state.masters[0];
    master.last_seen_at=stamp;
    const user=state.users.find(u=>String(u.id)===String(master.id));
    if(user)user.last_seen_at=stamp;
    show('team');
    window.BOS_MASTER_PRESENCE_V147.decorate();
  });

  const badge=page.locator('.bosMasterPresence.isOnline').first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Онлайн');

  const offline=await page.evaluate(()=>window.BOS_MASTER_PRESENCE_V147.lastSeenText({last_seen_at:new Date(Date.now()-5*60*1000).toISOString()}));
  expect(offline).toContain('5 мин назад');
});
