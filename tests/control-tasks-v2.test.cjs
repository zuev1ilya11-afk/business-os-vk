const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const {database,employee,token,secret}=require('./helpers/edge.cjs');
const core=require('../order-control-tasks.js');
test('control deadlines are Moscow wall time independently of device timezone',()=>{assert.equal(core.parseDue('2026-10-01T10:15'),'2026-10-01T07:15:00.000Z');assert.equal(core.toInput('2026-09-30T22:15:00Z'),'2026-10-01T01:15')});
test('control rejects impossible calendars, hours and unspecified dates',()=>{for(const s of ['','2026-02-29T12:00','2026-10-01T25:00','2026-10-01','2026-13-01T10:00'])assert.throws(()=>core.parseDue(s));assert.equal(core.parseDue('2028-02-29T12:00'),'2028-02-29T09:00:00.000Z')});
function fixture(role='owner'){
 const actor=employee('actor',role),db=database({business_staff:[actor]});const calls=[];
 db.rpc=async(name,p)=>{calls.push({name,p});assert.equal(name,'bos_control_action');return {data:{ok:true,tasks:[],staff:[]},error:null}};
 let handler;const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/push-api/index.ts','utf8').replace(/^import .*;\s*$/gm,''),{mode:'transform'});
 vm.runInNewContext(source,{createClient:()=>db,webpush:{},Deno:{env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',VK_APP_SECRET:secret}[k])},serve:fn=>handler=fn},crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,AbortController,setTimeout,clearTimeout});
 const invoke=(body,session=token(actor.external_id))=>handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session},body:JSON.stringify(body)}));return{actor,calls,invoke,db};
}
for(const role of ['owner','manager','dispatcher','master'])test(`control list accepts existing ${role} session without reading push secrets`,async()=>{const f=fixture(role);assert.equal((await f.invoke({action:'controlList'})).status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].p.p_actor,f.actor.id)});
test('control rejects forged and missing sessions before task access',async()=>{for(const session of ['','invalid',token('unknown')]){const f=fixture();assert.notEqual((await f.invoke({action:'controlSave'},session)).status,200);assert.equal(f.calls.length,0)}});
test('control actor and action come from verified server state, not client identity',async()=>{const f=fixture();await f.invoke({action:'controlSave',p_actor:'victim',actor:'victim',role:'owner'});assert.equal(f.calls[0].p.p_actor,f.actor.id);assert.equal(f.calls[0].p.p_action,'controlSave')});
test('master cannot assign or clear tasks',async()=>{for(const action of ['controlSave','controlClear']){const f=fixture('master');assert.equal((await f.invoke({action})).status,403);assert.equal(f.calls.length,0)}});
test('task conflicts retain explicit 409 rather than reporting false success',async()=>{const f=fixture();f.db.rpc=async()=>({data:{ok:false,status:409,error:'Изменено'},error:null});assert.equal((await f.invoke({action:'controlSave'})).status,409)});
