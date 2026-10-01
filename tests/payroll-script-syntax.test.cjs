const {test}=require('node:test');
const fs=require('node:fs'),vm=require('node:vm');
test('production classic scripts and generated bundles parse before release',()=>{
 const shell=JSON.parse(fs.readFileSync('scripts/startup-assets.json','utf8')).shell;
 const lazy=[...fs.readFileSync('pwa-register.js','utf8').matchAll(/'\.\/([^']+\.js)'/g)].map(x=>x[1]);
 for(const name of new Set([...shell,...lazy,'startup-shell.bundle.js','startup-eager.bundle.js','pwa-register.js','sw.js'])){
  try{new vm.Script(fs.readFileSync(name,'utf8'),{filename:name})}catch(e){throw new Error(name+': '+e.message,{cause:e})}
 }
});
