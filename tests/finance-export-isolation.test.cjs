const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {transformSync}=require('esbuild');
const {generate,output}=require('../scripts/build-finance-export-models.cjs');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
const browser=require('../finance-export-data.js');

test('native ESM import and XLSX stream never access legacy model globals',async()=>{
 const names=['BOS_ORDER_PAYROLL','BOS_WORK_ITEMS','BOS_FINANCE_EXPENSES','BOS_SALARY_PERIODS','BOS_PRICE_CATALOG','BOS_REPORT_DEDUCTION','BOS_FINANCE_DATA','BOS_FINANCE_EXPORT_DATA','BOS_FINANCE_XLSX'];
 const before=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
 let accesses=0;
 const forbidden=()=>{accesses++;throw Error('Legacy API global accessed')};
 try{
  for(const name of names)Object.defineProperty(globalThis,name,{get:forbidden,set:forbidden,configurable:true});
  const {projections,workbook}=await import(require('node:url').pathToFileURL(output).href);
  const f=fixture(),snapshot=projections.snapshot(f.orders,f.staff,f.expenses,f.filters,[]);
  assert.equal(JSON.stringify(snapshot),JSON.stringify(browser.snapshot(f.orders,f.staff,f.expenses,f.filters,[])));
  const bytes=await new Response(workbook.stream(projections.sheets(snapshot))).arrayBuffer();
  assert.ok(bytes.byteLength>1000);assert.equal(accesses,0);
 }finally{
  for(let i=0;i<names.length;i++)if(before[i])Object.defineProperty(globalThis,names[i],before[i]);else delete globalThis[names[i]];
 }
});

test('generated export models match current reviewed UI sources',()=>{
 assert.equal(fs.readFileSync(output,'utf8'),generate());
});

test('export uses UI projections without reading or replacing existing API globals',()=>{
 const code=transformSync(fs.readFileSync(output,'utf8'),{format:'cjs',target:'es2022'}).code;
 // Stand-ins deliberately fail if the export reads any legacy API model.
 const names=['BOS_ORDER_PAYROLL','BOS_WORK_ITEMS','BOS_FINANCE_EXPENSES','BOS_SALARY_PERIODS','BOS_PRICE_CATALOG','BOS_REPORT_DEDUCTION','BOS_FINANCE_DATA','BOS_FINANCE_EXPORT_DATA','BOS_FINANCE_XLSX'];
 const sentinel=Object.freeze({version:'source-60-40-v1',companyShare(){throw Error('Legacy model used by export')}});
 const context={module:{exports:{}},TextEncoder,ReadableStream,Uint8Array,Date};
 for(const name of names)Object.defineProperty(context,name,{value:sentinel,writable:false,configurable:false});
 vm.runInNewContext(code,context);
 for(const name of names)assert.equal(context[name],sentinel);
 const {projections,workbook}=context.module.exports;
 const f=fixture();
 // Includes mismatched provider tags: the UI treats Lemana separately even if
 // an old Hands identifier remains. The export must use that same UI rule.
 f.orders.push({...f.orders[3],id:'lemana-old-id',external_id:'hands:old',master_payout:500});
 const actual=projections.snapshot(f.orders,f.staff,f.expenses,f.filters,[]);
 const expected=browser.snapshot(f.orders,f.staff,f.expenses,f.filters,[]);
 assert.equal(JSON.stringify(actual),JSON.stringify(expected));
 assert.equal(actual.rows.find(r=>r.id==='lemana-old-id').source,'Лемана Про');
 assert.equal(typeof workbook.stream,'function');
});
