const {test,expect}=require('@playwright/test');

test('calendar dates keep the local business day in positive UTC offsets',async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',timezoneId:'Europe/Amsterdam'});
  const page=await context.newPage();
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.ymd==='function');
  const date=await page.evaluate(()=>window.ymd(new Date(2026,8,14,0,0,0)));
  expect(date).toBe('2026-09-14');
  await context.close();
});
