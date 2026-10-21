// Exact deployed API/shared calculator plus patched parser; synthetic database only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{stripTypeScriptTypes}=require('node:module'),{createHmac,webcrypto}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),H=require('../../tests/helpers/lemana-schema.cjs');
const {database}=require('../../tests/helpers/edge.cjs'),{workbook}=require('../../tests/helpers/lemana-xlsx.cjs');
const base=process.env.BOS_LEMANA_BASE_PACKAGE||path.join(__dirname,'bos297.pyz');
const read=(zip,name)=>execFileSync('python3',['-c','import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',zip,name],{encoding:'utf8'});
test('patched RU API preview and signed confirmation preserve milliseconds in real SQL without touching history',async()=>{
 const pg=new PGlite();try{
  await pg.exec(H.schema);await pg.exec(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));await pg.exec(read(base,'migration.sql'));
  const before=(await pg.query('select to_jsonb(o) x from orders o where id=1')).rows;
  const staff=(await pg.query('select * from business_staff')).rows,db=database({business_staff:staff});
  db.rpc=async(name,p)=>{assert.equal(name,'bos_import_lemana_order');return {data:(await pg.query('select bos_import_lemana_order($1::uuid,$2::jsonb) result',[p.p_actor,JSON.stringify(p.p_order)])).rows[0].result,error:null}};
  const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,atob,btoa,console};vm.createContext(context);
  for(const name of ['order-payroll.js','order-work-items.js','vendor/lemana-xlsx.js'])vm.runInContext(read(base,'backend/mini-app-api/'+name),context);
  vm.runInContext(read(path.join(__dirname,'bos-lemana-dates.pyz'),'backend/mini-app-api/lemana-import.js'),context);
  vm.runInContext(stripTypeScriptTypes(read(base,'backend/mini-app-api/supabase/functions/_shared/lemana-api.ts').replace(/^export /gm,''),{mode:'transform'}),context);
  const sign=async s=>createHmac('sha256','synthetic-only').update(s).digest('hex'),me=staff.find(s=>s.id===H.owner);
  const row=['fraction-001','Синтетический клиент','+79990000001','Тестовый адрес','Категория',1000,'2026-01-02T00:30:05.123','2026-01-03T12:30:45.456','','Тестовый мастер','Назначена дата',''];
  const preview=await context.lemanaApi(db,{action:'previewLemanaImport',file_name:'synthetic.xlsx',file_base64:Buffer.from(workbook([row])).toString('base64'),timezone:'Europe/Moscow'},me,sign);
  assert.equal(preview.status,200);assert.equal(preview.body.preview.counts.new,1);assert.equal((await pg.query('select count(*)::int n from orders')).rows[0].n,1);
  await pg.exec('SET ROLE service_role');const confirmed=await context.lemanaApi(db,{action:'confirmLemanaImport',preview_token:preview.body.preview_token,selected:[2]},me,sign);await pg.exec('RESET ROLE');
  assert.equal(confirmed.status,200);assert.equal(confirmed.body.created,1);
  const saved=(await pg.query("select * from orders where order_number='fraction-001'")).rows[0];
  assert.equal(new Date(saved.created_at).toISOString(),'2026-01-01T21:30:05.123Z');assert.equal(saved.scheduled_time,'12:30:45.456');
  assert.deepEqual([Number(saved.master_payout),Number(saved.manager_payout),Number(saved.dispatcher_payout)],[552.5,159.8,119.85]);
  assert.deepEqual((await pg.query('select to_jsonb(o) x from orders o where id=1')).rows,before);
 }finally{await pg.close()}
});
