const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const ctx=await fullStack(page,'master');
 Object.assign(ctx.db.tables.orders[0],{phone:'+70000000001',client:'Учебный клиент',address:'Учебный адрес, дом 1',master_called_at:'2026-10-14T08:00:00Z',master_contact_status:'agreed',scheduled_time:'12:00'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 return ctx;
}
const help=page=>page.locator('#bosMasterHelp');
// The existing heartbeat updates presence independently of learning; business rows must remain exact.
const businessSnapshot=db=>JSON.stringify(db.tables,(key,value)=>key==='last_seen_at'?undefined:value);
test('help preserves real agreement draft, focus and modal identity without writes',async({page})=>{
 const {db}=await setup(page);await page.evaluate(()=>masterOrderAgree179('11'));
 const form=page.locator('#masterOrderAgree179Form');await expect(form).toBeVisible();
 await form.locator('[name=scheduled_date]').fill('2099-10-15');await form.locator('[name=scheduled_time]').fill('14:30');
 await page.evaluate(()=>window.__originalForm=document.querySelector('#masterOrderAgree179Form'));
 const before=businessSnapshot(db);const entry=form.getByRole('button',{name:'Как согласовать?',exact:true});
 await expect(entry).toBeVisible();await entry.click();await expect(help(page)).toBeVisible();
 await expect(help(page)).toContainText('Договориться о визите');
 await help(page).getByRole('button',{name:'Далее',exact:true}).click();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>window.__originalForm===document.querySelector('#masterOrderAgree179Form'))).toBe(true);
 await expect(form.locator('[name=scheduled_date]')).toHaveValue('2099-10-15');await expect(form.locator('[name=scheduled_time]')).toHaveValue('14:30');
 await expect(entry).toBeFocused();expect(businessSnapshot(db)).toBe(before);
});
test('help preserves report File objects and never submits working form',async({page})=>{
 const {db}=await setup(page);await page.evaluate(()=>openMasterReportForm('11'));
 const form=page.locator('#masterReportForm');await expect(form).toBeVisible();
 await form.locator('#mrAct').setInputFiles({name:'Учебный-акт.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')});
 await form.locator('#mrPhotos').setInputFiles({name:'Учебное-фото.png',mimeType:'image/png',buffer:Buffer.from('test')});
 await page.evaluate(()=>{window.__report=document.querySelector('#masterReportForm');window.__file=document.querySelector('#mrAct').files[0];window.__submits=0;window.__report.addEventListener('submit',()=>window.__submits++)});
 const before=businessSnapshot(db);await form.getByRole('button',{name:'Как отправить?',exact:true}).click();
 await help(page).getByRole('button',{name:'Список шагов',exact:true}).click();
 await help(page).getByRole('button',{name:/Проверьте подтверждение/}).click();
 await help(page).getByRole('button',{name:'Завершить урок',exact:true}).click();
 await help(page).getByRole('button',{name:'Закрыть помощь',exact:true}).click();
 expect(await page.evaluate(()=>__report===document.querySelector('#masterReportForm')&&__file===document.querySelector('#mrAct').files[0]&&__submits===0)).toBe(true);
 expect(businessSnapshot(db)).toBe(before);
});
test('tips entry exposes lessons, FAQ search, communication, problems and original files',async({page})=>{
 await setup(page);await page.evaluate(()=>openMasterMemoMenuV129());await page.getByRole('button',{name:/Подсказки по работе/}).click();
 await expect(help(page)).toBeVisible();await expect(help(page).getByRole('button',{name:/Получил новую заявку/})).toBeVisible();
 await help(page).getByRole('button',{name:'Общение с клиентом',exact:true}).click();await expect(help(page).locator('[data-talk]')).toHaveCount(6);
 await help(page).locator('[data-talk]').first().click();await expect(help(page)).toContainText('Что сказать');
 await help(page).getByRole('button',{name:'Частые вопросы',exact:true}).click();await expect(help(page).locator('details[data-faq]')).toHaveCount(10);
 await help(page).getByLabel('Поиск по вопросам и ответам').fill('1 год');await expect(help(page).locator('details[data-faq]')).toHaveCount(1);
 await help(page).getByLabel('Поиск по вопросам и ответам').fill('zzz');await expect(help(page)).toContainText('Ничего не найдено');
 await help(page).getByRole('button',{name:'Очистить поиск',exact:true}).click();await expect(help(page).locator('details[data-faq]')).toHaveCount(10);
 await help(page).getByRole('button',{name:'Возникла проблема',exact:true}).click();await expect(help(page).locator('[data-problem]')).toHaveCount(5);
 await help(page).getByRole('button',{name:'Работа в приложении',exact:true}).click();
 await help(page).getByRole('button',{name:'Памятки и файлы',exact:true}).click();await expect(help(page).locator('#bosHelpMaterials')).toBeVisible();
});


