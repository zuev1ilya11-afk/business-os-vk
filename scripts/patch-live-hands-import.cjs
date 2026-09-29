// Patch only the known production import function. Never log/export the surrounding
// source: the existing deployment contains private webhook configuration.
const fs=require('node:fs');
function patch(source){
 const start=source.indexOf('async function importOrder('),end=source.indexOf('\nasync function syncOrders(',start);
 if(start<0||end<0)throw new Error('Unknown Hands source layout; review the fresh export');
 let body=source.slice(start,end);
 const replace=(before,after)=>{if(body.split(before).length!==2)throw new Error('Unexpected Hands import source; refusing patch');body=body.replace(before,after)};
 replace(".select('id').eq('external_source','hands')",".select('id,status,report_review_status,updated_at').eq('external_source','hands')");
 replace('if(prev.data){const q=await db.from(\'orders\').update(base).eq(\'id\',prev.data.id).select(\'id\').single();',
  "if(prev.data?.status==='Выполнена'||prev.data?.report_review_status==='approved')return{ok:true,id:prev.data.id,created:false,preserved:true};if(base.status==='Выполнена')base.status=prev.data?.status||'В работе';if(prev.data){let update=db.from('orders').update(base).eq('id',prev.data.id);for(const key of ['status','report_review_status','updated_at'])update=prev.data[key]==null?update.is(key,null):update.eq(key,prev.data[key]);const q=await update.select('id').maybeSingle();");
 replace('return{ok:true,id:q.data.id,created:false}',"if(!q.data)throw new Error('ORDER_CHANGED');return{ok:true,id:q.data.id,created:false}");
 return source.slice(0,start)+body+source.slice(end);
}
if(require.main===module){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Usage: patch-live-hands-import.cjs PRIVATE_EXPORT.json PRIVATE_OUTPUT.json');
 const data=JSON.parse(fs.readFileSync(input,'utf8'));
 if((data.slug||data.name)!=='hands-api'||data.version!==6||data.verify_jwt!==false)throw new Error('Expected reviewed Hands v6; stop on production drift');
 const file=data.files.find(x=>x.name==='index.ts');if(!file)throw new Error('Missing reviewed entrypoint');
 file.content=patch(file.content);
 fs.writeFileSync(output,JSON.stringify(data),{mode:0o600});
 console.log('Patched only Hands import; private output written');
}
module.exports={patch};
