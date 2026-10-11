const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {execFileSync}=require('node:child_process');
const {database}=require('./helpers/edge.cjs');
const fixture=fs.readFileSync('tests/fixtures/hands-v11-intake.ts','utf8');
const patcher='scripts/ru-hands-insert-only.py';
function patched(){return fs.existsSync(patcher)?execFileSync('python3',['-c',"import runpy,sys; m=runpy.run_path(sys.argv[1]); sys.stdout.write(m['patch_source'](sys.stdin.read()))",patcher],{input:fixture,encoding:'utf8'}):fixture}
function context(db){
 const shared=fs.readFileSync('supabase/functions/_shared/hands-details.ts','utf8').replace(/^export /gm,'');
 const ctx=vm.createContext({Date,URL,Response,WEBHOOK_TOKEN:'synthetic-token-not-production',json:(x,status=200)=>Response.json(x,{status}),clean:v=>String(v??'').trim(),externalId:v=>String(v??'').replace(/^hands:/,''),localExternalId:v=>'hands:'+v,money:Number,schedule:()=>({scheduled_date:'2026-10-10',scheduled_time:'11:00'}),phones:o=>o.client_phones.join('\n'),cityFrom:()=> 'Москва',localStatus:o=>o.status==='COMPLETE'?'Выполнена':'В работе',externalComment:o=>o.comment,errText:JSON.stringify,staffMap:async()=>new Map([['мастер',{id:'staff',full_name:'Мастер'}]])});
 vm.runInContext(stripTypeScriptTypes(shared+'\n'+patched()+'\nfunction workText(o){return handsWorkText(o)}',{mode:'transform'}),ctx);return ctx;
}
const remote=()=>({id:123,client_name:'Тест',client_phones:['+70000000001','+70000000002'],address:'Тестовый адрес',title:'Работа',works:[{title:'Замер',quantity:1,unit:'PIECE'}],price:1000,specialist:'Мастер',status:'ACTIVE',creation_time:'2026-10-09 09:39:42',comment:'Комментарий',directions:'кв. 5'});
const existing=()=>({id:'1',external_source:'hands',external_id:'hands:123',status:'В работе',amount:555,comment:'Правка диспетчера',scheduled_date:'2026-11-01',updated_at:'2026-10-09T10:00:00Z'});
for(const externalId of ['hands:123','123'])test('insert-only preserves every existing field: '+externalId,async()=>{
 const row={...existing(),external_id:externalId},db=database({orders:[row]}),ctx=context(db);
 const before=structuredClone(db.tables.orders);const r=await ctx.importOrder(db,remote(),new Map(),true,'2026-10-09T06:39:42.000Z');
 assert.equal(r.created,false);assert.equal(r.skipped,true);assert.deepEqual(db.tables.orders,before);assert.equal(db.calls.filter(x=>x.mode!=='select').length,0);
});
test('insert-only reuses original mapper and preserves the supplied original creation date',async()=>{
 const db=database(),ctx=context(db),r=await ctx.importOrder(db,remote(),new Map([['мастер',{id:'staff',full_name:'Мастер'}]]),true,'2026-10-09T06:39:42.000Z');
 assert.equal(r.created,true);const o=db.tables.orders[0];assert.equal(o.created_at,'2026-10-09T06:39:42.000Z');assert.equal(o.master_staff_id,'staff');assert.equal(o.phone,'+70000000001\n+70000000002');assert.equal(o.apartment,'5');assert.match(o.comment,/Комментарий/);assert.equal(o.work,'Замер × 1 шт.');assert.equal(o.status,'В работе');assert.equal(o.external_id,'hands:123');
});
test('concurrent insert conflict never updates the winner',async()=>{
 const db=database(),ctx=context(db),winner=existing();db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='insert'){db.tables.orders.push(winner);db.beforeQuery=null}};
 const r=await ctx.importOrder(db,remote(),new Map(),true);assert.equal(r.skipped,true);assert.deepEqual(db.tables.orders,[winner]);assert.equal(db.calls.filter(x=>x.mode==='update').length,0);
});
test('manual sync retains existing behavior unless insert-only was explicitly selected',async()=>{
 const db=database({orders:[existing()]}),ctx=context(db);await ctx.importOrder(db,remote(),new Map());assert.equal(db.tables.orders[0].amount,1000);assert.equal(db.calls.filter(x=>x.mode==='update').length,1);
});
async function deliver(ctx,db,body,delivery='synthetic-delivery'){
 const url=new URL('https://test.invalid/hands-api?token=synthetic-token-not-production');
 return ctx.webhook(db,new Request(url,{method:'POST',headers:{'x-hands-delivery':delivery},body:JSON.stringify(body)}),url);
}
test('CREATED with a different delivery ID still preserves a dispatcher-edited existing order',async()=>{
 const row=existing(),db=database({orders:[row],hands_webhook_deliveries:[]}),ctx=context(db);
 const response=await deliver(ctx,db,{event:'CREATED',order:remote()});assert.equal(response.status,200);assert.deepEqual(db.tables.orders,[row]);assert.equal(db.tables.hands_webhook_deliveries.length,1);
});
test('recovery webhook rejects an ambiguous creation timestamp before creating an order',async()=>{
 const db=database({hands_webhook_deliveries:[]}),ctx=context(db);
 const response=await deliver(ctx,db,{event:'CREATED',order:remote(),recovery_created_at:'2026-10-09 09:39:42'});assert.equal(response.status,400);assert.equal(db.tables.orders.length,0);
});
test('repeat delivery is acknowledged without looking up or modifying an order',async()=>{
 const db=database({hands_webhook_deliveries:[]}),ctx=context(db),body={event:'CREATED',order:remote(),recovery_created_at:'2026-10-09T06:39:42.000Z'};
 await deliver(ctx,db,body);db.tables.orders[0].comment='После импорта';const before=structuredClone(db.tables.orders),calls=db.calls.length;
 const response=await deliver(ctx,db,body);assert.equal((await response.json()).duplicate,true);assert.deepEqual(structuredClone(db.tables.orders),before);assert.equal(db.calls.slice(calls).some(x=>x.table==='orders'),false);
});
test('receipt failure is not acknowledged as success; retry preserves the already imported order',async()=>{
 const db=database({hands_webhook_deliveries:[]}),ctx=context(db),baseFrom=db.from;
 db.from=function(table){if(table==='hands_webhook_deliveries'){const q=baseFrom(table);q.insert=()=>Promise.resolve({error:{code:'XX000',message:'synthetic private detail'}});return q}return baseFrom(table)};
 await assert.rejects(deliver(ctx,db,{event:'CREATED',order:remote()}),/WEBHOOK_RECEIPT_FAILED/);assert.equal(db.tables.orders.length,1);
 db.tables.orders[0].comment='Правка после первого запроса';const before=structuredClone(db.tables.orders);db.from=baseFrom;
 await deliver(ctx,db,{event:'CREATED',order:remote()});assert.deepEqual(structuredClone(db.tables.orders),before);assert.equal(db.tables.hands_webhook_deliveries.length,1);
});
test('public unauthenticated or no-delivery probe never queries the database',async()=>{
 const db=database({hands_webhook_deliveries:[]}),ctx=context(db);
 for(const [token,status] of [['wrong',404],['synthetic-token-not-production',400]]){
  const url=new URL('https://test.invalid/hands-api?token='+token),response=await ctx.webhook(db,new Request(url,{method:'POST',body:'{}'}),url);
  assert.equal(response.status,status);assert.equal(db.calls.length,0);
 }
});
