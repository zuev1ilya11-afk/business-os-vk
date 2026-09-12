const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('password and VK auth UI use Netlify gateway',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','auth-ui-patch.js'),'utf8');
  expect(source).toContain("const GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/'");
  expect(source).toContain("const PASS_API=GATEWAY+'password-session-api'");
  expect(source).toContain("const VK_API=GATEWAY+'vk-session-api'");
  expect(source).not.toContain('supabase.co/functions/v1/password-session-api');
  expect(source).not.toContain('supabase.co/functions/v1/vk-session-api');
});
