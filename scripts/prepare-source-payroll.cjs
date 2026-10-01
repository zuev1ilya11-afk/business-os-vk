const fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const edits=JSON.parse(fs.readFileSync('scripts/source-payroll-edits.json','utf8'));
const planned=[];
for(const item of edits){
 const text=fs.readFileSync(item.path,'utf8');
 if(hash(text)===item.result)continue;
 if(hash(text)!==item.sha256)throw Error('Baseline changed: '+item.path);
 let chars=Array.from(text);
 for(const [start,end,replacement] of [...item.edits].reverse())chars=[...chars.slice(0,start),...Array.from(replacement),...chars.slice(end)];
 const result=chars.join('');
 if(hash(result)!==item.result)throw Error('Patch mismatch: '+item.path);
 planned.push([item.path,result]);
}
for(const [path,text] of planned)fs.writeFileSync(path,text);
const spec=fs.readFileSync('tests/report-payroll-contract.spec.js','utf8').replace('Hands real report handlers','Direct source real report handlers').replace("order.source='Hands';order.external_source='hands';","order.source='Авито';order.external_source='avito';").replaceAll('442','480').replaceAll('742','780').replace('toBe(127.84)','toBe(0)').replace('toBe(95.88)','toBe(0)');
fs.writeFileSync('tests/source-payroll.spec.js',spec+fs.readFileSync('scripts/source-payroll-browser-tail.txt','utf8'));
