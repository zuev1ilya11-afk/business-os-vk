const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {row,init,owner,master}=require('./helpers/lemana-schema.cjs');
test('SQL migration is additive, RPC is create-only, repeat and queued confirmations are idempotent',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),pg=new PGlite();try{await init(pg);const before=(await pg.query('select * from orders where id=1')).rows[0];
 const rpc=(o,actor=owner)=>pg.query('select bos_import_lemana_order($1::uuid,$2::jsonb) as result',[actor,JSON.stringify(o)]);
 const concurrent=await Promise.all([rpc(row()),rpc(row())]);assert.deepEqual(concurrent.map(r=>r.rows[0].result.kind).sort(),['created','skipped']);assert.equal((await rpc(row())).rows[0].result.kind,'skipped');
 assert.equal((await rpc(row('manual-001'))).rows[0].result.kind,'skipped');assert.deepEqual((await pg.query('select * from orders where id=1')).rows[0],before);
 await assert.rejects(rpc(row('005'),master),e=>e.code==='42501');
 await assert.rejects(pg.exec("insert into orders(client,address,work,source,order_number)values('Тест','Тест','Тест','Телефон','00042')"),e=>e.code==='23505');
 await assert.rejects(pg.exec("set role authenticated;select bos_import_lemana_order('"+owner+"','{}'::jsonb)"),e=>e.code==='42501');await pg.exec('reset role');
 assert.equal((await pg.query('select count(*)::int n from orders')).rows[0].n,2);
 }finally{await pg.close()}
});
test('duplicate guard sees existing Lemana orders hidden by city RLS',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),pg=new PGlite();try{await init(pg);
 await pg.query('select bos_import_lemana_order($1::uuid,$2::jsonb)',[owner,JSON.stringify({...row(),city:'Hidden'})]);
 await pg.exec(`alter table orders enable row level security; grant select,insert on orders to authenticated;grant usage,select on sequence orders_id_seq to authenticated;
 create policy test_read on orders for select to authenticated using(city='Visible');create policy test_insert on orders for insert to authenticated with check(city='Visible');set role authenticated;`);
 assert.equal((await pg.query('select count(*)::int n from orders')).rows[0].n,0);
 await assert.rejects(pg.exec("insert into orders(source,order_number,client,address,work,city)values('Телефон','00042','Тест','Тест','Тест','Visible')"),e=>e.code==='23505');
 }finally{await pg.close()}
});
