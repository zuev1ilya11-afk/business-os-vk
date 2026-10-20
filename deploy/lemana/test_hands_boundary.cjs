// Synthetic regression evidence for the unchanged, fingerprinted RU Hands gates.
// No production connection, customer fixture, provider call, or persistent DB.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');
const {edge,database,employee}=require('../../tests/helpers/edge.cjs');
const root=path.resolve(__dirname,'../..');
const hash=(algorithm,source)=>createHash(algorithm).update(source).digest('hex');
const lifecycle=fs.readFileSync(path.join(root,'supabase/functions/order-lifecycle-api/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260930195125_hands_report_delivery.sql'),'utf8');
const capture=migration.match(/create or replace function bos_hands_private\.capture_report\(\)[\s\S]*?\$\$;/)?.[0];

test('live-matched lifecycle denies Lemana Hands status/retry even with a hands: external ID',async()=>{
 assert.equal(hash('sha256',lifecycle),'2b8f5dd41d2419512c76ad225d38f570d9c95dca8158b5c9e1acff71470a0520');
 for(const action of ['getHandsReportDelivery','retryHandsReportDelivery']){
  const db=database({business_staff:[employee('owner','owner')],orders:[
   {id:'12',source:'Лемана Про',external_source:'lemana_pro',external_id:'hands:42'},
   {id:'13',source:'Hands',external_source:'hands',external_id:'hands:43'},
  ]});
  const calls=[];
  db.rpc=async(name,parameters)=>{calls.push({name,parameters});return {data:name.endsWith('_retry')?true:{state:'queued'},error:null}};
  const api=edge('order-lifecycle-api',db,{fetch:()=>{throw new Error('Unexpected external request')}});
  const request={action,version:'00000000-0000-4000-8000-000000000001',checked_in_hands:true};
  const denied=await api({...request,order_id:'12'});
  assert.equal(denied.status,404);
  assert.equal(denied.body.error,'Заявка Hands не найдена');
  assert.equal(calls.length,0);
  assert.equal(db.calls.filter(call=>['insert','update','upsert','delete'].includes(call.mode)).length,0);
  // Positive control proves we exercised the real route, rather than UNKNOWN_ACTION.
  const allowed=await api({...request,order_id:'13'});
  assert.equal(allowed.status,200);
  assert.deepEqual(calls.map(call=>call.name),action==='retryHandsReportDelivery'
   ?['bos_hands_report_retry','bos_hands_report_status']:['bos_hands_report_status']);
 }
});

test('live-matched capture_report queues real Hands only, including an adversarial Lemana prefix',async()=>{
 assert.ok(capture,'The exact capture_report migration function must exist');
 const body=capture.match(/as \$\$([\s\S]*?)\$\$;/)?.[1];
 assert.equal(hash('md5',body),'76f419b177d8285210eb252587ca3db2');
 const db=new PGlite();
 try{
  await db.exec(`
   create schema bos_hands_private;
   create table bos_hands_private.runtime(enabled boolean);
   insert into bos_hands_private.runtime values(true);
   create table bos_hands_private.deliveries(
    order_id bigint,report_token text,snapshot jsonb,unique(order_id,report_token));
   create table bos_hands_private.kicks(id bigint generated always as identity);
   create function bos_hands_private.kick() returns void language sql
    as 'insert into bos_hands_private.kicks default values';
   create table public.orders(
    id bigint,external_source text,external_id text,report_review_status text,status text,
    report_upload_token text,report_type text,report_act_url text,report_measurement_url text,
    report_photo_urls text,report_reviewed_at text,report_review_comment text,work text,
    extra_work_done boolean,extra_work_description text,extra_work_amount numeric,
    uncompleted_work_done boolean,uncompleted_work_description text,uncompleted_work_amount numeric);
  `);
  await db.exec(capture);
  await db.exec(`
   create trigger capture after update of report_review_status,report_upload_token on public.orders
    for each row execute function bos_hands_private.capture_report();
   insert into orders(id,external_source,external_id,status)
    values(1,'lemana_pro','hands:42','В работе'),(2,'hands','hands:43','В работе');
   update orders set report_review_status='approved',status='Выполнена',report_upload_token='synthetic';
  `);
  assert.deepEqual((await db.query('select order_id from bos_hands_private.deliveries order by order_id')).rows,[{order_id:2}]);
  assert.equal((await db.query('select count(*)::int n from bos_hands_private.kicks')).rows[0].n,1);
  // A new report token also cannot make the Lemana row enter the provider queue.
  await db.exec("update orders set report_upload_token='synthetic-second' where id=1");
  assert.equal((await db.query('select count(*)::int n from bos_hands_private.deliveries')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from bos_hands_private.kicks')).rows[0].n,1);
 }finally{await db.close()}
});
