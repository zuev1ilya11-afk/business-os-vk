const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {patch}=require('../scripts/patch-live-hands-sync.cjs');
const original=fs.readFileSync('tests/fixtures/hands-v11-sync.ts','utf8').trimEnd();
const shared=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/hands-sync.ts','utf8').replace(/^export /gm,''),{mode:'transform'});
test('patch changes only the reviewed sync routine and keeps private webhook/auth bytes',()=>{
 const prefix='// private configuration fixture\n',suffix='\nasync function webhook(){return "fixture"}\n// authentication fixture';
 const source=prefix+original+suffix,result=patch(source);
 assert.ok(result.startsWith('import { syncHandsPages } from "./hands-sync.ts";\n'+prefix));
 assert.ok(result.endsWith(suffix));assert.throws(()=>patch(result));
 assert.throws(()=>patch(source.replace("const status='ACTIVE'","const status='COMPLETE'")));
 assert.throws(()=>patch(source+'\n'+original));
});
test('private patched importer follows capped pages and retains ACTIVE-only contract',async()=>{
 const saved=[],queries=[];
 const ctx=vm.createContext({URLSearchParams,staffMap:async()=>new Map(),hands:async url=>{
  const q=new URL('https://fixture.invalid'+url).searchParams;queries.push(q);const page=Number(q.get('page'));
  return {orders:[{id:String(page)}],page,per_page:1,pages:2,total:2};
 },importOrder:async(db,row)=>{saved.push(row.id);return {ok:true,created:true}}});
 vm.runInContext(shared+stripTypeScriptTypes(patch(original).replace(/^import .*;\n/,''),{mode:'transform'}),ctx);
 const result=await ctx.syncOrders({}, {status:'COMPLETE',per_page:500});
 assert.deepEqual(saved,['1','2']);assert.equal(result.created,2);assert.equal(result.status,'ACTIVE');assert.ok(queries.every(q=>q.get('status')==='ACTIVE'));
});
