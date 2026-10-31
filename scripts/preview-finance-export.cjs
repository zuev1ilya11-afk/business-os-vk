// Reproduce the sample through the production exporter, with synthetic fixtures only.
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('../tests/helpers/finance-export-fixture.cjs');
const X=require('../finance-export-data.js');
const W=require('../supabase/functions/_shared/finance-xlsx.js');
async function main(){
 const output=process.argv[2];if(!output)throw Error('Usage: node scripts/preview-finance-export.cjs /absolute/output.xlsx');
 const f=fixture(),s=X.snapshot(f.orders,f.staff,f.expenses,f.filters,[]);
 const sheets=X.sheets(s,new Date('2026-10-31T09:00:00Z')),rows=[...sheets[0].rows()];
 rows.splice(1,0,['Пример','СИНТЕТИЧЕСКИЕ ДАННЫЕ — не рабочие заявки']);sheets[0].rows=function*(){yield* rows};
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
 fs.writeFileSync(output,Buffer.from(await new Response(W.stream(sheets)).arrayBuffer()));
 console.log(JSON.stringify({file:path.resolve(output),sheets:sheets.map(s=>s.name),revenue:s.total.revenue,pay:s.total.pay,expenses:s.total.expenses,profit:s.total.net}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
