const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
const pair=require('../deploy/lemana-price/legacy-finance.json').files['supabase/functions/_shared/finance-export-models.mjs'];
test('deployed finance variant retains money and legacy work identities while adding Lemana filters',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bos-price-finance-'));
 try{
  const models={};for(const key of ['before','after']){const file=path.join(dir,key+'.mjs');fs.writeFileSync(file,pair[key]);models[key]=(await import(pathToFileURL(file))).projections;}
  const f=fixture(),args=[f.orders,f.staff,f.expenses,f.filters];
  const before=models.before.snapshot(...args),after=models.after.snapshot(...args);
  assert.deepEqual(after.total,before.total);
  for(const work of ['standard_020','unknown']){
   const filters={...f.filters,work};
   assert.deepEqual(models.after.snapshot(f.orders,f.staff,f.expenses,filters).rows,models.before.snapshot(f.orders,f.staff,f.expenses,filters).rows);
  }
  const source=structuredClone(f),service={name:'Подрезка карниза по длине',service_id:'lemana_20261111_062',quantity:3,unit:'пил',unit_price:200,amount:600};
  source.orders=[{...source.orders[0],source:'Лемана Про',work:service.name+' × 3 пил',work_items:[service]}];
  const filtered=models.after.snapshot(source.orders,source.staff,source.expenses,{...source.filters,work:service.service_id});
  assert.equal(filtered.rows.length,1);assert.equal(filtered.rows[0].works[0].key,service.service_id);
  assert.equal(filtered.total.revenue,models.before.snapshot(source.orders,source.staff,source.expenses,source.filters).total.revenue);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
