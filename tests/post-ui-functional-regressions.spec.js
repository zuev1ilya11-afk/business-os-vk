const {test,expect}=require('@playwright/test');
const path=require('path');

test('owner weekly load uses staff_id and ignores non-working schedule rows',async({page})=>{
  await page.setContent('<div></div>');
  await page.addScriptTag({content:`
    window.state={
      masters:[{id:'m1'},{id:'m2'}],
      orders:[],
      masterSchedule:[]
    };
    window.weekStart=()=>new Date('2026-09-14T12:00:00');
    window.ymd=d=>d.toISOString().slice(0,10);
    window.payout=()=>0;
    window.reportPeriodBounds=()=>({start:'2026-09-14',end:'2026-09-20'});
    window.reportOrdersSource=()=>[];
    window.reportDoneDate=()=>'';
    window.reportMasterNameById=()=>'';
    window.money=n=>String(n);
    window.openOrder=()=>{};
    window.openOrderForm=()=>{};
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','regression-runtime-v74.js')});
  await page.evaluate(()=>{
    state.masterSchedule=[
      {staff_id:'m1',work_date:'2026-09-14',is_working:true},
      {staff_id:'m2',work_date:'2026-09-14',is_working:false}
    ];
  });
  const monday=await page.evaluate(()=>weeklyLoad()[0]);
  expect(monday.total).toBe(2);
  expect(monday.available).toBe(1);
  expect(monday.off).toBe(1);
  expect(monday.busy).toBe(0);
});

test('order views preserve an explicit zero master payout',async({page})=>{
  await page.setContent('<div id="payoutPreview"></div><div id="calcPay"></div>');
  await page.addScriptTag({content:`
    window.state={orders:[{id:'o1',master_vk_id:'vk1',amount:1000,master_payout:0}],masters:[],claims:[]};
    window.weekStart=()=>new Date('2026-09-14T12:00:00');
    window.ymd=d=>d.toISOString().slice(0,10);
    window.payout=a=>Number(a)*.85*.35;
    window.money=n=>String(n)+' ₽';
    window.reportPeriodBounds=()=>({start:'2026-09-14',end:'2026-09-20'});
    window.reportOrdersSource=()=>[];
    window.reportDoneDate=()=>'';
    window.reportMasterNameById=()=>'';
    window.openOrder=()=>{document.getElementById('payoutPreview').textContent='297.5 ₽'};
    window.openOrderForm=()=>{document.getElementById('calcPay').textContent='297.5 ₽'};
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','regression-runtime-v74.js')});
  await page.evaluate(()=>{openOrder('o1');openOrderForm('o1')});
  await expect(page.locator('#payoutPreview')).toHaveText('0 ₽');
  await expect(page.locator('#calcPay')).toHaveText('0 ₽');
});

test('closed claim keeps original order revenue and adds revisit payment separately',async({page})=>{
  await page.setContent('<div></div>');
  await page.addScriptTag({content:`
    window.state={
      masters:[],masterSchedule:[],
      claims:[{id:'c1',status:'closed',master_staff_id:'m1',closed_at:'2026-09-16T10:00:00Z',revisit_payment:500}]
    };
    window.weekStart=()=>new Date('2026-09-14T12:00:00');
    window.ymd=d=>d.toISOString().slice(0,10);
    window.payout=a=>Number(a)*.85*.35;
    window.money=n=>String(n)+' ₽';
    window.reportPeriodBounds=()=>({start:'2026-09-14',end:'2026-09-20'});
    window.reportOrdersSource=()=>[{id:'o1',status:'Выполнена',is_claim:true,master_staff_id:'m1',amount:10000,master_payout:2975,completed_at:'2026-09-16T10:00:00Z'}];
    window.reportDoneDate=o=>String(o.completed_at||'').slice(0,10);
    window.reportMasterNameById=()=> 'Мастер 1';
    window.openOrder=()=>{};
    window.openOrderForm=()=>{};
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','regression-runtime-v74.js')});
  const report=await page.evaluate(()=>dispatcherReportData('week','2026-09-14'));
  expect(report.ordersCount).toBe(1);
  expect(report.totalRevenue).toBe(10000);
  expect(report.totalPay).toBe(2975);
  expect(report.totalRevisit).toBe(500);
  expect(report.rows).toEqual([{id:'m1',name:'Мастер 1',count:1,revenue:10000,pay:2975,revisit:500}]);
});
