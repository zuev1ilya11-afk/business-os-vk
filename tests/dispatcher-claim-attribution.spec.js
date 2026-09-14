const {test,expect}=require('@playwright/test');
const path=require('path');

test('dispatcher report attributes revisit payment when claim only has master_staff_id',async({page})=>{
  await page.setContent('<div></div>');
  await page.addScriptTag({content:`
    window.state={claims:[{id:'c1',status:'closed',closed_at:'2026-09-14T08:00:00Z',master_staff_id:'staff-master-1',revisit_payment:850}],orders:[],masters:[],masterSchedule:[]};
    window.payout=()=>0;
    window.reportPeriodBounds=()=>({start:'2026-09-01',end:'2026-09-30',label:'сентябрь'});
    window.reportOrdersSource=()=>[];
    window.reportDoneDate=()=>'';
    window.reportMasterNameById=id=>id==='staff-master-1'?'Мастер Тест':'Неизвестно';
    window.weekStart=()=>new Date('2026-09-14T12:00:00');
    window.ymd=d=>d.toISOString().slice(0,10);
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','regression-runtime-v74.js')});
  const report=await page.evaluate(()=>window.dispatcherReportData('month',new Date('2026-09-14T12:00:00')));
  expect(report.totalRevisit).toBe(850);
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]).toMatchObject({id:'staff-master-1',name:'Мастер Тест',revisit:850});
});
