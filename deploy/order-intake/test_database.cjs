// Disposable PostgreSQL transaction cases; no production connections.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');
const here=__dirname;
const tx=execFileSync('python3',['-c',"import sys;sys.path.insert(0,sys.argv[1]);import database as d;print(d.migration_transaction(d.resource('migration.sql')))",path.join(here,'package')],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
const schema=fs.readFileSync(path.join(here,'package/schema.sql'),'utf8');
const expected=JSON.parse(fs.readFileSync(path.join(here,'package/schema-expected.json'),'utf8'));
async function setup(){const db=new PGlite();await db.exec("CREATE TABLE orders(id bigint generated always as identity primary key,source text,external_id text,work text,amount numeric,original_amount numeric);INSERT INTO orders(source,external_id,work,amount,original_amount) VALUES('Hands','hands:123','old work',4200,4200)");return db;}
test('complete transaction preserves rows and enforces manual number uniqueness',async()=>{
 const db=await setup();try{
  const old=(await db.query('select * from orders')).rows;
  await db.exec(tx);
  assert.deepEqual((await db.query(schema)).rows[0].json_build_object,expected);
  assert.deepEqual((await db.query('select id,source,external_id,work,amount,original_amount from orders')).rows,old);
  await assert.rejects(db.exec("INSERT INTO orders(source,order_number) VALUES('Руки','123')"),e=>e.code==='23505');
  await db.exec("INSERT INTO orders(source,order_number,received_date) VALUES('Телефон','00-296','2026-10-20')");
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,2);
 }finally{await db.close();}
});
test('existing partial schema is refused before any additive mutation',async()=>{
 const db=await setup();try{
  await db.exec('ALTER TABLE orders ADD COLUMN order_number text');
  await assert.rejects(db.exec(tx),/INTAKE_BASELINE_CHANGED/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='orders' AND column_name='received_date'")).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,1);
 }finally{await db.close();}
});
test('late DDL error rolls back columns, functions, triggers and keeps old row',async()=>{
 const db=await setup();try{
  await assert.rejects(db.exec(tx.replace("NOTIFY pgrst, 'reload schema';",'SELECT definitely_missing();')));
  await db.exec('ROLLBACK');
  const actual=(await db.query(schema)).rows[0].json_build_object;
  assert.ok(Object.values(actual).every(x=>x.length===0));
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,1);
 }finally{await db.close();}
});
test('retry does not replace already installed functions or new customer rows',async()=>{
 const db=await setup();try{
  await db.exec(tx);await db.exec("INSERT INTO orders(source,order_number) VALUES('Телефон','created-after-release')");
  await assert.rejects(db.exec(tx),/INTAKE_BASELINE_CHANGED/);await db.exec('ROLLBACK');
  assert.deepEqual((await db.query(schema)).rows[0].json_build_object,expected);
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n,2);
 }finally{await db.close();}
});
