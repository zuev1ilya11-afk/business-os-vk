const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('sw.js','utf8'),build=source.match(/const BUILD_ID='([^']+)'/)[1];
const binding='b1111111-1111-4111-8111-111111111111',eventId='a1111111-1111-4111-8111-111111111111';
const app='https://test.invalid/business-os-vk/';
function fixture(){
 const handlers={},stores=new Map(),shown=[],opened=[],messages=[],acks=[];let focused=0,closed=0;
 const cache=name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {match:async key=>data.get(String(key))?.clone(),put:async(key,value)=>{data.set(String(key),value.clone())},delete:async key=>data.delete(String(key))}};
 const client={url:app,postMessage:m=>messages.push(m),focus:async()=>{focused++;return client}};
 const self={location:{href:app+'sw.js'},BOS_BUILD:{id:build,assets:{}},addEventListener:(name,handler)=>(handlers[name]??=[]).push(handler),clients:{matchAll:async()=>self.windows,openWindow:async url=>opened.push(url)},windows:[],registration:{showNotification:async(title,options)=>shown.push({title,...options}),getNotifications:async()=>shown.map(n=>({...n,close:()=>{closed++}}))}};
 const context={self,importScripts(){},caches:{open:async name=>cache(name)},URL,Response,Date,console};vm.runInNewContext(source,context);
 const emit=async(type,props={})=>{const pending=[];for(const h of handlers[type]||[])h({waitUntil:p=>pending.push(p),...props});await Promise.all(pending)};
 const send=async(type,id=binding,sourceURL=app)=>emit('message',{data:{type,binding_id:id},source:{url:sourceURL},ports:[{postMessage:a=>acks.push(a)}]});
 const push=async extra=>emit('push',{data:{json:()=>({v:1,binding_id:binding,event_id:eventId,title:'Business OS',body:'Заявка №123',order_id:'123',expires_at:new Date(Date.now()+60000).toISOString(),...extra})}});
 const click=async data=>emit('notificationclick',{notification:{data,close(){closed++}}});
 return {emit,send,push,click,self,client,shown,opened,messages,acks,stores,get focused(){return focused},get closed(){return closed}};
}
test('push worker: persistent binding survives a build-cache rotation, rejects invalid clients',async()=>{
 const f=fixture();await f.send('BOS_PUSH_BIND',binding,'https://attacker.invalid/');assert.equal(f.acks.at(-1).ok,false);await f.push();assert.equal(f.shown.length,0);
 await f.send('BOS_PUSH_BIND');assert.equal(f.acks.at(-1).ok,true);assert(f.stores.has('bos-push-state-v1'));await f.push();assert.equal(f.shown.length,1);assert.equal(f.shown[0].data.order_id,'123');assert.equal(f.shown[0].tag,'bos-push-'+eventId);
});
test('push worker: malformed, expired and previous-account payloads do not display',async()=>{
 const f=fixture();await f.send('BOS_PUSH_BIND');for(const change of [{binding_id:'other'},{v:2},{event_id:'bad'},{expires_at:'2000-01-01'},{expires_at:'invalid'}])await f.push(change);
 await f.emit('push',{data:{json(){throw Error('invalid JSON')}}});assert.equal(f.shown.length,0);
});
test('push worker: logout clears binding and existing notifications before later events',async()=>{
 const f=fixture();await f.send('BOS_PUSH_BIND');await f.push();const data=f.shown[0].data;await f.send('BOS_PUSH_CLEAR');assert.equal(f.closed,1);await f.push();await f.click(data);assert.equal(f.shown.length,1);assert.equal(f.opened.length,0);
});
test('push worker: queued bind followed by logout cannot restore a cleared binding',async()=>{
 const f=fixture();await Promise.all([f.send('BOS_PUSH_BIND'),f.send('BOS_PUSH_CLEAR')]);await f.push();assert.equal(f.shown.length,0);
});
test('push worker: notification clicks never follow supplied URLs and require live binding',async()=>{
 const f=fixture();await f.send('BOS_PUSH_BIND');await f.click({binding_id:binding,order_id:'123',url:'https://attacker.invalid/'});assert.equal(f.opened[0],app+'?bos_push_order=123');
 await f.click({binding_id:binding,order_id:'../../evil',url:'https://attacker.invalid/'});assert.equal(f.opened[1],app);
 await f.click({binding_id:'wrong',order_id:'123'});assert.equal(f.opened.length,2);
});
test('push worker: focus existing own app and message it without navigating away from an unsaved form',async()=>{
 const f=fixture();f.self.windows=[{url:'https://attacker.invalid/business-os-vk/'},f.client];await f.send('BOS_PUSH_BIND');await f.click({binding_id:binding,order_id:'123'});assert.equal(f.opened.length,0);assert.equal(f.focused,1);assert.equal(f.messages[0].type,'BOS_PUSH_OPEN');assert.equal(f.messages[0].order_id,'123');
});
test('push worker: expired browser subscription clears binding and requests explicit reconnection',async()=>{
 const f=fixture();f.self.windows=[f.client];await f.send('BOS_PUSH_BIND');await f.emit('pushsubscriptionchange');await f.push();assert.equal(f.shown.length,0);assert.equal(f.messages[0].type,'BOS_PUSH_RECONNECT');
});
