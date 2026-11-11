// Disposable PostgreSQL (PGlite) behind the existing Edge test auth harness.
// The actual production trigger SQL runs; external Storage/Drive stay fixtures.
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration='supabase/migrations/20261110140000_preserve_submitted_report.sql';
const ident=k=>{if(!/^[a-z_][a-z_0-9]*$/i.test(k))throw Error('Unsafe test column');return '"'+k+'"'};
async function reportSql(db,{fixed=true}={}){
 const pg=new PGlite(),read=p=>fs.readFileSync(p,'utf8');
 await pg.exec(read('tests/sql/order-guards-schema.sql').replace('id integer PRIMARY KEY','id text PRIMARY KEY'));
 await pg.exec(read('supabase/migrations/20260929160000_capture_live_order_guards.sql'));
 const manual=read('supabase/migrations/20261004100840_manual_order_completion.sql');
 await pg.exec(manual.slice(manual.indexOf('CREATE OR REPLACE FUNCTION public.guard_order_completion()'),manual.indexOf('-- Custom BOS authentication')));
 const columns=new Set((await pg.query("select column_name from information_schema.columns where table_name='orders'")).rows.map(x=>x.column_name));
 async function extend(row){for(const [k,v] of Object.entries(row)){if(columns.has(k))continue;const type=typeof v==='boolean'?'boolean':typeof v==='number'?'numeric':v&&typeof v==='object'?'jsonb':'text';await pg.exec(`alter table orders add column ${ident(k)} ${type}`);columns.add(k)}}
 const value=(k,v)=>v==null?null:typeof v==='object'?JSON.stringify(v):v;
 // Include optional API patch fields before simultaneous requests start.
 await extend({time_slot:'',master_staff_id:'',external_source:'',external_id:'',source:'',amount:0,original_amount:0,extra_work_done:false,extra_work_description:'',extra_work_amount:0,uncompleted_work_done:false,uncompleted_work_description:'',uncompleted_work_amount:0,uncompleted_work_items:[],work_items:[],sync_status:''});
 for(const row of db.tables.orders){await extend(row);const keys=Object.keys(row);await pg.query(`insert into orders(${keys.map(ident)}) values(${keys.map((_,i)=>'$'+(i+1))})`,keys.map(k=>value(k,row[k])))}
 if(fixed)await pg.exec(read(migration));
 await pg.exec('COMMIT');
 const memoryFrom=db.from.bind(db),trace=[],orderColumns=columns;
 db.from=table=>{
  if(table!=='orders')return memoryFrom(table);
  let mode='select',payload,filters=[],params=[],columns='*',single=false,limit=1000,offset=0;
  const filter=(k,op,v)=>{params.push(v);filters.push(`${ident(k)} ${op} $${params.length}`);return q};
  const q={select(c='*'){columns=c;return q},eq:(k,v)=>filter(k,'=',v),neq:(k,v)=>filter(k,'<>',v),gte:(k,v)=>filter(k,'>=',v),lte:(k,v)=>filter(k,'<=',v),is(k,v){if(v!==null)throw Error('Test supports IS NULL only');filters.push(`${ident(k)} is null`);return q},in(k,vs){params.push(vs);filters.push(`${ident(k)}=any($${params.length})`);return q},order(){return q},limit(n){limit=n;return q},range(a,b){offset=a;limit=b-a+1;return q},single(){single=true;return q},maybeSingle(){single=true;return q},update(p){mode='update';payload=p;return q},then(resolve,reject){return (async()=>{
   db.calls.push({table,mode,columns,payload:structuredClone(payload)});
   const selected=columns==='*'?'*':columns.split(',').map(ident).join(',');
   const where=filters.length?' where '+filters.join(' and '):'';
   let sql;
   if(mode==='update'){
    // Tests intentionally use the real SQL compare-and-swap predicates.
    const keys=Object.keys(payload);for(const key of keys)if(!orderColumns.has(key))throw Error('Unknown test update column '+key);
    const assigns=keys.map(k=>{params.push(value(k,payload[k]));return `${ident(k)}=$${params.length}`});
    sql=`with changed as (update orders set ${assigns} ${where} returning ${selected}) select to_jsonb(changed) row from changed`;
   }else sql=`select to_jsonb(t) row from (select ${selected} from orders ${where} limit ${Number(limit)} offset ${Number(offset)}) t`;
   try{const rows=(await pg.query(sql,params)).rows.map(x=>x.row);if(mode==='update')trace.push({patch:structuredClone(payload),rows:structuredClone(rows)});return {data:single?rows[0]||null:rows,error:null}}
   catch(error){return {data:null,error}}
  })().then(resolve,reject)}};
  return q;
 };
 return {pg,trace,read:async id=>(await pg.query('select to_jsonb(o) row from orders o where id=$1',[String(id)])).rows[0]?.row,close:()=>pg.close(),migration};
}
module.exports={reportSql,migration};
