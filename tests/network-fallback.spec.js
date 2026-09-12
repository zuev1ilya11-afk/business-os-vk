const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('Netlify network failures fall back before auth scripts load',async()=>{
  const root=path.join(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'network-fallback-v50.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  expect(source).toContain("const GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/'");
  expect(source).toContain("const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/'");
  expect(source).toContain('if(!raw.startsWith(GATEWAY)||!isNetworkError(err))throw err');
  const fallbackIndex=html.indexOf('network-fallback-v50.js');
  const vkAuthIndex=html.indexOf('vk-auth-patch.js');
  const mandatoryIndex=html.indexOf('mandatory-auth-v29.js');
  expect(fallbackIndex).toBeGreaterThan(-1);
  expect(fallbackIndex).toBeLessThan(vkAuthIndex);
  expect(fallbackIndex).toBeLessThan(mandatoryIndex);
});
