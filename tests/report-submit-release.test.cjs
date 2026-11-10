const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const {database}=require('./helpers/edge.cjs');
const {reportSql}=require('./helpers/report-sql.cjs');
test('release changes only recognized function; rollback restores it without changing orders',async()=>{
 const plans=JSON.parse(execFileSync('python3',['-c',`import importlib.util,json
s=importlib.util.spec_from_file_location('release','deploy/report-submit/database.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
a=m.BASELINE.read_text();a=a[a.index('CREATE OR REPLACE FUNCTION public.guard_order_completion()'):a.index('-- Custom BOS authentication')];b=m.MIGRATION.read_text()
print(json.dumps({'old':m.body(a),'new':m.body(b),'apply':m.guarded(m.body(a),b),'rollback':m.guarded(m.body(b),a)}))`],{encoding:'utf8'}));
 const sql=await reportSql(database({orders:[{id:'11',status:'Назначена',report_review_status:'not_submitted',master_workflow_stage:'started'}]}),{fixed:false});
 try{
  const before=await sql.read(11),functionBody=async()=>(await sql.pg.query("select prosrc from pg_proc where oid='guard_order_completion()'::regprocedure")).rows[0].prosrc;
  assert.equal(await functionBody(),plans.old);
  await sql.pg.exec(plans.apply);assert.equal(await functionBody(),plans.new);assert.deepEqual(await sql.read(11),before);
  // The read-only audit executes without exposing attachments or mutating rows.
  await sql.pg.exec(fs.readFileSync('deploy/report-submit/check.sql','utf8'));assert.deepEqual(await sql.read(11),before);
  await assert.rejects(sql.pg.exec(plans.apply),/GUARD_CHANGED/);await sql.pg.exec('ROLLBACK');
  await sql.pg.exec(plans.rollback);assert.equal(await functionBody(),plans.old);assert.deepEqual(await sql.read(11),before);
  await assert.rejects(sql.pg.exec(plans.rollback),/GUARD_CHANGED/);await sql.pg.exec('ROLLBACK');
 }finally{await sql.close()}
});
