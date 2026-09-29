const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
for(const width of [360,1600])test(`post-trigger rejection keeps reason and workflow gates at ${width}`,async({page})=>{
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.setViewportSize({width,height:800});const {db}=await fullStack(page,'master');
 const o=db.tables.orders[0];Object.assign(o,{scheduled_date:'2026-10-01',scheduled_time:'12:00',time_slot:'12:00–13:00',report_review_status:'rejected',report_review_comment:'Добавьте фото <результата>',report_uploaded_at:null,report_act_url:null,report_photo_urls:'[]',master_workflow_stage:'assigned',master_called_at:null,master_agreed_at:null,master_departed_at:null,master_started_at:null});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_MASTER_DAILY_HOME_V127_API);await page.evaluate(()=>show('home'));
 await expect(page.locator('#masterDailyV127')).toContainText('Повторить этапы заявки');
 await page.evaluate(()=>openOrder('11'));const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
 await expect(panel.locator('.moa179Review.rejected')).toContainText('Добавьте фото <результата>');await expect(panel).toContainText('Этапы заявки начаты заново');
 await expect(panel.getByRole('button',{name:/Исправить отчет/})).toBeDisabled();await expect(panel.getByRole('button',{name:/Начал работу/})).toBeDisabled();
 await panel.getByRole('button',{name:/Выехал/}).click();await expect.poll(()=>o.master_workflow_stage).toBe('departed');
 await expect(panel.getByRole('button',{name:/Исправить отчет/})).toBeDisabled();await panel.getByRole('button',{name:/Начал работу/}).click();await expect.poll(()=>o.master_workflow_stage).toBe('started');
 await expect(panel.locator('.moa179Review')).toContainText('Добавьте фото <результата>');await panel.getByRole('button',{name:/Исправить отчет/}).click();await expect(page.locator('#masterReportForm')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
test('rejection reason is visible even without an agreed schedule',async({page})=>{
 await fullStack(page,'master').then(({db})=>Object.assign(db.tables.orders[0],{scheduled_date:null,scheduled_time:null,time_slot:null,report_review_status:'rejected',report_review_comment:'Проверьте акт',report_uploaded_at:null,report_act_url:null}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
 await expect(panel.locator('.moa179Review')).toContainText('Проверьте акт');await expect(panel.getByRole('button',{name:/Договориться/})).toBeEnabled();await expect(panel.getByRole('button',{name:/Исправить отчет/})).toHaveCount(0);
});
