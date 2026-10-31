const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('claim diagnostic reads only target order and useful dates without customer fields or writes',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE orders(id bigint,order_number text,external_id text,status text,is_claim boolean,completed_at timestamptz,claim_opened_at timestamptz,master_payout numeric,phone text,report_act_url text,manual_completion_history jsonb);
  CREATE TABLE order_claims(id bigint,order_id bigint,status text,opened_at timestamptz,closed_at timestamptz,pay_revisit boolean,revisit_payment numeric,reason text);
  INSERT INTO orders VALUES(1,'7395762','hands:7395762','Выполнена',true,'2026-10-31T09:00:00Z','2026-10-30T09:00:00Z',600,'PRIVATE_PHONE','PRIVATE_ATTACHMENT','[{"at":"2026-09-25T09:00:00Z","reason":"PRIVATE_REASON"}]'),(2,'123','hands:123','Выполнена',false,'2026-10-31T09:00:00Z',NULL,900,'OTHER_PHONE','OTHER_ATTACHMENT','[]');
  INSERT INTO order_claims VALUES(10,1,'closed','2026-10-30T09:00:00Z','2026-10-31T09:00:00Z',false,0,'PRIVATE_CLAIM'),(11,2,'closed','2026-10-31T09:00:00Z','2026-10-31T10:00:00Z',false,0,'OTHER_CLAIM');`);
  const before=await db.query('SELECT * FROM orders ORDER BY id');
  const sql=fs.readFileSync('deploy/finance-export/check-claim.py','utf8').match(/SQL = """([\s\S]*?)"""/)[1];
  const results=await db.exec(sql),data=results.find(r=>r.rows?.[0]?.json_build_object)?.rows[0].json_build_object;
  assert.equal(data.orders.length,1);assert.equal(data.orders[0].id,1);assert.equal(data.orders[0].master_payout,600);
  assert.equal(data.orders[0].manual_dates[0],'2026-09-25T09:00:00Z');
  assert.equal(data.claims.length,1);assert.equal(data.claims[0].pay_revisit,false);
  for(const value of ['PRIVATE_','OTHER_'])assert.ok(!JSON.stringify(data).includes(value));
  assert.deepEqual(await db.query('SELECT * FROM orders ORDER BY id'),before);
 }finally{await db.close()}
});
