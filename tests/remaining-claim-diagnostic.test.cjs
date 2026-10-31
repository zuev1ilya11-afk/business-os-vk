const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('post-deployment diagnostic selects only claims missing history, without writes or customer contacts',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE orders(id bigint,order_number text,external_id text,status text,is_claim boolean,created_at timestamptz,completed_at timestamptz,master_payout numeric,extra_work_amount numeric,claim_revisit_payment numeric,claim_opened_at timestamptz,phone text);
  CREATE TABLE order_financial_snapshots(order_id bigint,financial_data jsonb);
  CREATE TABLE order_claims(order_id bigint,opened_at timestamptz);
  INSERT INTO orders VALUES(1769,'7395762',NULL,'Выполнена',true,now(),now(),3754.79,0,0,now(),'FIXED_PHONE'),(12,'TEST-12',NULL,'В работе',true,now(),NULL,600,0,0,'2026-10-20T12:00:00Z','PRIVATE_PHONE'),(13,'NORMAL',NULL,'Выполнена',false,now(),now(),900,0,0,NULL,'NORMAL_PHONE');
  INSERT INTO order_financial_snapshots VALUES(1769,'{}');
  INSERT INTO order_claims VALUES(12,'2026-10-10T12:00:00Z'),(12,'2026-10-20T12:00:00Z');`);
  const before=await db.query('SELECT * FROM orders ORDER BY id');
  const sql=fs.readFileSync('deploy/master-finance/remaining.py','utf8').match(/SQL = """([\s\S]*?)"""/)[1];
  const output=await db.exec(sql),rows=output.find(r=>r.rows?.[0]?.coalesce)?.rows[0].coalesce;
  assert.equal(rows.length,1);assert.equal(rows[0].id,12);assert.equal(Date.parse(rows[0].first_claim),Date.parse('2026-10-10T12:00:00Z'));
  assert.ok(!JSON.stringify(rows).includes('PHONE'));
  assert.deepEqual(await db.query('SELECT * FROM orders ORDER BY id'),before);
 }finally{await db.close()}
});
