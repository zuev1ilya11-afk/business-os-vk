// A layout-visible marker is insufficient: capture the actual detail controls in the viewport.
async function revealFinanceMaster(page){
 await page.locator('#finMasterDetail').waitFor({state:'visible'});
 await page.locator('.finFilters,.finPeriodControl').evaluateAll(es=>es.forEach(e=>e.open=false));
 await page.locator('#finMasterDetail').evaluate(e=>{const header=document.querySelector('header');const top=Math.max(20,header?.getBoundingClientRect().bottom||0)+20;scrollTo(0,scrollY+e.getBoundingClientRect().top-top)});
 await page.waitForFunction(()=>{const d=document.querySelector('#finMasterDetail');return ['.finHeading','[data-fin-close-master]','.finMainKpis'].every(s=>{const e=d?.querySelector(s),r=e?.getBoundingClientRect();return r&&r.top>=0&&r.bottom<=innerHeight-74&&r.left>=0&&r.right<=innerWidth})});
 return page.locator('#finMasterDetail').evaluate(d=>Object.fromEntries([['heading','.finHeading'],['close','[data-fin-close-master]'],['kpis','.finMainKpis']].map(([key,s])=>{const r=d.querySelector(s).getBoundingClientRect();return [key,{visible:r.top>=0&&r.bottom<=innerHeight-74,top:r.top,bottom:r.bottom}]})));
}
module.exports={revealFinanceMaster};
