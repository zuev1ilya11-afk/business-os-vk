const {test,expect}=require('@playwright/test');
test('unmocked external traffic fails at the loopback proxy',async({page,browser})=>{
 await page.goto('/');
 const result=await page.goto('https://network-isolation.invalid').then(()=>'',error=>error.message);
 expect(result).toMatch(/ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/);
 const context=await browser.newContext();try{
  const extra=await context.newPage();
  const external=await extra.goto('https://network-isolation.invalid').then(()=>'',error=>error.message);
  expect(external).toMatch(/ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/);
 }finally{await context.close()}
});
