const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('Netlify keeps HTML and service worker fresh across network edges',async()=>{
  const netlify=fs.readFileSync(path.join(__dirname,'..','netlify.toml'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

  expect(netlify).toContain('for = "/index.html"');
  expect(netlify).toContain('for = "/sw.js"');
  expect(netlify.match(/Cache-Control = "public, max-age=0, must-revalidate"/g)||[]).toHaveLength(2);
  expect(worker).toMatch(/const CACHE='business-os-shell-v\d+'/);
  expect(worker).toContain("fetch(networkRequest,{cache:'no-store'})");
});
