const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
for(const width of [360,390,430])test(`report extra fields preserve the visible modal at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_LOAD_ROLE_MODULES('master'));await page.evaluate(()=>openMasterReportForm('11'));
 await page.locator('label.reportChoice').filter({has:page.locator('[name=mrExtra][value=true]')}).click();await page.locator('#mrExtraDesc').fill('Дополнительные крепления');await page.locator('#mrExtraAmount').fill('600');
 const geometry=await page.locator('#modalRoot .modal').evaluate(el=>({left:el.scrollLeft,overflow:el.scrollWidth-el.clientWidth,inputs:[...el.querySelectorAll('#mrExtraBox input')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})),width:innerWidth}));expect(geometry.left).toBe(0);expect(geometry.overflow).toBeLessThanOrEqual(1);for(const input of geometry.inputs){expect(input.left).toBeGreaterThanOrEqual(0);expect(input.right).toBeLessThanOrEqual(width)}
});
for(const role of ['dispatcher','manager','owner'])for(const width of [360,390,430])test(`${role} primary order action spans its mobile working area at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await fullStack(page,role);await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(role=>BOS_LOAD_ROLE_MODULES(role),role);await page.evaluate(()=>{setDispatchBoardView('all');setBosOrderFilter('all')});
 const button=page.getByRole('button',{name:'+ Новая',exact:true});await expect(button).toBeVisible();const ratio=await button.evaluate(e=>e.getBoundingClientRect().width/e.parentElement.getBoundingClientRect().width);expect(ratio).toBeGreaterThan(.98);await button.click();await expect(page.locator('#orderForm')).toBeVisible();
});
