const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const path=require('node:path'),fs=require('node:fs');
test('capture new help for owner review',async({page})=>{
 test.skip(!process.env.BOS_CAPTURE_HELP,'Explicit visual evidence capture.');
 const dir=path.resolve(__dirname,'../docs/master-help');fs.mkdirSync(dir,{recursive:true});
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await fullStack(page,'master');await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openMasterHelp());await expect(page.locator('.bhLessonCard')).toHaveCount(10);await page.screenshot({path:path.join(dir,'help-home-mobile.png')});
 await page.locator('.bhLessonCard[data-value=report]').click();await page.getByRole('button',{name:'Далее',exact:true}).click();await expect.poll(()=>page.locator('#bosMasterHelp img').evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);await page.screenshot({path:path.join(dir,'help-lesson-mobile.png')});
 await page.getByRole('button',{name:'Общение с клиентом',exact:true}).click();await page.locator('[data-talk] summary').first().click();await page.screenshot({path:path.join(dir,'help-communication.png')});
 await page.getByRole('button',{name:'Частые вопросы',exact:true}).click();await page.locator('[data-faq] summary').first().click();await page.screenshot({path:path.join(dir,'help-faq.png')});
 await page.getByRole('button',{name:'Закрыть помощь',exact:true}).click();await page.evaluate(()=>openOrder('11'));await page.getByRole('button',{name:'Помощь по заявке',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'help-order-entry.png')});
 await page.getByRole('button',{name:'Помощь по заявке',exact:true}).click();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(dir,'help-home-desktop.png')});
});
