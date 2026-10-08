const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function home(page){await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>show('home'));}
async function setOrders(page,orders,claims=[]){await page.evaluate(({orders,claims})=>{const template=state.orders.find(o=>String(o.id)==='11')||state.orders[0]||window.__homeTemplate;window.__homeTemplate=template;state.orders=orders.map(o=>({...template,created_at:'2026-10-08T08:00:00Z',master_called_at:null,master_agreed_at:null,master_contact_status:null,master_contact_history:[],reschedule_requested:false,master_workflow_stage:'assigned',report_uploaded_at:null,report_act_url:null,report_review_status:null,scheduled_date:'2099-09-10',scheduled_time:'10:00',status:'В работе',...o}));state.claims=claims;window.BOS_MASTER_DAILY_HOME_V127_API.refresh();window.BOS_MASTER_DAY_SUMMARY_V128_API.refresh();},{orders,claims});}
for(const width of [360,390,430])test(`home keeps all attention and claim reasons without duplicate orders at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await home(page);
 await setOrders(page,[{id:'11',address:'Один адрес'},{id:'12',address:'Один адрес',scheduled_date:''},{id:'13',scheduled_date:''},{id:'14',scheduled_date:''},{id:'15',scheduled_date:''},{id:'16',status:'Выполнена'},...['21','22','23','24'].map(id=>({id,scheduled_date:'2099-09-11'}))],[{id:'c1',order_id:'11',status:'open',reason:'Первая причина'},{id:'c2',order_id:'11',status:'open',reason:'Вторая причина'},{id:'c3',order_id:'16',status:'open',reason:'Завершённая заявка'},{id:'orphan',order_id:'missing',status:'open',reason:'Несвязанная рекламация'}]);
 const box=page.locator('#masterDailyV127');
 await expect(box.locator('.masterV127Next')).toHaveAttribute('data-order-id','11');
 for(const id of ['11','21','22','23','24'])await expect(box.locator(`[data-order-id="${id}"]`)).toHaveCount(1);
 for(const reason of ['Первая причина','Вторая причина','Завершённая заявка','Несвязанная рекламация'])await expect(box.getByText(reason,{exact:false})).toBeVisible();
 await expect(box.locator('button[data-claim-id="orphan"]')).toHaveAttribute('data-home-action','claim');
 await expect(box.locator('[data-order-id="24"]')).toBeVisible();
 await expect(box.locator('[data-order-id="16"]')).toHaveCount(0);
 await box.getByRole('tab',{name:/Новые/}).click();for(const id of ['12','13','14','15'])await expect(box.locator(`[data-order-id="${id}"]`)).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Ближайшие заявки',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
test('today totals start collapsed and salary is removed only from home',async({page})=>{
 await home(page);await setOrders(page,[{id:'11',status:'Выполнена',completed_at:new Date().toISOString(),amount:1000,extra_work_amount:100,uncompleted_work_amount:200}]);
 const summary=page.locator('#masterDaySummaryV128');await expect(summary.locator('summary')).toContainText(/Выполнено 1 · Начислено 652[,.]5 ₽/);await expect(summary.locator('.masterV128Metrics')).toBeHidden();await summary.locator('summary').click();await expect(summary.locator('.masterV128Metrics')).toBeVisible();await expect(summary).toContainText('Вычеты (уже учтены)');
 await expect(page.locator('#content .masterSalarySummary')).toHaveCount(0);
 await page.evaluate(()=>show('team'));await expect(page.locator('#masterMoneyV130 .salaryHero')).toContainText(/652[,.]5/);
});
test('agreement hint updates with contact status while preserving legacy allowed states',async({page})=>{
 await home(page);await setOrders(page,[{id:'11',master_called_at:'2099-09-09T10:00:00Z',master_contact_status:'waiting_delivery'}]);await page.evaluate(()=>openOrder('11'));
 const contact=page.locator('#modalRoot .bosMasterClientActions');const button=contact.getByRole('button',{name:'Подтвердить договорённость',exact:true});
 await expect(button).toBeDisabled();await expect(contact).toContainText('Клиент ждёт доставку');
 for(const [status,text] of [['no_answer','Клиент не ответил'],['thinking','Клиент обдумывает'],['call_later','Клиент попросил перезвонить'],['pending','Итог звонка ещё не зафиксирован'],['other','Согласование с клиентом не подтверждено']]){await page.evaluate(status=>{state.orders[0].master_contact_status=status;window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH();},status);await expect(contact).toContainText(text);await expect(button).toBeDisabled();}
 for(const status of ['', 'agreed']){await page.evaluate(status=>{state.orders[0].master_contact_status=status;window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH();},status);await expect(button).toBeEnabled();await expect(contact.locator('.moa179AgreementHint')).toHaveCount(0);}
 await page.evaluate(()=>{state.orders[0].status='Отменена';window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH();});await expect(button).toHaveCount(0);
});
test('empty, single, returned report and pending review keep existing primary selection',async({page})=>{
 await home(page);await setOrders(page,[]);
 await expect(page.locator('.masterV127Empty')).toBeVisible();await expect(page.locator('#masterDaySummaryV128 summary')).toContainText('Выполнено 0 · Начислено 0 ₽');
 await setOrders(page,[{id:'11',scheduled_date:'',scheduled_time:''}]);await page.getByRole('tab',{name:/Новые/}).click();await expect(page.locator('.masterV127Card')).toContainText('Визит не назначен');await expect(page.locator('#masterDailyV127 .masterV127Card')).toHaveCount(1);await page.getByRole('tab',{name:/По дням/}).click();
 await setOrders(page,[{id:'11',report_uploaded_at:'2099-09-09T12:00:00Z',report_act_url:'https://example.test/report.pdf',report_review_status:'rejected'},{id:'12',scheduled_date:'2099-09-11'},{id:'13',report_uploaded_at:'2099-09-09T12:00:00Z',report_review_status:'pending'}]);
 await expect(page.locator('.masterV127Next')).toHaveAttribute('data-order-id','12');await expect(page.locator('.masterV127Card[data-order-id="11"]')).toContainText('Исправить отчёт');await expect(page.locator('.masterV127Card[data-order-id="13"]')).toContainText('Отчёт на проверке');
});
test('reload keeps only one primary card and collapsed summary without home salary',async({page})=>{
 const {db}=await fullStack(page,'master');Object.assign(db.tables.orders[0],{scheduled_time:'10:00'});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 for(let i=0;i<2;i++){await expect(page.locator('.masterV127Next')).toHaveCount(1);await expect(page.locator('#content .masterSalarySummary')).toHaveCount(0);await expect(page.locator('#masterDaySummaryV128 summary')).toBeVisible();await expect(page.locator('#masterDaySummaryV128 details')).not.toHaveAttribute('open','');if(!i)await page.reload();}
});
test('owner preview explains read-only confirmation and restricts claim scope',async({page})=>{
 const {db,master}=await fullStack(page,'owner');Object.assign(db.tables.orders[0],{scheduled_time:'10:00',master_vk_id:master.external_id});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(id=>enterMasterPreview(id),master.external_id);
 await page.evaluate(master=>{state.claims=[{id:'mine',master_staff_id:master.id,status:'open',reason:'Моя рекламация'},{id:'foreign',master_staff_id:'someone-else',status:'open',reason:'Чужая рекламация'}];window.BOS_MASTER_DAILY_HOME_V127_API.refresh();},master);
 await expect(page.locator('#masterDailyV127')).toContainText('Моя рекламация');await expect(page.locator('#masterDailyV127')).not.toContainText('Чужая рекламация');await page.evaluate(()=>openOrder('11'));await expect(page.locator('.moa179AgreementHint')).toHaveText('В режиме просмотра подтверждение недоступно.');
});
test('saving and uncertain outcome explain technical state without asking to call',async({page})=>{
 await home(page);await setOrders(page,[{id:'11',master_called_at:null}]);await page.evaluate(()=>openOrder('11'));
 await page.evaluate(()=>{window.reloadData=async()=>{throw Error('offline fixture')};window.fetch=()=>new Promise((resolve,reject)=>{window.__failSave=()=>reject(Error('offline fixture'))});void masterOrderContact179('11','markCalled');});
 await expect(page.locator('.moa179AgreementHint')).toHaveText('Сохраняем изменения. Дождитесь подтверждения.');
 await page.evaluate(()=>window.__failSave());await expect(page.locator('.moa179AgreementHint')).toHaveText('Сохранение не подтверждено. Нажмите «Проверить состояние».');await expect(page.locator('.moa179AgreementHint')).not.toContainText('свяжитесь');
});
test('expanded day details survive order refresh',async({page})=>{
 await home(page);await page.locator('#masterDaySummaryV128 summary').click();
 await page.evaluate(()=>{state.orders[0].address='Обновлённый адрес';window.BOS_MASTER_DAILY_HOME_V127_API.refresh();});
 await expect(page.locator('.masterV127Next')).toContainText('Обновлённый адрес');await expect(page.locator('#masterDaySummaryV128 details')).toHaveAttribute('open','');
});
test('duplicate ids collapse while identical Hands numbers remain separate',async({page})=>{
 await home(page);await setOrders(page,[{id:'11',external_id:'hands:123'},{id:'11',external_id:'hands:123'},{id:'12',external_id:'hands:123'}],[{id:'c1',order_id:'11',status:'open',reason:'Причина'},{id:'c1',order_id:'11',status:'open',reason:'Причина'}]);
 const box=page.locator('#masterDailyV127');for(const id of ['11','12'])await expect(box.locator(`[data-order-id="${id}"]`)).toHaveCount(1);await expect(box.locator('[data-claim-id="c1"]')).toHaveCount(1);
});
