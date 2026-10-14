const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('late response from a closed dialog never replaces a more recent load',async()=>{
 const requests=[],storage=new Map(),c={structuredClone,Headers,AbortController,setTimeout,clearTimeout,state:{user:{id:'owner'}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:()=>new Promise(resolve=>requests.push(resolve)),window:{BOS_AUTH_HEADERS:async()=>({'X-BOS-Session':'test'})}};
 vm.runInNewContext(fs.readFileSync('master-help-data.js','utf8'),c);vm.runInNewContext(fs.readFileSync('master-help-store.js','utf8'),c);const store=c.window.BOS_HELP_STORE;
 const row=answer=>({id:'faq-one',kind:'faq',version:1,content:{id:'faq-one',question:'Вопрос',answer,category:'work'}});
 const a=store.load();await new Promise(setImmediate);const b=store.load();await new Promise(setImmediate);
 requests[1](new Response(JSON.stringify({ok:true,can_edit:true,items:[row('Новое')]})));await b;requests[0](new Response(JSON.stringify({ok:true,can_edit:false,items:[row('Старое')]})));await a;
 assert.equal(store.data.faq[0].answer,'Новое');assert.equal(store.canEdit,true);
});