test('contact draft, callback and educational branches never mutate the order',async({page})=>{
 const {db}=await setup(page);await page.evaluate(()=>openMasterContactResultForOrder('11'));
 const form=page.locator('#masterContactResultForm');await form.locator('[value=call_later]').check();
 await form.locator('[name=comment]').fill('Доставка после 15:00');await form.locator('[name=callback_at]').fill('2099-10-15T14:30');
 const before=businessSnapshot(db);await form.getByRole('button',{name:'Как заполнить?',exact:true}).click();
 await help(page).getByRole('button',{name:'Далее',exact:true}).click();await help(page).getByRole('button',{name:'Далее',exact:true}).click();
 for(const b of await help(page).locator('.bhBranches button').all())await b.click();
 await help(page).getByRole('button',{name:'Закрыть помощь',exact:true}).click();
 await expect(form.locator('[name=comment]')).toHaveValue('Доставка после 15:00');await expect(form.locator('[name=callback_at]')).toHaveValue('2099-10-15T14:30');expect(businessSnapshot(db)).toBe(before);
});

test('browser Back dismisses help without discarding the underlying form',async({page})=>{
 await setup(page);await page.evaluate(()=>masterOrderAgree179('11'));
 await page.locator('[name=scheduled_time]').fill('14:30');await page.getByRole('button',{name:'Как согласовать?',exact:true}).click();await expect(help(page).locator('.bhBody')).toBeVisible();
 await page.evaluate(()=>history.back());await expect(help(page)).toHaveCount(0);
 await expect(page.locator('#masterOrderAgree179Form [name=scheduled_time]')).toHaveValue('14:30');
});

test('copy reports success and failure honestly; search matches answers and categories',async({page})=>{
 await setup(page);await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});openMasterHelp('talk')});
 await help(page).locator('[data-talk] summary').first().click();await help(page).getByRole('button',{name:'Скопировать фразу',exact:true}).first().click();
 await expect(help(page).locator('.bhStatus')).toContainText('Скопировано');expect(await page.evaluate(()=>__copied)).toBe('Здравствуйте! Меня зовут … Звоню по вашей заявке на … Удобно уточнить детали и договориться о визите?');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}));
 await help(page).getByRole('button',{name:'Скопировать фразу',exact:true}).first().click();await expect(help(page).locator('.bhStatus')).toContainText('Не удалось');
 await help(page).getByRole('button',{name:'Частые вопросы',exact:true}).click();await help(page).getByRole('button',{name:'Оплата',exact:true}).click();await expect(help(page).locator('[data-faq]')).toHaveCount(1);
 await help(page).getByRole('button',{name:'Вернуться к категориям',exact:true}).click();await expect(help(page).locator('[data-faq]')).toHaveCount(10);
});

test('missing illustration keeps text, and failed lazy loading can be retried',async({page})=>{
 await setup(page);let fail=true;await page.route('**/master-help-data.js*',r=>fail?r.abort():r.continue());await page.evaluate(()=>openMasterHelp('report'));
 await expect(help(page)).toContainText('Не удалось загрузить');fail=false;await help(page).getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(help(page).locator('.bhBody h2')).toContainText('Откройте');
 await page.route('**/master-help-images/master-help-report-act.png*',r=>r.abort());await help(page).getByRole('button',{name:'Далее',exact:true}).click();
 await expect(help(page)).toContainText('Иллюстрация недоступна');await expect(help(page)).toContainText('Выберите читаемое фото');
});

