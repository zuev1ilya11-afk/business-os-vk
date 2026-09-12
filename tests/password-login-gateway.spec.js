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

test('password sessions support internal staff external ids',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','supabase','functions','password-session-api','index.ts'),'utf8');
  expect(source).toContain("function validSubject(v:string){return /^[A-Za-z0-9_-]{1,128}$/.test(v)}");
  expect(source).toContain('if(!validSubject(uid))');
  expect(source).not.toContain("if(!/^[1-9]\\d*$/.test(uid))");
  expect(source).not.toContain('Сначала один раз войдите через VK');
});
