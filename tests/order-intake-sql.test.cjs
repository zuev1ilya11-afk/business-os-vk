const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
// Disposable Postgres contract runner; no production connections.
test('Postgres migration preserves old records and enforces source-scoped manual numbers',async()=>{
 const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');const pg=new PGlite();try{
 await pg.exec("create table orders(id bigint generated always as identity primary key, source text, external_source text, external_id text, created_at timestamptz default now(),work text,amount numeric,original_amount numeric); insert into orders(source,external_source,external_id,created_at) values('Hands','hands','hands:123','2026-08-01T20:00:00Z'),('Телефон','mini_app','app_old','2026-08-02T20:00:00Z');");
 const old=(await pg.query('select * from orders')).rows;
 await pg.exec(fs.readFileSync('supabase/migrations/20261020140000_manual_order_intake.sql','utf8'));
 assert.deepEqual((await pg.query('select id,source,external_source,external_id,created_at,work,amount,original_amount from orders')).rows,old);
 await pg.exec("insert into orders(source,external_source,external_id,order_number,received_date) values('Телефон','mini_app','app_new','00-А/12','2026-09-01');");
 assert.equal((await pg.query("select received_date::text as date,order_number from orders where order_number='00-А/12'")).rows[0].date,'2026-09-01');
 await assert.rejects(pg.exec("insert into orders(source,order_number) values('Телефон','00-А/12')"),e=>e.code==='23505');
 await assert.rejects(pg.exec("insert into orders(source,order_number) values('Руки','123')"),e=>e.code==='23505');
 await pg.exec("insert into orders(source,order_number) values('Авито','00-А/12')");
 await assert.rejects(pg.exec("insert into orders(source,order_number) values('AVITO','00-А/12')"),e=>e.code==='23505');
 await pg.exec("insert into orders(source,external_source,external_id) values('Hands','hands','hands:456')");
 await assert.rejects(pg.exec("insert into orders(source,order_number) values('Телефон',E'line\\n')"));
 await pg.exec("update orders set amount_confirmed=false,amount=0,original_amount=0 where id=1; update orders set amount_confirmed=false where id=1; update orders set amount=2500,original_amount=2500 where id=1");
 assert.equal((await pg.query('select amount_confirmed from orders where id=1')).rows[0].amount_confirmed,true);
 await pg.exec("update orders set amount=0,original_amount=0,amount_confirmed=false where id=1");
 assert.equal((await pg.query('select amount_confirmed from orders where id=1')).rows[0].amount_confirmed,false,'clearing a known price keeps it unknown');
 assert.equal((await pg.query('select count(*)::int as n from orders')).rows[0].n,5);
 }finally{await pg.close()}
});