for(const width of [320,390,768,1440])test(`all lessons and help navigation remain usable at ${width}`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:850});const {db}=await setup(page);
 const before=businessSnapshot(db);await page.evaluate(()=>openMasterHelp());await expect(help(page).locator('.bhLessonCard')).toHaveCount(10);
 const topics=await help(page).locator('.bhLessonCard').evaluateAll(nodes=>nodes.map(x=>x.dataset.value));
 for(const id of topics){
  await help(page).locator(`.bhLessonCard[data-value="${id}"]`).click();
  const count=await page.evaluate(id=>BOS_MASTER_HELP_DATA.lessons.find(x=>x.id===id).steps.length,id);
  for(let i=0;i<count;i++){
   const img=help(page).locator('.bhFigure img');await expect(img).toBeVisible();await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
   expect(await help(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   expect(await help(page).locator('.bhBody').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   const next=help(page).getByRole('button',{name:i===count-1?'Завершить урок':'Далее',exact:true});const box=await next.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.y+box.height).toBeLessThanOrEqual(851);
   if(id==='contact'&&i===2&&width===390)await page.screenshot({path:info.outputPath('lesson-mobile.png')});
   await next.click();
  }
 }
 await page.screenshot({path:info.outputPath('help-home.png')});expect(businessSnapshot(db)).toBe(before);expect(errors).toEqual([]);
});

test('help does not interrupt an in-flight report upload',async({page})=>{
 const {db}=await setup(page);Object.assign(db.tables.orders[0],{master_workflow_stage:'started',master_started_at:'2026-10-14T09:00:00Z'});const uploads=[];db.storage={from:()=>({upload:async path=>{uploads.push(path);return {error:null}},createSignedUrl:async path=>({data:{signedUrl:'https://test.invalid/storage/v1/object/sign/business-os-vk-files/'+path+'?token=test-signature'}})})};
 await page.evaluate(()=>{Object.assign(state.orders.find(x=>String(x.id)==='11'),{master_workflow_stage:'started'});openMasterReportForm('11')});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
 await page.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('Учебный акт')});await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
 let release,calls=0;const held=new Promise(r=>release=r);await page.route(/\/(?:api\/proxy|functions\/v1)\/report-api(?:\?|$)/,async route=>{if(route.request().method()==='OPTIONS')return route.fallback();calls++;if(calls===1)await held;await route.fallback()});
 await page.locator('#masterReportForm [type=submit]').click();await expect.poll(()=>calls).toBe(1);
 try{await page.evaluate(()=>openMasterHelp('report'));await expect(help(page).locator('.bhBody')).toBeVisible();await help(page).getByRole('button',{name:'Закрыть помощь',exact:true}).click();expect(calls).toBe(1);expect(await page.locator('#mrAct').evaluate(el=>el.files.length)).toBe(1)}finally{release()}
 await expect.poll(()=>uploads.length).toBe(2);await expect(page.locator('#masterReportForm')).toHaveCount(0);
});

test('old uploaded tips and document links are preserved in help',async({page})=>{
 await setup(page);await page.route('**/master-memo-api',r=>r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,items:[{id:'demo',category:'tips',title:'Существующая памятка',note:'Учебный файл',file_name:'памятка.pdf',file_url:'https://example.invalid/demo.pdf'}]})}));
 await page.evaluate(()=>openMasterHelp('materials'));await expect(help(page)).toContainText('Существующая памятка');await expect(help(page).getByRole('link',{name:'Открыть файл',exact:true})).toHaveAttribute('href','https://example.invalid/demo.pdf');
 await expect(help(page).locator('a[download]')).toHaveAttribute('download','памятка.pdf');
});

test('keyboard, image zoom, shortened viewport and enlarged text stay within help',async({page})=>{
 await page.setViewportSize({width:320,height:520});await setup(page);await page.evaluate(()=>openMasterHelp('report'));
 await help(page).getByRole('button',{name:'Увеличить иллюстрацию',exact:true}).click();await expect(help(page).locator('.bhZoom')).toBeVisible();await page.keyboard.press('Escape');await expect(help(page).locator('.bhFigure')).toBeVisible();
 await page.addStyleTag({content:'#bosMasterHelp *{font-size:20px!important}'});
 await help(page).getByRole('button',{name:'Далее',exact:true}).click();await help(page).getByRole('button',{name:'Назад',exact:true}).click();
 expect(await help(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 for(let i=0;i<14;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#bosMasterHelp'))).toBe(true)}
 await page.keyboard.press('Escape');await expect(help(page)).toHaveCount(0);
});
