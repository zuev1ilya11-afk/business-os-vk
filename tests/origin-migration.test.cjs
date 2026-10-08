const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const old='https://zuev1ilya11-afk.github.io/business-os-vk/';
const target='https://139.100.237.167/';

test('old entry preserves exact VK query and fragment and never redirects other deployments',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const match=html.match(/<script id="bos-origin-migration">([\s\S]*?)<\/script>/);
 assert.ok(match,'the entry redirect must run before the application bootstrap');
 assert.ok(match.index<html.indexOf('<script defer'));
 const suffix='?vk_user_id=123&vk_platform=mobile_web&sign=abc%2Fdef%2Bghi&bos_push_order=115#orders';
 for(const path of [old,old+'index.html',target,'http://localhost:4173/','https://zuev1ilya11-afk.github.io/lumi-stories/']){
  const url=new URL(path+suffix),calls=[];
  vm.runInNewContext(match[1],{location:{origin:url.origin,pathname:url.pathname,search:url.search,hash:url.hash,replace:u=>calls.push(u)}});
  assert.deepEqual(calls,path.startsWith(old)?[target+suffix]:[]);
 }
});

test('installed old worker switches future navigations without deleting caches or navigating open drafts',async()=>{
 const source=fs.readFileSync('sw.js','utf8');
 const id=source.match(/const BUILD_ID='([^']+)'/)[1];
 const handlers={};let claimed=0,skipped=0;
 const self={location:{href:old+'sw.js'},BOS_BUILD:{id,assets:{}},
  addEventListener:(type,handler)=>(handlers[type]??=[]).push(handler),
  skipWaiting:async()=>{skipped++},clients:{claim:async()=>{claimed++}}};
 vm.runInNewContext(source,{self,importScripts(){},URL,Response,
  caches:new Proxy({},{get(){throw Error('Migration must preserve existing caches')}}),
  fetch(){throw Error('Old installation does not need to download another app shell')}});
 const emit=async(type,extra={})=>{
  const pending=[];for(const fn of handlers[type]||[])fn({waitUntil:p=>pending.push(p),...extra});
  await Promise.all(pending);
 };
 await emit('install');await emit('activate');
 assert.equal(skipped,1);assert.equal(claimed,1);
 const suffix='?vk_user_id=123&sign=abc%2Fdef&bos_push_order=115';
 let response;
 await emit('fetch',{request:{method:'GET',mode:'navigate',url:old+suffix},respondWith:p=>{response=Promise.resolve(p)}});
 assert.equal((await response).status,302);
 assert.equal((await response).headers.get('location'),target+suffix);
 response=null;
 await emit('fetch',{request:{method:'POST',mode:'cors',url:old+'api'},respondWith:p=>{response=p}});
 assert.equal(response,null);
});
