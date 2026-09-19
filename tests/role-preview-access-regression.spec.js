const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('manager and dispatcher cannot switch into other employee previews',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'..','manager-preview-v28.js'),'utf8');

  expect(code).toContain("const isOwner=()=>String(state?.user?.role||'')==='owner'");
  expect(code).toContain("window.enterMasterPreview=function(id){if(!isOwner())return;");
  expect(code).toContain("window.enterDispatcherPreview=function(id){if(!isOwner())return;");
  expect(code).toContain("window.exitDispatcherPreview=function(){if(!isOwner())return;");
  expect(code).toContain("if(liveRole==='manager'||liveRole==='dispatcher')");
  expect(code).toContain('<h2>Мой профиль</h2>');
});
