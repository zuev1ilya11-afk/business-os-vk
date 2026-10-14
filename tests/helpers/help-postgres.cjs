// Test-only Supabase query adapter. Runs real SQL in an isolated PostgreSQL WASM
// instance. This is never imported by the production edge function.
function postgresAdapter(pg){return {from(table){
 if(!['business_staff','master_help_materials'].includes(table))throw Error('Unexpected test table');
 let mode='select',payload,filters=[],orders=[],from=0,size=1000,single=false;
 const ident=k=>{if(!/^[a-z_]+$/.test(k))throw Error('Invalid column');return '"'+k+'"'};
 const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(k){orders.push(k);return q},range(a,b){from=a;size=b-a+1;return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(v){mode='insert';payload=v;return q},update(v){mode='update';payload=v;return q},then(resolve,reject){return (async()=>{
 const params=[],bind=v=>{params.push(v&&typeof v==='object'?JSON.stringify(v):v);return '$'+params.length};let sql;
 if(mode==='insert')sql=`insert into ${table} (${Object.keys(payload).map(ident).join(',')}) values (${Object.values(payload).map(bind).join(',')}) returning *`;
 else{const prefix=mode==='update'?`update ${table} set `+Object.entries(payload).map(([k,v])=>ident(k)+'='+bind(v)).join(','):`select * from ${table}`;const where=filters.length?' where '+filters.map(([k,v])=>ident(k)+'='+bind(v)).join(' and '):'';sql=prefix+where+(mode==='update'?' returning *':(orders.length?' order by '+orders.map(ident).join(','):'')+` limit ${Number(size)} offset ${Number(from)}`)}
 try{const r=await pg.query(sql,params);return {data:single?r.rows[0]||null:r.rows,error:null}}catch(error){return {data:null,error}}
 })().then(resolve,reject)}};return q;
}}}
module.exports={postgresAdapter};
