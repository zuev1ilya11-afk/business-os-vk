const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const KEY='bos_vk_session_v2',LOGOUT='bos_manual_logout_v1';

function fixture(){
 const values=new Map([[KEY,'session-a']]);
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const requests=[],stored=[];
 const window={addEventListener(){},BOS_STORE_SESSION:t=>stored.push(t)};
 const context={window,localStorage:storage,sessionStorage:storage,document:{addEventListener(){}},Date,AbortController,setTimeout,clearTimeout,
  fetch:(url,init)=>new Promise(resolve=>requests.push({init,reply:t=>resolve({ok:true,json:async()=>({ok:true,session_token:t})})}))};
 vm.runInNewContext(fs.readFileSync('session-refresh-v113.js','utf8'),context);
 return {window,storage,requests,stored,pending:window.BOS_REFRESH_SESSION()};
}

test('refresh coalesces requests and renews the unchanged active session',async()=>{
 const f=fixture();const duplicate=f.window.BOS_REFRESH_SESSION();
 assert.equal(f.requests.length,1);f.requests[0].reply('renewed-a');
 assert.equal(await f.pending,true);assert.equal(await duplicate,true);
 assert.equal(f.storage.getItem(KEY),'renewed-a');assert.deepEqual(f.stored,['renewed-a']);
 assert.equal(await f.window.BOS_REFRESH_SESSION(),true);assert.equal(f.requests.length,1);
});

test('late refresh cannot restore a session cleared by logout, including another tab',async()=>{
 const f=fixture();f.storage.removeItem(KEY);f.storage.setItem(LOGOUT,'1');
 f.requests[0].reply('renewed-a');assert.equal(await f.pending,false);
 assert.equal(f.storage.getItem(KEY),null);assert.deepEqual(f.stored,[]);
 assert.equal(await f.window.BOS_REFRESH_SESSION(),false);assert.equal(f.requests.length,1);
});

test('a refresh reply cannot overwrite a newer login',async()=>{
 const f=fixture();f.storage.setItem(KEY,'session-b');f.requests[0].reply('renewed-a');
 assert.equal(await f.pending,false);assert.equal(f.storage.getItem(KEY),'session-b');
 const next=f.window.BOS_REFRESH_SESSION();assert.equal(f.requests.length,2);
 f.requests[1].reply('renewed-b');assert.equal(await next,true);assert.equal(f.storage.getItem(KEY),'renewed-b');
});

test('logout invalidation rejects the old reply even if login restores the same token',async()=>{
 const f=fixture();f.window.BOS_CANCEL_SESSION_REFRESH();
 assert.equal(f.requests[0].init.signal.aborted,true);
 // A transport can resolve after abort. Identical token text must not bypass logout.
 f.requests[0].reply('renewed-a');assert.equal(await f.pending,false);
 assert.equal(f.storage.getItem(KEY),'session-a');assert.deepEqual(f.stored,[]);
});

test('six-hour refresh throttle does not transfer to another account',async()=>{
 const f=fixture();f.requests[0].reply('renewed-a');await f.pending;
 f.storage.setItem(KEY,'session-b');const next=f.window.BOS_REFRESH_SESSION();
 assert.equal(f.requests.length,2);f.requests[1].reply('renewed-b');assert.equal(await next,true);
});
