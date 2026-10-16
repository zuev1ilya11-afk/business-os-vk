// Disposable PostgreSQL/WASM checks for the exact installer transaction.
// Usage: node test_database.cjs /absolute/path/to/@electric-sql/pglite
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const transaction=cp.execFileSync('python3',['-B','-c',
  'import sys;from pathlib import Path;sys.path.insert(0,"deploy/contact-control/package");import database as d;print(d.migration_transaction(Path("deploy/contact-control/package/migration.sql").read_text()))'
],{cwd:root,encoding:'utf8'});
const files=['tests/sql/push-schema.sql','tests/sql/control-tasks-schema.sql','tests/sql/contact-control-schema.sql',
  'supabase/migrations/20260929163737_web_push_v211.sql',
  'supabase/migrations/20261001074029_order_control_tasks_v2.sql',
  'supabase/migrations/20261002101000_master_contact_confirmation.sql',
  'supabase/migrations/20261004183000_master_contact_journal.sql'];
async function fixture(){
  const db=new PGlite();
  for(const file of files)await db.exec(fs.readFileSync(path.join(root,file),'utf8'));
  await db.exec('COMMIT');
  await db.exec("INSERT INTO public.orders(id,status) VALUES(295001,'Новая')");
  return db;
}
async function run(name,check){
  const db=await fixture();
  try{await check(db);console.log('PASS '+name);}finally{await db.close();}
}
async function absent(db){
  const {rows}=await db.query("SELECT to_regclass('bos_control_private.contact_config') AS cfg, (SELECT count(*) FROM public.orders WHERE id=295001) AS orders");
  assert.equal(rows[0].cfg,null);assert.equal(Number(rows[0].orders),1);
}
(async()=>{
  await run('transaction installs disabled and preserves existing orders',async db=>{
    await db.exec(transaction);
    const {rows}=await db.query('SELECT enabled,reminders_enabled,cardinality(pilot_staff_ids) n FROM bos_control_private.contact_config');
    assert.deepEqual(rows,[{enabled:false,reminders_enabled:false,n:0}]);
    const orders=await db.query('SELECT master_contact_control_active,master_contact_revision FROM public.orders WHERE id=295001');
    assert.equal(orders.rows.length,1);assert.equal(orders.rows[0].master_contact_control_active,false);
    assert.equal(Number(orders.rows[0].master_contact_revision),0);
    await assert.rejects(db.exec(transaction),/CONTACT_ALREADY_INSTALLED/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT enabled FROM bos_control_private.contact_config')).rows[0].enabled,false);
  });
  await run('concurrent function drift rejects before schema changes',async db=>{
    await db.exec("CREATE OR REPLACE FUNCTION bos_control_private.tick() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$");
    await assert.rejects(db.exec(transaction),/CONTACT_BASELINE_CHANGED/);await db.exec('ROLLBACK');await absent(db);
  });
  await run('enabled flag assertion rolls the entire migration back',async db=>{
    const bad=transaction.replace('\nDO $$ BEGIN IF (SELECT count(*)', ()=>'\nUPDATE bos_control_private.contact_config SET reminders_enabled=true;\nDO $$ BEGIN IF (SELECT count(*)');
    await assert.rejects(db.exec(bad),/CONTACT_FLAGS_NOT_OFF/);await db.exec('ROLLBACK');await absent(db);
  });
  await run('DDL failure cannot leave partial columns or configuration',async db=>{
    const bad=transaction.replace("NOTIFY pgrst, 'reload schema';", 'SELECT missing_contact_function();');
    await assert.rejects(db.exec(bad),/missing_contact_function/);await db.exec('ROLLBACK');await absent(db);
    const cols=await db.query("SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='master_contact_revision'");
    assert.equal(Number(cols.rows[0].n),0);
  });
})().catch(error=>{console.error(error.message);process.exitCode=1;});
