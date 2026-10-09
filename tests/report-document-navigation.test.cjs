const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const worker=fs.readFileSync('sw.js','utf8'),id=worker.match(/const BUILD_ID='([^']+)'/)[1];
function fixture(base='https://139.100.237.167/'){
 const handlers={};let cacheReads=0;
 const self={location:{href:base+'sw.js'},BOS_BUILD:{id,assets:{}},addEventListener:(type,fn)=>(handlers[type]??=[]).push(fn)};
 vm.runInNewContext(worker,{self,URL,Response,importScripts(){},caches:{open:async()=>{cacheReads++;return {match:async()=>new Response('APP SHELL')}}}});
 return {reads:()=>cacheReads,request:async(path,mode='navigate')=>{
  let intercepted=false,result;
  for(const fn of handlers.fetch)fn({request:{method:'GET',mode,url:new URL(path,base).href},respondWith:r=>{intercepted=true;result=r}});
  return {intercepted,response:await result};
 }};
}
test('signed old and new report files bypass the app shell and its offline cache',async()=>{
 const f=fixture();
 for(const path of ['storage/v1/object/sign/business-os-vk-files/orders/11/old/act.pdf?token=old-signature','storage/v1/object/sign/business-os-vk-files/orders/12/new/act.jpg?token=new-signature','storage/v1/object/sign/business-os-vk-files/orders/12/new/act.png?token=new-signature','storage/v1/object/sign/business-os-vk-files/orders/12/new/act.jpg','api/proxy/report-api','functions/v1/report-api']){
  assert.equal((await f.request(path)).intercepted,false,path);
 }
 assert.equal(f.reads(),0,'private documents must never be read from the shell cache');
});
test('root and index navigation keep the verified offline shell, including query links',async()=>{
 for(const base of ['https://139.100.237.167/','http://localhost/app/']){
  const f=fixture(base);
  for(const path of ['', '?bos_push_order=11', 'index.html?build='+id]){
   const r=await f.request(path);assert.equal(r.intercepted,true);assert.equal(await r.response.text(),'APP SHELL');
  }
 }
});
