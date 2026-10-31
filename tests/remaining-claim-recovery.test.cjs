const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const F=require('../finance-data.js'),X=require('../finance-export-data.js');
function python(expression,input){return execFileSync('python3',['-c',`import sys,json\nsys.path[:0]=['deploy/master-finance','deploy/finance-export']\nimport database as d, recover_remaining as r\nr.db=d\n${expression}`],{input:input?JSON.stringify(input):undefined,encoding:'utf8'})}
async function state(db){const results=await db.exec(python('print(r.current_sql())'));return results.find(r=>r.rows?.[0]?.state).rows[0].state}
async function setup(){
 const db=new PGlite();
 await db.exec(`SET TIME ZONE 'UTC';CREATE ROLE service_role BYPASSRLS;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE TABLE orders(id bigint PRIMARY KEY,order_number text,external_id text,source text,status text,is_claim boolean,created_at timestamptz,
 completed_at timestamptz,report_reviewed_at timestamptz,scheduled_date date,claim_opened_at timestamptz,claim_closed_at timestamptz,
 claim_revisit_payment numeric,amount numeric,master_payout numeric,extra_work_amount numeric,uncompleted_work_amount numeric,
 master_staff_id text,work text,phone text);
 CREATE TABLE order_claims(id bigint PRIMARY KEY,order_id bigint,status text,opened_at timestamptz,closed_at timestamptz,pay_revisit boolean,revisit_payment numeric);
 INSERT INTO orders(id,external_id,source,status,is_claim,completed_at,claim_opened_at,amount,master_payout,extra_work_amount,master_staff_id,phone) VALUES
 (1688,'hands:7337869','Hands','В работе',true,NULL,'2026-10-09T08:55:57.233006Z',8000,4506.19,0,'original-master','PRIVATE_PHONE'),
 (1819,'app_manual','Avito','Рекламация',false,NULL,NULL,0,0,0,'different-master','OTHER_PHONE'),
 (1769,'hands:7395762','Hands','Выполнена',true,'2026-10-31T14:24:50.693Z','2026-10-29T09:25:47Z',6796,3754.79,0,'another-master','FIXED_PHONE');
 INSERT INTO order_claims VALUES(1,1688,'open','2026-10-09T08:55:57.233006Z',NULL,false,0),(4,1769,'closed','2026-10-29T09:25:47Z','2026-10-31T14:24:50.693Z',false,0);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261031180000_claim_financial_snapshots.sql','utf8'));
 await db.exec(`INSERT INTO order_financial_snapshots(order_id,financial_data,basis) VALUES(1769,'{"id":1769,"status":"Выполнена","master_payout":3754.79,"completed_at":"2026-10-13T17:10:21.807Z"}','already_repaired');`);
 const expected=await state(db),snapshot={id:1688,external_id:'hands:7337869',source:'Hands',status:'Выполнена',completed_at:'2026-09-30T15:45:51.605+00:00',master_payout:4506.19,extra_work_amount:0,amount:8000,master_staff_id:'original-master',work:'Монтаж'};
 const plan={expected,snapshot};
 return {db,plan,sql:python('print(r.repair_sql(json.load(sys.stdin)))',plan)};
}
test('remaining recovery inserts September accrual once without altering operational orders, claim journal or previous recovery',async()=>{
 const {db,plan,sql}=await setup();
 try{
  const orders=await db.query('SELECT to_jsonb(o) row FROM orders o ORDER BY id'),claims=await db.query('SELECT * FROM order_claims ORDER BY id');
  const prior=await db.query('SELECT * FROM order_financial_snapshots WHERE order_id=1769');
  await db.exec(sql);
  assert.deepEqual(await db.query('SELECT to_jsonb(o) row FROM orders o ORDER BY id'),orders);
  assert.deepEqual(await db.query('SELECT * FROM order_claims ORDER BY id'),claims);
  assert.deepEqual(await db.query('SELECT * FROM order_financial_snapshots WHERE order_id=1769'),prior);
  const history=await state(db);assert.deepEqual(history.saved.financial_data,plan.snapshot);
  assert.equal(history.current.status,'В работе');assert.equal(history.claims[0].status,'open');
  assert.ok(!JSON.stringify(history).includes('PHONE'));
  const before=await db.query('SELECT * FROM order_financial_snapshots ORDER BY order_id');
  await db.exec(python('print(r.repair_sql(json.load(sys.stdin)))',{...plan,expected:history}));
  assert.deepEqual(await db.query('SELECT * FROM order_financial_snapshots ORDER BY order_id'),before);
  await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT count(*)::int n FROM order_financial_snapshots')).rows[0].n,2);
  await assert.rejects(db.exec('DELETE FROM order_financial_snapshots'),/permission denied/);await db.exec('RESET ROLE');
  await db.exec('SET ROLE authenticated');await assert.rejects(db.exec('SELECT * FROM order_financial_snapshots'),/permission denied/);await db.exec('RESET ROLE');
  const diagnostic=fs.readFileSync('deploy/master-finance/recover_remaining.py','utf8').match(/OTHER_SQL = """([\s\S]*?)"""/)[1];
  const other=(await db.exec(diagnostic)).find(r=>r.rows?.[0]?.json_build_object).rows[0].json_build_object;
  assert.equal(other.remaining,1);assert.equal(other.other.id,1819);assert.equal(other.other.pay,0);
  assert.equal(other.other.claim_events,0);assert.equal(other.other.completed_at,null);assert.ok(!JSON.stringify(other).includes('PHONE'));
 }finally{await db.close()}
});
test('recovered accrual is exported only in September for its original master and never in the repeat-visit month',async()=>{
 const {db,plan,sql}=await setup();
 try{
  await db.exec(sql);const live=await state(db);
  const order={...live.current,financial_snapshot:live.saved.financial_data};
  const staff=[{id:'original-master',full_name:'Архивный мастер',role:'master'}];
  const selected=month=>X.snapshot([order],staff,[],{period:{start:`2026-${month}-01`,end:`2026-${month}-${month==='09'?'30':'31'}`},master:'original-master',format:'master'});
  const september=selected('09'),october=selected('10');
  assert.equal(september.rows.length,1);assert.equal(september.total.pay,4506.19);
  assert.equal([...X.sheets(september)[0].rows()][0][5],4506.19);
  assert.equal(october.rows.length,0);assert.equal(october.total.pay,0);
  const rows=F.records([order],staff);assert.equal(rows[0].financialUnresolved,false);
  assert.equal(order.status,'В работе');assert.equal(order.completed_at,null);
 }finally{await db.close()}
});
test('concurrent changes or conflicting original history reject the entire repair without overwriting them',async()=>{
 for(const mutation of ['pay','journal','snapshot','access','trigger']){
  const {db,sql}=await setup();
  try{
   if(mutation==='pay')await db.exec('UPDATE orders SET master_payout=4600 WHERE id=1688');
   if(mutation==='journal')await db.exec("UPDATE order_claims SET pay_revisit=true,revisit_payment=500 WHERE id=1");
   if(mutation==='snapshot')await db.exec(`INSERT INTO order_financial_snapshots(order_id,financial_data,basis) VALUES(1688,'{"id":1688}','outside_change')`);
   if(mutation==='access')await db.exec('GRANT SELECT ON order_financial_snapshots TO authenticated');
   if(mutation==='trigger')await db.exec("CREATE FUNCTION custom_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE orders SET master_payout=9999 WHERE id=1688;RETURN new;END$$;CREATE TRIGGER custom_history BEFORE INSERT ON order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION custom_history();");
   const beforeOrders=await db.query('SELECT * FROM orders ORDER BY id'),beforeClaims=await db.query('SELECT * FROM order_claims ORDER BY id'),beforeSnapshots=await db.query('SELECT * FROM order_financial_snapshots ORDER BY order_id');
   await assert.rejects(db.exec(sql),/HISTORY_CHANGED_AFTER_PREPARE/);await db.exec('ROLLBACK');
   assert.deepEqual(await db.query('SELECT * FROM orders ORDER BY id'),beforeOrders);
   assert.deepEqual(await db.query('SELECT * FROM order_claims ORDER BY id'),beforeClaims);
   assert.deepEqual(await db.query('SELECT * FROM order_financial_snapshots ORDER BY order_id'),beforeSnapshots);
  }finally{await db.close()}
 }
});
