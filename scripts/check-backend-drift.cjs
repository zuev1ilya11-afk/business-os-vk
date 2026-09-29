const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
const critical=['mini-app-api','report-api','order-lifecycle-api','drive-archive-api','order-meta-api','master-workflow-api','report-file-upload'];
function check(observed,baseline,root){
 if(!Array.isArray(observed)||!observed.length)throw new Error('Expected fresh get_edge_function results with files[].content');
 const failures=[];const seen=new Set();
 for(const live of observed){
  const name=live.slug||live.name;seen.add(name);const expected=baseline.find(x=>x.name===name);
  if(!expected){failures.push(`${name}: new function`);continue}
  if(live.version!==expected.version||live.verify_jwt!==expected.verify_jwt||live.status!==expected.status)failures.push(`${name}: deployment metadata drift`);
  for(const f of expected.files){
   const file=live.files?.find(x=>x.name===f.name);
   if(!file||typeof file.content!=='string'||hash(file.content)!==f.source_sha256)failures.push(`${name}/${f.name}: source drift`);
   if(root&&critical.includes(name)&&f.repository_path){
    const local=path.resolve(root,f.repository_path);if(!fs.existsSync(local)||hash(fs.readFileSync(local))!==f.source_sha256)failures.push(`${name}: critical repository/production mismatch`);
   }
  }
  if(live.files?.length!==expected.files.length)failures.push(`${name}: file inventory drift`);
 }
 for(const expected of baseline)if(!seen.has(expected.name))failures.push(`${expected.name}: missing live function`);
 return failures;
}
if(require.main===module){
 try{
  if(!process.argv[2])throw new Error('Usage: node scripts/check-backend-drift.cjs PRIVATE_FRESH_EXPORT.json');
  const root=path.resolve(__dirname,'..'),baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/backend-production-inventory.json')));
  const failures=check(JSON.parse(fs.readFileSync(process.argv[2])),baseline,root);
  for(const f of failures)console.error(f);
  console.log(`Backend drift check: ${failures.length?'FAIL':'PASS'} (${baseline.length} functions; ${critical.length} critical sources)`);process.exitCode=failures.length?1:0;
 }catch(e){console.error(e.message);process.exitCode=1}
}
module.exports={check};
