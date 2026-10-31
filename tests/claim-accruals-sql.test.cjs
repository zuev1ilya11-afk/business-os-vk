const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('database keeps one immutable accrual before a reclamation resets dates, and closes the claim on report acceptance',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.orders(id bigint PRIMARY KEY,status text,is_claim boolean DEFAULT false,completed_at timestamptz,report_reviewed_at timestamptz,claim_closed_at timestamptz,amount numeric,master_payout numeric,extra_work_amount numeric,source text,master_staff_id uuid,work text,phone text,report_photo_urls text);
  CREATE TABLE public.order_claims(id bigint PRIMARY KEY,order_id bigint,status text,opened_at timestamptz,closed_at timestamptz);
  INSERT INTO public.orders VALUES(1769,'Выполнена',false,'2026-09-25T12:00:00Z','2026-09-25T12:00:00Z',NULL,1000,552.5,100,'Hands','00000000-0000-0000-0000-000000000003','Монтаж','PRIVATE_PHONE','PRIVATE_ATTACHMENTS');
  INSERT INTO public.order_claims VALUES(4,1769,'open','2026-10-29T09:25:47Z',NULL);`);
  for(const column of ['report_review_status','report_act_url','report_type','report_measurement_url','master_workflow_stage','report_upload_token','report_archive_url','drive_archive_status','drive_archive_folder_id','drive_archive_url','drive_archive_error','report_reviewed_by','report_review_comment'])await db.exec(`ALTER TABLE orders ADD COLUMN ${column} text`);
  for(const column of ['report_uploaded_at','master_called_at','master_agreed_at','master_departed_at','master_arrived_at','master_started_at','drive_archived_at'])await db.exec(`ALTER TABLE orders ADD COLUMN ${column} timestamptz`);
  const guard=fs.readFileSync('supabase/migrations/20261004100840_manual_order_completion.sql','utf8').match(/CREATE OR REPLACE FUNCTION public.guard_order_completion\(\)[\s\S]*?\$function\$;/)[0];
  await db.exec(guard+"\nCREATE TRIGGER guard_order_completion BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_completion();");
  const path='supabase/migrations/20261031180000_claim_financial_snapshots.sql';
  if(fs.existsSync(path))await db.exec(fs.readFileSync(path,'utf8'));
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='order_financial_snapshots'")).rows[0].n,1);
  await db.exec("UPDATE orders SET status='В работе',is_claim=true WHERE id=1769");
  const saved=(await db.query('SELECT * FROM order_financial_snapshots')).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].financial_data.master_payout,552.5);
  assert.equal(saved[0].financial_data.extra_work_amount,100);
  assert.match(saved[0].financial_data.completed_at,/2026-09-25/);
  assert.ok(!JSON.stringify(saved).includes('PRIVATE_'));
  assert.equal((await db.query('SELECT completed_at FROM orders')).rows[0].completed_at,null);
  await assert.rejects(db.exec("UPDATE orders SET status='Выполнена' WHERE id=1769"),/REPORT_REQUIRED/);
  assert.equal((await db.query('SELECT status FROM order_claims')).rows[0].status,'open');
  await db.exec("UPDATE orders SET status='Выполнена',completed_at='2026-10-31T14:24:50Z',report_reviewed_at='2026-10-31T14:24:50Z',master_payout=900,report_uploaded_at=now(),report_act_url='ACT',report_photo_urls='[\"PHOTO\"]' WHERE id=1769");
  assert.equal((await db.query('SELECT status FROM order_claims')).rows[0].status,'closed');
  assert.ok((await db.query('SELECT claim_closed_at FROM orders')).rows[0].claim_closed_at);
  await db.exec("UPDATE orders SET status='В работе',claim_closed_at=NULL WHERE id=1769; UPDATE orders SET status='Выполнена',completed_at='2026-11-05T12:00:00Z',report_uploaded_at=now(),report_act_url='ACT2',report_photo_urls='[\"PHOTO2\"]' WHERE id=1769;");
  assert.deepEqual((await db.query('SELECT * FROM order_financial_snapshots')).rows,saved);
  const grants=(await db.query("SELECT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_name='order_financial_snapshots' AND grantee IN ('service_role','anon','authenticated')")).rows;
  assert.deepEqual(grants,[{grantee:'service_role',privilege_type:'SELECT'}]);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='order_financial_snapshots'")).rows[0].relrowsecurity,true);
 }finally{await db.close()}
});
