// The private live handler contains webhook configuration absent from this repo.
// Change only its reviewed v8 import routine plus one dependency import.
const fs=require('node:fs');
function patch(source){
 const start=source.indexOf('async function importOrder('),end=source.indexOf('\nasync function syncOrders(',start);
 const expected=fs.readFileSync(require('node:path').join(__dirname,'../tests/fixtures/hands-v8-import.ts'),'utf8').split('\nasync function syncOrders(')[0];
 if(start<0||end<0||source.slice(start,end)!==expected)throw Error('Unknown Hands import; refusing patch');
 let body=expected.replace("select('id,status,report_review_status,updated_at')","select('id,status,report_review_status,updated_at,apartment,comment,hands_comment_source,hands_detail_overrides')")
  .replace("if(base.status==='Выполнена')","Object.assign(base,handsDetailsPatch(o,prev.data,externalComment(o)));if(base.status==='Выполнена')")
  .replace('...base,comment:externalComment(o)||null,','...base,')
  .replace("if(prev.data?.status==='Выполнена'||prev.data?.report_review_status==='approved')return{ok:true,id:prev.data.id,created:false,preserved:true};","if(prev.data?.status==='Выполнена'||prev.data?.report_review_status==='approved'){await updateAcceptedHandsDetails(db,o,prev.data,externalComment(o));return{ok:true,id:prev.data.id,created:false,preserved:true}};");
 return 'import { handsDetailsPatch, updateAcceptedHandsDetails } from "./hands-details.ts";\n'+source.slice(0,start)+body+source.slice(end);
}
if(require.main===module){
 const [input,output]=process.argv.slice(2),data=JSON.parse(fs.readFileSync(input,'utf8'));
 if((data.slug||data.name)!=='hands-api'||data.version!==8||data.verify_jwt!==false)throw Error('Expected reviewed live Hands v8');
 data.files.find(f=>f.name==='index.ts').content=patch(data.files.find(f=>f.name==='index.ts').content);
 data.files.push({name:'hands-details.ts',content:fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/_shared/hands-details.ts'),'utf8')});
 fs.writeFileSync(output,JSON.stringify(data),{mode:0o600});console.log('Import-only patch written privately');
}
module.exports={patch};
