const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
function python(expression,input){return execFileSync('python3',['-c',`import sys,json\nsys.path[:0]=['deploy/master-finance','deploy/finance-export']\nimport database as d\n${expression}`],{input:input?JSON.stringify(input):undefined,encoding:'utf8'})}
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE service_role BYPASSRLS;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE TABLE orders(id bigint PRIMARY KEY,order_number text,status text,is_claim boolean,completed_at timestamptz,report_reviewed_at timestamptz,claim_opened_at timestamptz,claim_closed_at timestamptz,claim_revisit_payment numeric,amount numeric,master_payout numeric,extra_work_amount numeric,uncompleted_work_amount numeric,phone text);
 CREATE TABLE order_claims(id bigint PRIMARY KEY,order_id bigint,status text,opened_at timestamptz,closed_at timestamptz,pay_revisit boolean,revisit_payment numeric);
 INSERT INTO orders VALUES(1769,'7395762','Выполнена',true,'2026-10-31T14:24:50.693Z','2026-10-31T14:24:50.693Z','2026-10-29T09:25:47.878Z',NULL,0,6796,3754.79,0,0,'PRIVATE_PHONE'),(999,'OTHER','Выполнена',false,'2026-10-01T12:00:00Z',NULL,NULL,NULL,0,100,60,0,0,'OTHER_PHONE');
 INSERT INTO order_claims VALUES(4,1769,'open','2026-10-29T09:25:47.657163Z',NULL,false,0);`);
 const result=await db.exec(python('print(d.current_sql())'));
 const live=result.find(r=>r.rows?.[0]?.json_build_object).rows[0].json_build_object;
 const snapshot={...live.current,status:'Выполнена',completed_at:'2026-10-13 17:10:21.807+00',report_reviewed_at:'2026-10-13 17:10:21.807+00'};
 for(const k of ['is_claim','claim_opened_at','claim_closed_at','claim_revisit_payment'])delete snapshot[k];
 const plan={snapshot,expected_current:live.current,expected_claim:live.claim,existing:false};
 const sql=python("p=json.load(sys.stdin)\nprint(d.repair_sql(p,open('supabase/migrations/20261031180000_claim_financial_snapshots.sql').read()))",plan);
 return {db,plan,sql};
}
test('release transaction restores original accrual once, retains operational dates/pay and closes only the target claim',async()=>{
 const {db,plan,sql}=await setup();
 try{
  const before=(await db.query('SELECT to_jsonb(o) row FROM orders o ORDER BY id')).rows;
  await db.exec(sql);
  const after=(await db.query('SELECT to_jsonb(o) row FROM orders o ORDER BY id')).rows;
  assert.deepEqual(after[0],before[0]);
  assert.deepEqual({...after[1].row,claim_closed_at:null},before[1].row);
  const saved=(await db.query('SELECT * FROM order_financial_snapshots')).rows;
  assert.equal(saved.length,1);assert.deepEqual(saved[0].financial_data,plan.snapshot);assert.equal(saved[0].basis,'verified_backup_7395762_20261013');
  assert.ok(!JSON.stringify(saved).includes('PHONE'));
  assert.equal((await db.query('SELECT status FROM order_claims')).rows[0].status,'closed');
  const fn=(await db.query("SELECT proconfig,prosecdef FROM pg_proc WHERE proname='bos_capture_claim_finance'")).rows[0];
  assert.deepEqual(fn.proconfig,['search_path=""']);assert.equal(fn.prosecdef,true);
  await assert.rejects(db.exec(sql),/CLAIM_SCHEMA_CHANGED/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM order_financial_snapshots')).rows[0].n,1);
  await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT count(*)::int n FROM order_financial_snapshots')).rows[0].n,1);
  await assert.rejects(db.exec('DELETE FROM order_financial_snapshots'),/permission denied/);await db.exec('RESET ROLE');
 }finally{await db.close()}
});
test('changed target or unexpected database trigger rolls back repair and schema without overwriting user changes',async()=>{
 for(const mutation of ['before','during']){
  const {db,sql}=await setup();
  try{
   if(mutation==='before')await db.exec('UPDATE orders SET master_payout=4000 WHERE id=1769');
   else await db.exec("CREATE FUNCTION unsafe_change() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN new.master_payout:=9999;RETURN new;END$$;CREATE TRIGGER zz_change BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION unsafe_change();");
   const before=await db.query('SELECT * FROM orders ORDER BY id');
   await assert.rejects(db.exec(sql),mutation==='before'?/CLAIM_CHANGED_AFTER_PREPARE/:/CLAIM_FINANCIAL_VALUES_MUTATED/);await db.exec('ROLLBACK');
   assert.deepEqual(await db.query('SELECT * FROM orders ORDER BY id'),before);
   assert.equal((await db.query("SELECT to_regclass('public.order_financial_snapshots') exists")).rows[0].exists,null);
   assert.equal((await db.query('SELECT status FROM order_claims')).rows[0].status,'open');
  }finally{await db.close()}
 }
});
