// Real SQL/RPC against disposable synthetic PostgreSQL; no production credentials.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{stripTypeScriptTypes}=require('node:module'),{createHmac,webcrypto}=require('node:crypto');
const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');
const H=require('../../tests/helpers/lemana-schema.cjs'),{database}=require('../../tests/helpers/edge.cjs'),{workbook}=require('../../tests/helpers/lemana-xlsx.cjs');
const dir=path.join(__dirname,'package'),read=n=>fs.readFileSync(path.join(dir,n),'utf8');
const tx=execFileSync('python3',['-c',"import sys;sys.path.insert(0,sys.argv[1]);import database as d;print(d.migration_transaction(d.resource('migration.sql')))",dir],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
async function setup(){const db=new PGlite();await db.exec(H.schema);await db.exec(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));return db;}
const rpc=async(db,row=H.row(),actor=H.owner)=>(await db.query('SELECT bos_import_lemana_order($1::uuid,$2::jsonb) result',[actor,JSON.stringify(row)])).rows[0].result;
const metadata=async(db,file)=>(await db.query(read(file))).rows[0].json_build_object;
test('guarded migration preserves every old column/value and requires exact prerequisite',async()=>{const db=await setup();try{
 const before=(await db.query('select to_jsonb(o) x from orders o')).rows;
 await db.exec(tx);assert.deepEqual(await metadata(db,'schema.sql'),JSON.parse(read('schema-expected.json')));
 const after=(await db.query("select to_jsonb(o)-'work_items'-'lemana_import_meta' x from orders o")).rows;assert.deepEqual(after,before);
 await assert.rejects(db.exec(tx),/LEMANA_BASELINE_CHANGED/);await db.exec('ROLLBACK');
}finally{await db.close()}});
test('guarded migration and pause retain exact ACLs with RU default function grants',async()=>{const db=await setup();try{
 await db.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres,anon,authenticated,service_role');
 const defaults=(await db.query('select to_jsonb(d) x from pg_default_acl d')).rows;
 const before=(await db.query('select to_jsonb(o) x from orders o')).rows;
 await db.exec(tx);
 assert.deepEqual(await metadata(db,'schema.sql'),JSON.parse(read('schema-expected.json')));
 const guard=(await db.query("select has_function_privilege('service_role','public.bos_lemana_number_guard()','EXECUTE') allowed")).rows[0];
 assert.equal(guard.allowed,false);
 assert.deepEqual((await db.query("select to_jsonb(o)-'work_items'-'lemana_import_meta' x from orders o")).rows,before);
 await db.exec(read('pause.sql'));assert.deepEqual(await metadata(db,'pause-schema.sql'),JSON.parse(read('pause-expected.json')));
 await db.exec(read('resume.sql'));assert.deepEqual(await metadata(db,'schema.sql'),JSON.parse(read('schema-expected.json')));
 assert.deepEqual((await db.query('select to_jsonb(d) x from pg_default_acl d')).rows,defaults);
}finally{await db.close()}});
test('partial schema and late failure roll back without touching old rows',async()=>{for(const partial of [true,false]){const db=await setup();try{
 if(partial)await db.exec('ALTER TABLE orders ADD COLUMN work_items jsonb');
 await assert.rejects(db.exec(partial?tx:tx.replace("NOTIFY pgrst, 'reload schema';",'SELECT missing_function();')));await db.exec('ROLLBACK');
 const columns=(await metadata(db,'schema.sql')).columns;assert.equal(columns.length,partial?1:0);
 assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,1);
}finally{await db.close()}}});
test('RPC keeps RU shared payroll, creates only once and rejects invalid monetary/role inputs',async()=>{const db=await setup();try{
 await db.exec(tx);const row={...H.row(),manager_payout:159.8,dispatcher_payout:119.85};
 const first=await rpc(db,row);assert.equal(first.kind,'created');
 for(const k of ['master_payout','manager_payout','dispatcher_payout'])assert.equal(first.order[k],row[k]);
 assert.equal((await rpc(db,row)).kind,'skipped');assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,2);
 for(const value of [-1,'NaN',1.234,null])await assert.rejects(rpc(db,{...row,order_number:'bad',external_id:'bad',manager_payout:value}),/INVALID_IMPORT_ROW/);
 await assert.rejects(rpc(db,{...row,order_number:'master',external_id:'master'},H.master),/IMPORT_FORBIDDEN/);
 await db.exec('SET ROLE authenticated');await assert.rejects(rpc(db),/permission denied/);await db.exec('RESET ROLE');
}finally{await db.close()}});
test('persistent pause closes direct REST/API writes, checks OLD and NEW and resumes cleanly',async()=>{const db=await setup();try{
 await db.exec(tx);await rpc(db,{...H.row(),manager_payout:159.8,dispatcher_payout:119.85});
 await db.exec(read('pause.sql'));assert.deepEqual(await metadata(db,'pause-schema.sql'),JSON.parse(read('pause-expected.json')));
 await assert.rejects(db.exec("UPDATE orders SET source='Телефон',external_source='mini_app',work_items=null,lemana_import_meta=null WHERE external_id='00042'"),/LEMANA_RELEASE_PAUSED/);
 await assert.rejects(db.exec("UPDATE orders SET work_items='[]' WHERE id=1"),/LEMANA_RELEASE_PAUSED/);
 await assert.rejects(rpc(db,{...H.row('new'),manager_payout:159.8,dispatcher_payout:119.85}),/LEMANA_RELEASE_PAUSED/);
 await db.exec("UPDATE orders SET work='Обычное ручное изменение' WHERE id=1");
 await db.exec('SET ROLE service_role');await assert.rejects(rpc(db),/permission denied/);await db.exec('RESET ROLE');
 await db.exec(read('resume.sql'));assert.deepEqual(await metadata(db,'schema.sql'),JSON.parse(read('schema-expected.json')));
 assert.equal((await rpc(db,{...H.row('new'),manager_payout:159.8,dispatcher_payout:119.85})).kind,'created');
}finally{await db.close()}});
test('empty dependent count remains safe after pause, old sources retain normal writes',async()=>{const db=await setup();try{
 await db.exec(tx);const results=await db.exec(read('pause.sql'));const result=results.find(x=>x.rows?.[0]?.json_build_object);assert.equal(result.rows[0].json_build_object.dependent,false);
 await assert.rejects(db.exec("INSERT INTO orders(source,client,address,work)VALUES('Лемана Про','Синтетический','Тестовый','')"),/LEMANA_RELEASE_PAUSED/);
 await db.exec("INSERT INTO orders(source,client,address,work)VALUES('Телефон','Синтетический','Тестовый','')");
}finally{await db.close()}});
test('XLSX preview -> signed confirmation -> real RPC stores all three original RU payouts',async()=>{const pg=await setup();try{
 await pg.exec(tx);const staff=(await pg.query('select * from business_staff')).rows;
 const db=database({business_staff:staff});db.rpc=async(name,p)=>{assert.equal(name,'bos_import_lemana_order');return {data:await rpc(pg,p.p_order,p.p_actor),error:null}};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,atob,btoa,console};vm.createContext(context);
 const files=['backend/mini-app-api/order-payroll.js','backend/mini-app-api/order-work-items.js','backend/mini-app-api/lemana-import.js','backend/mini-app-api/vendor/lemana-xlsx.js'];
 for(const file of files)vm.runInContext(read(file),context);
 vm.runInContext(stripTypeScriptTypes(read('backend/mini-app-api/supabase/functions/_shared/lemana-api.ts').replace(/^export /gm,''),{mode:'transform'}),context);
 const sign=async(s)=>createHmac('sha256','synthetic-only').update(s).digest('hex');const me=staff.find(x=>x.id===H.owner);
 const input={action:'previewLemanaImport',file_name:'synthetic.xlsx',file_base64:Buffer.from(workbook()).toString('base64'),timezone:'Europe/Moscow'};
 const preview=await context.lemanaApi(db,input,me,sign);assert.equal(preview.status,200);assert.equal(preview.body.preview.counts.new,1);
 assert.equal((await pg.query('select count(*)::int n from orders')).rows[0].n,1);
 const confirmed=await context.lemanaApi(db,{action:'confirmLemanaImport',preview_token:preview.body.preview_token,selected:[2]},me,sign);
 assert.equal(confirmed.status,200);assert.equal(confirmed.body.created,1);
 const order=(await pg.query("select * from orders where external_source='lemana_pro'")).rows[0];
 assert.deepEqual([Number(order.master_payout),Number(order.manager_payout),Number(order.dispatcher_payout)],[552.5,159.8,119.85]);
 assert.equal(order.work,'');assert.equal(order.work_items,null);assert.equal(order.order_number,'00042');
}finally{await pg.close()}});

test('RPC validation supports existing double precision payout columns without schema changes',async()=>{const db=await setup();try{
 for(const name of ['master_payout','manager_payout','dispatcher_payout'])await db.exec('ALTER TABLE orders ALTER COLUMN '+name+' TYPE double precision');
 await db.exec(tx);const out=await rpc(db,{...H.row(),manager_payout:159.8,dispatcher_payout:119.85});
 assert.deepEqual([out.order.master_payout,out.order.manager_payout,out.order.dispatcher_payout],[552.5,159.8,119.85]);
}finally{await db.close()}});
