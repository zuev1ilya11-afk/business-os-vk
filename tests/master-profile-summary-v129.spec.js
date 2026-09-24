const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monday=()=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d)};
const addDays=(date,n)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+n);return iso(d)};

test('master v129 moves summary to profile and shows extras deductions week and month salary',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const today=iso(new Date()),weekStart=monday(),previousWeek=addDays(weekStart,-2);
  const monthStart=`${today.slice(0,8)}01`;
  const priorInMonth=previousWeek>=monthStart?previousWeek:today;
  const primary=db.tables.orders.find(o=>String(o.id)==='11');
  Object.assign(primary,{
    status:'Выполнена',report_review_status:'approved',scheduled_date:today,completed_at:`${today}T12:00:00`,
    original_amount:1200,amount:1000,master_payout:552.5,extra_work_amount:100,uncompleted_work_amount:200,
    master_staff_id:master.id,master_name:master.full_name
  });
  const secondary={...primary,id:'12902',scheduled_date:priorInMonth,completed_at:`${priorInMonth}T12:00:00`,original_amount:2000,amount:2000,master_payout:1105,extra_work_amount:0,uncompleted_work_amount:0};
  const active={...primary,id:'12903',status:'В работе',report_review_status:null,scheduled_date:today,completed_at:null,amount:700,master_payout:0,extra_work_amount:0,uncompleted_work_amount:0};
  db.tables.orders.splice(0,db.tables.orders.length,primary,secondary,active);

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_PROFILE_SUMMARY_V129===true);
  await page.evaluate(({weekStart})=>{
    const id=state.user.id;
    state.masterSchedule=Array.from({length:7},(_,i)=>{const d=new Date(`${weekStart}T12:00:00`);d.setDate(d.getDate()+i);const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return{master_staff_id:id,work_date:date,is_working:i<6,work_start:'10:00',work_end:'20:00'}});
    show('team');
    window.BOS_MASTER_PROFILE_SUMMARY_V129_API.refresh();
  },{weekStart});

  const panel=page.locator('#masterProfileSummaryV129');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading',{name:'Мой график'})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Изменить'})).toBeVisible();
  await expect(panel.locator('.masterV129Day')).toHaveCount(7);
  await expect(panel.getByText('В работе',{exact:true}).locator('..')).toContainText('1');
  await expect(panel.getByText('Выполнено',{exact:true}).locator('..')).toContainText('2');
  await expect(panel.getByText('Допработы',{exact:true}).locator('..')).toContainText(/100/);
  await expect(panel.getByText('Вычеты',{exact:true}).locator('..')).toContainText(/200/);
  await expect(panel.getByText('ЗП за неделю',{exact:true})).toBeVisible();
  await expect(panel.getByText('ЗП за месяц',{exact:true})).toBeVisible();
  await expect(panel).toContainText('Вычеты уже учтены');
  await expect(panel.getByText('Общая зарплата',{exact:true}).locator('..').locator('..')).toContainText(/1[\s ]?757[,.]5/);

  const weekExpected=priorInMonth>=weekStart?1757.5:652.5;
  await expect(panel.getByText('ЗП за неделю',{exact:true}).locator('..')).toContainText(new RegExp(String(weekExpected).replace('.', '[,.]')));
  await expect(panel.getByText('ЗП за месяц',{exact:true}).locator('..')).toContainText(/1[\s ]?757[,.]5/);

  await page.evaluate(()=>show('home'));
  await expect(page.locator('#masterProfileSummaryV129')).toHaveCount(0);
  await expect(page.locator('#content').getByRole('heading',{name:'Мой график'})).toHaveCount(0);
  await expect(page.locator('#masterDailyV127')).toBeVisible();
  await expect(page.locator('#masterDaySummaryV128')).toBeVisible();

  await page.evaluate(()=>show('team'));
  await expect(page.locator('#masterProfileSummaryV129')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master v129 profile summary is not rendered for dispatcher',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_PROFILE_SUMMARY_V129===true);
  await page.evaluate(()=>show('team'));
  await expect(page.locator('#masterProfileSummaryV129')).toHaveCount(0);
});
