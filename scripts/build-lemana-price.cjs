// Builds the shared browser/server catalogue from the reviewed XLSX transcription.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/lemana-price-2026-11-11.json'),'utf8'));
const file=path.join(root,'service-catalog.js');
const begin='// BEGIN LEMANA CATALOG\n',end='// END LEMANA CATALOG\n';
const source=fs.readFileSync(file,'utf8');
const services=data.services.map(s=>{
 const split=/^(.+?\.)\s*([А-ЯЁ][\s\S]*)$/.exec(s.n);
 return {...s,n:(split?split[1]:s.n).replace(/\.$/,''),note:[split?.[2],s.note].filter(Boolean).join('\n')};
});
const block=begin+'const lemana='+JSON.stringify({...data,services})+';\n'+end;
const next=source.includes(begin)?source.slice(0,source.indexOf(begin))+block+source.slice(source.indexOf(end)+end.length):source.replace("return {version:'2026-10-01',standard,avito};",block+"const isLemana=order=>['лемана про','lemana_pro'].includes(String(typeof order==='string'?order:order?.source||'').trim().toLowerCase())||order?.external_source==='lemana_pro';\nconst forSource=order=>isLemana(order)?lemana.services.filter(s=>s.kind!=='minimum'):standard;\nreturn {version:'2026-10-01',standard,avito,lemana,isLemana,forSource};");
if(process.argv.includes('--check')){if(next!==source)throw Error('Run node scripts/build-lemana-price.cjs');}
else fs.writeFileSync(file,next);
