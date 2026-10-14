const {expect}=require('@playwright/test');
const path=require('node:path');
const {fullStack}=require('../../tests/helpers/full-stack.cjs');
const root=path.resolve(__dirname,'../..');
module.exports=async function capture(page,phase){
 await page.setViewportSize({width:390,height:820});
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const {db,master}=await fullStack(page,'master');
 Object.assign(db.tables.orders[0],{client:'Учебный клиент',address:'Учебная улица, дом 1',work:'Монтаж карниза · учебный пример',phone:'+70000000001',phone2:'+70000000002',scheduled_date:'2099-09-10',scheduled_time:'12:00',master_called_at:'2026-10-14T08:00:00Z',master_contact_status:'agreed',master_contact_comment:'Учебный пример. Визит согласован.',master_contact_phone:'+70000000001'});
 for(const u of db.tables.business_staff||[])Object.assign(u,{full_name:'Учебный мастер',phone:'+70000000003'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.addStyleTag({content:'[data-bos-help]{visibility:hidden!important}.help-capture-highlight{outline:3px solid #ffcf66!important;outline-offset:4px!important;box-shadow:0 0 0 8px #ffcf6620!important}'});
 const snap=async(name,loc)=>{
  await expect(loc).toBeVisible();await loc.scrollIntoViewIfNeeded();
  await loc.evaluate(el=>el.classList.add('help-capture-highlight'));
  const b=await loc.boundingBox();const height=Math.min(560,Math.max(320,b.height+100));const top=Math.max(0,Math.min(820-height,b.y-50));
  await page.screenshot({path:path.join(root,'master-help-images','master-help-'+name+'.png'),clip:{x:4,y:top,width:382,height},animations:'disabled'});
  await loc.evaluate(el=>el.classList.remove('help-capture-highlight'));console.log('Captured '+name);
 };

 const order=async(patch={})=>{Object.assign(db.tables.orders[0],patch);await page.evaluate(p=>{Object.assign(state.orders.find(x=>String(x.id)==='11'),p);openOrder('11')},patch);await expect(page.locator('.bosCompactMasterCard')).toBeVisible()};
 if(phase==='order'){
 await page.evaluate(()=>show('orders'));await snap('orders',page.locator('[aria-label="Фильтр заявок"]'));
 await order();await snap('order',page.locator('.bosCompactAddress'));
 await snap('phones',page.locator('.masterV126PhoneRow').first());
 await snap('contact-summary',page.locator('.bosCompactClient'));
 await snap('work',page.getByRole('button',{name:'Подтвердить: выехал',exact:true}));
 await snap('reschedule',page.getByRole('button',{name:'Запросить перенос',exact:true}));
 await order({master_workflow_stage:'departed',master_departed_at:'2026-10-14T09:00:00Z'});await snap('work-start',page.getByRole('button',{name:'Подтвердить: начал работу',exact:true}));
 await order({master_workflow_stage:'started',master_started_at:'2026-10-14T09:30:00Z'});await snap('work-report',page.getByRole('button',{name:'Отправить отчёт',exact:true}));
 await page.evaluate(()=>{closeModal();openMasterContactResultForOrder('11')});
 await expect(page.locator('#masterContactResultForm')).toBeVisible();await snap('contact',page.locator('.bosContactResultChoice').filter({has:page.locator('[value=agreed]')}));
 await page.locator('[name=comment]').fill('Учебный пример: клиент подтвердил визит.');await snap('contact-comment',page.locator('[name=comment]'));
 await page.locator('[value=agreed]').check();await snap('contact-save',page.getByRole('button',{name:'Сохранить итог',exact:true}));
 await page.evaluate(()=>{closeModal();masterOrderAgree179('11')});await snap('agreement',page.locator('#masterOrderAgree179Form [name=scheduled_date]'));
 await snap('agreement-save',page.locator('#masterOrderAgree179Form [type=submit]'));
 }
 if(phase==='report'){
 await order({master_workflow_stage:'started',master_started_at:'2026-10-14T09:30:00Z'});
 await page.evaluate(()=>openMasterReportForm('11'));
 await snap('report-act',page.locator('#mrAct'));await snap('report-photos',page.locator('#mrPhotos'));
 await snap('report-result',page.locator('.reportOutcome'));
 await page.locator('[name=mrExtra][value=true]').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))});await snap('report-extra',page.locator('#mrExtraBox'));
 await snap('report-submit',page.locator('#masterReportForm [type=submit]'));
 await order({report_review_status:'pending',report_uploaded_at:'2026-10-14T10:00:00Z'});await snap('report-pending',page.locator('.moa179Review').first());
 await order({report_review_status:'rejected',report_review_comment:'Учебный пример: акт обрезан, приложите целиком.'});await snap('report-rejected',page.locator('.moa179Review.rejected'));
 await page.evaluate(()=>openMasterReportForm('11'));await snap('report-correction',page.locator('.bosReportCorrection'));
 // Exercise the existing uncertain-state presentation only; no real upload or request.
 await page.evaluate(()=>{const f=document.querySelector('#masterReportForm'),m=f.querySelector('#mrMsg');f.dataset.reportLocked='true';m.textContent='Ответ на сохранение не получен';const b=document.createElement('button');b.type='button';b.textContent='Проверить состояние';m.after(b)});
 await snap('report-uncertain',page.locator('.bosReportUncertain'));
 }
 if(phase==='profile'){
 await page.evaluate(()=>{closeModal();show('team')});await expect(page.locator('.bosProfileMenu')).toBeVisible();await snap('profile',page.locator('.bosProfileMenu'));
 await snap('profile-money',page.locator('.bosProfileAccrual'));
 await page.getByRole('button',{name:'Подробнее →',exact:true}).click();await snap('money',page.locator('#masterMoneyV130'));
 await page.evaluate(()=>{closeModal();show('home')});await page.locator('#masterDaySummaryV128 summary').click();await snap('day',page.locator('#masterDaySummaryV128'));
 await page.evaluate(()=>openMasterWorkMonth());await snap('calendar',page.locator('#bosMasterWorkCalendar').getByRole('button',{name:'Изменить дни',exact:true}));
 await page.getByRole('button',{name:'Изменить дни',exact:true}).click();await snap('calendar-edit',page.locator('.usEditor'));
 await snap('calendar-save',page.getByRole('button',{name:'Сохранить график',exact:true}));
 }
};
