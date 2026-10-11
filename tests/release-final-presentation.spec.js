const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
for(const width of [360,390,430])test(`report extra fields preserve the visible modal at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_LOAD_ROLE_MODULES('master'));await page.evaluate(()=>openMasterReportForm('11'));
 await page.locator('label.reportChoice').filter({has:page.locator('[name=mrExtra][value=true]')}).click();await page.locator('#mrExtraDesc').fill('Дополнительные крепления');await page.locator('#mrExtraAmount').fill('600');
 const geometry=await page.locator('#modalRoot .modal').evaluate(el=>({left:el.scrollLeft,overflow:el.scrollWidth-el.clientWidth,inputs:[...el.querySelectorAll('#mrExtraBox input')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})),width:innerWidth}));expect(geometry.left).toBe(0);expect(geometry.overflow).toBeLessThanOrEqual(1);for(const input of geometry.inputs){expect(input.left).toBeGreaterThanOrEqual(0);expect(input.right).toBeLessThanOrEqual(width)}
});
