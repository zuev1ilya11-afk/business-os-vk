const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');

test('background bootstrap polling is reduced without removing event refreshes',async()=>{
  const source=fs.readFileSync(path.join(root,'employee-live-refresh-v27.js'),'utf8');
  expect(source).toContain('const POLL_MS=45000;');
  expect(source).toContain("window.addEventListener('focus'");
  expect(source).toContain("document.addEventListener('visibilitychange'");
  expect(source).toContain("window.addEventListener('bos:data-mutated'");
});

test('PWA keeps auth/network critical files network-first and caches versioned static assets',async()=>{
  const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  expect(source).toContain("const CACHE='business-os-shell-v12';");
  expect(source).toContain("const REV='20260925-v171';");
  expect(source).toContain("'/network-direct-v86.js'");
  expect(source).toContain("'/mandatory-auth-v29.js'");
  expect(source).toContain("'/employee-live-refresh-v27.js'");
  expect(source).toContain("url.searchParams.has('v')");
  expect(source).toContain('event.respondWith(cacheFirst(request));');
});
