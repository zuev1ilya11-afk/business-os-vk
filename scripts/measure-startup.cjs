// Reproducible cold-start lab: real static HTTP + Chromium network throttling.
// API/VK responses are fixtures. This does not measure a carrier, VPN, DNS or TLS.
const {chromium,devices}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(process.argv[2]||'.'),output=process.argv[3];
const profiles=[{name:'Fast 4G',latency:60,downloadThroughput:4e6/8,uploadThroughput:3e6/8},{name:'Slow 4G',latency:150,downloadThroughput:1.6e6/8,uploadThroughput:750e3/8},{name:'High latency',latency:600,downloadThroughput:4e6/8,uploadThroughput:1e6/8}];
(async()=>{
 let role='owner',calls=[];
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(name.startsWith('__api/')){
   let body='';req.on('data',b=>body+=b);req.on('end',()=>{let action='';try{action=JSON.parse(body).action}catch{}calls.push({action,session:!!req.headers['x-bos-session']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,user:{id:'1',role,full_name:'Fixture',city:'Москва'},orders:[],users:[],masters:[],sources:[],masterSchedule:[],settings:{}}))});return;
  }
  const file=path.join(root,name);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.webmanifest')?'application/manifest+json':'image/svg+xml');
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Encoding','gzip');res.end(zlib.gzipSync(fs.readFileSync(file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const profile of profiles){
   calls=[];const context=await browser.newContext({...devices['Pixel 7'],serviceWorkers:'block'}),page=await context.newPage();
   await context.addInitScript(()=>{
    localStorage.setItem('bos_vk_session_v2','fixture.9999999999.signature');
    window.vkBridge={send:async()=>({})};
    const native=window.fetch.bind(window);
    window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);return native(url.origin!==location.origin?new URL('__api/'+url.pathname.split('/').pop(),location.href).href:input,init)};
   });
   const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,...profile,name:undefined,connectionType:'cellular4g'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const start=Date.now();await page.goto(base+'/?force_vk_auth=1',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok'),{},{timeout:60000});
   const gateMs=Date.now()-start;
   await page.waitForFunction(()=>typeof BOS_LOAD_ROLE_MODULES==='function');
   await page.evaluate(()=>BOS_LOAD_ROLE_MODULES(state.user.role));
   const readyMs=Date.now()-start;
   const timings=await page.evaluate(()=>({paint:performance.getEntriesByType('paint').map(x=>({name:x.name,ms:Math.round(x.startTime)})),navigation:performance.getEntriesByType('navigation').map(x=>({dns:x.domainLookupEnd-x.domainLookupStart,connect:x.connectEnd-x.connectStart,tls:0,ttfb:x.responseStart-x.requestStart,download:x.responseEnd-x.responseStart,duration:x.duration})),resources:performance.getEntriesByType('resource').map(x=>({name:new URL(x.name).pathname.split('/').pop(),start:Math.round(x.startTime),duration:Math.round(x.duration),ttfb:Math.round(x.responseStart-x.requestStart),bytes:x.encodedBodySize,status:x.responseStatus,protocol:x.nextHopProtocol}))}));
   const result={profile:profile.name,settings:profile,device:'Chromium Pixel 7 emulation',role,readyMs,gateMs,bootstrapCalls:calls.filter(x=>x.action==='bootstrap').length,errors,...timings};results.push(result);console.log(JSON.stringify({profile:profile.name,readyMs,bootstrapCalls:result.bootstrapCalls,paint:timings.paint,errors}));await context.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r))}
 if(output)fs.writeFileSync(output,JSON.stringify({note:'Synthetic API, localhost HTTP, cold browser, gzip assets. One sample/profile, no real carriers/VPN/iOS hardware.',results},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1});
