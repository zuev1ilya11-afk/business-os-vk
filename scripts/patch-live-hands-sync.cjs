// Never replace the private live handler with the repository's older handler.
const fs=require('node:fs'),path=require('node:path');
const expected=fs.readFileSync(path.join(__dirname,'../tests/fixtures/hands-v11-sync.ts'),'utf8').trimEnd();
function patch(source){
 const start=source.indexOf('async function syncOrders(');
 if(start<0||source.indexOf('async function syncOrders(',start+1)!==-1||source.slice(start,start+expected.length)!==expected||source.includes('hands-sync.ts'))throw Error('Unknown Hands sync; refusing patch');
 const after=source.slice(start+expected.length);
 if(after&&!after.startsWith('\n'))throw Error('Unknown Hands sync boundary; refusing patch');
 const replacement="async function syncOrders(db:any,b:any){const map=await staffMap(db);return await syncHandsPages(b,'ACTIVE',q=>hands(`/orders/?${q}`),o=>importOrder(db,o,map))}";
 return 'import { syncHandsPages } from "./hands-sync.ts";\n'+source.slice(0,start)+replacement+after;
}
function patchExport(data){
 if((data.slug||data.name)!=='hands-api'||data.version!==11||data.verify_jwt!==false||!Array.isArray(data.files))throw Error('Expected reviewed private Hands v11 export');
 const entries=data.files.filter(f=>f.name==='index.ts');
 if(entries.length!==1||data.files.some(f=>f.name==='hands-sync.ts'))throw Error('Unexpected export files');
 const result=structuredClone(data);
 result.files.find(f=>f.name==='index.ts').content=patch(entries[0].content);
 result.files.push({name:'hands-sync.ts',content:fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/hands-sync.ts'),'utf8')});
 return result;
}
if(require.main===module){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: patch-live-hands-sync.cjs private-input.json private-output.json');
 const result=patchExport(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(result),{mode:0o600,flag:'wx'});
 console.log('Sync-only patch written privately; no deployment performed');
}
module.exports={patch,patchExport};
