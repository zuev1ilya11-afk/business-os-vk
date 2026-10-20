// Disposable preview adapter: the production mini-app-api runs unchanged;
// orders execute in PGlite/Postgres with the real additive intake migration.
// Other services use existing synthetic test fixtures. Never use live data here.
const fs=require('node:fs');const path=require('node:path');const {database,employee}=require('./edge.cjs');
async function previewDatabase(directory){
 const {PGlite}=require(process.env.BOS_PGLITE_MODULE||'@electric-sql/pglite');
 const pg=new PGlite(directory);
 const exists=await pg.query("select to_regclass('public.orders') as name");
 if(!exists.rows[0].name){
 await pg.exec(`create table orders(id bigint generated always as identity primary key,source text,external_source text,external_id text,created_at timestamptz default now(),updated_at timestamptz default now(),amount numeric default 0,original_amount numeric default 0,row_data jsonb not null default '{}',unique(external_source,external_id));`);
 await pg.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261020140000_manual_order_intake.sql'),'utf8'));
 }
 const columns=new Set(['amount','original_amount','id','source','external_source','external_id','created_at','updated_at','order_number','received_date','entrance','floor','intercom','amount_confirmed']);
 const memory=database({business_staff:[employee('owner','owner',{full_name:'Владелец · тест',city:'Санкт-Петербург'}),employee('m','master',{full_name:'Мастер · тест',city:'Санкт-Петербург'})]});
 const original=memory.from;
 memory.from=function(table){if(table!=='orders')return original.call(memory,table);
  let filters=[],mode='select',payload,selection='*',single=false,start=0,end=999,sort=[];
  const safe=k=>{if(!/^[a-z_]+$/.test(k))throw Error('Invalid preview field');return columns.has(k)?`t."${k}"`:`t.row_data->>'${k}'`};
  const q={select(s='*'){selection=s;return q},eq(k,v){filters.push([k,'=',v]);return q},neq(k,v){filters.push([k,'<>',v]);return q},is(k,v){filters.push([k,'is',v]);return q},order(k,o={}){sort.push([k,o.ascending===false?'desc':'asc']);return q},range(a,b){start=a;end=b;return q},limit(n){end=n-1;return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},then(resolve,reject){return (async()=>{
   try{const args=[],bind=v=>{args.push(v);return '$'+args.length},where=()=>filters.length?' where '+filters.map(([k,op,v])=>op==='is'&&v===null?`(${safe(k)}) is null`:`(${safe(k)})::text ${op} ${bind(String(v))}`).join(' and '):'';
   let sql;const record="(to_jsonb(t)-'row_data') || t.row_data as record";
   if(mode==='select'){sql=`select ${record} from orders t`+where()+(sort.length?' order by '+sort.map(([k,dir])=>safe(k)+' '+dir).join(','):'')+` limit ${Number(end-start+1)} offset ${Number(start)}`}
   else if(mode==='insert'){
    const native=Object.fromEntries(Object.entries(payload).filter(([k])=>columns.has(k))),rest=Object.fromEntries(Object.entries(payload).filter(([k])=>!columns.has(k)));
    const keys=Object.keys(native);sql=`insert into orders as t (${[...keys.map(k=>'"'+k+'"'),'row_data'].join(',')}) values (${[...keys.map(k=>bind(native[k])),bind(JSON.stringify(rest))+'::jsonb'].join(',')}) returning ${record}`;
   }else if(mode==='update'){
    const native=Object.entries(payload).filter(([k])=>columns.has(k)),rest=Object.fromEntries(Object.entries(payload).filter(([k])=>!columns.has(k)));
    sql='update orders as t set '+[...native.map(([k,v])=>'"'+k+'"='+bind(v)),`row_data=t.row_data || ${bind(JSON.stringify(rest))}::jsonb`].join(',')+where()+` returning ${record}`;
   }else sql='delete from orders as t'+where()+` returning ${record}`;
   const result=await pg.query(sql,args);let rows=result.rows.map(x=>x.record);if(selection!=='*')rows=rows.map(r=>Object.fromEntries(selection.split(',').map(k=>[k,r[k]])));
   return {data:single?rows[0]||null:rows,error:null};
   }catch(error){return {data:null,error:{code:error.code,message:error.message}}}
  })().then(resolve,reject)}};return q;
 };
 return {db:memory,pg};
}
module.exports={previewDatabase};
