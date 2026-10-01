const fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const changes=JSON.parse(fs.readFileSync('scripts/master-cost-edits.json','utf8')),planned=[];
// Restore two transport-serialization typos before the independent target-hash check.
changes.find(x=>x.path==='supabase/functions/claims-api/index.ts').edits.at(-1)[2]='):';
changes.find(x=>x.path==='tests/master-report-submit-regression.spec.js').after='ec77d02653d02cde04c63a993c4c7eb8a7a60634e6fe6fe49a161a4cb38730a8';
for(const item of changes){
 const original=fs.readFileSync(item.path,'utf8');
 if(hash(original)===item.after)continue;
 if(hash(original)!==item.before)throw Error('Baseline changed: '+item.path);
 let chars=Array.from(original);
 for(const [a,b,text] of [...item.edits].reverse())chars=[...chars.slice(0,a),...Array.from(text),...chars.slice(b)];
 const next=chars.join('');if(hash(next)!==item.after)throw Error('Patch mismatch: '+item.path);
 planned.push([item.path,next]);
}
for(const [path,text] of planned)fs.writeFileSync(path,text);
fs.writeFileSync('scripts/master-cost-edits.json',JSON.stringify(changes));
