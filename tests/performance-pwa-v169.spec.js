const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');

test('background bootstrap polling is reduced without removing event refreshes',async()=>{
  const source=fs.readFileSync(path.join(root,'employee-live-refresh-v27.js'),'utf8');
  expect(source).toContain('const POLL_TICK_MS=30000;');
  expect(source).toContain("if(role==='dispatcher')return 60000;");
  expect(source).toContain("if(role==='master')return 120000;");
  expect(source).toContain('return 180000;');
  expect(source).toContain('const RETURN_REFRESH_MS=30000;');
  expect(source).toContain("window.addEventListener('focus'");
  expect(source).toContain("document.addEventListener('visibilitychange'");
  expect(source).toContain("window.addEventListener('bos:data-mutated'");
  expect(source).toContain("const isPresenceSubject=()=>String(state?.user?.role||'')==='master';");
});

test('PWA caches verified build assets and keeps navigation fresh',async()=>{
  const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  expect(source).toContain('const CACHE=PREFIX+BUILD_ID;');
  expect(source).toContain('verifiedAsset(name)');
  expect(source).toContain("fetch(request,{cache:'no-store'})");
  expect(source).toContain('request.method');
});
