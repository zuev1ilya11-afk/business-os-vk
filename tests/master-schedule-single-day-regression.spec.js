const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const iso = d => {
  const x = new Date(d + 'T12:00:00');
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const addDays = (d,n) => {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate()+n);
  return iso(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`);
};

test('making one master day off preserves the rest of the schedule and saves only that week', async ({ page }) => {
  const week1='2099-09-07';
  const week2='2099-09-14';
  const rows=[];
  for(const week of [week1,week2]){
    for(let i=0;i<7;i++)rows.push({staff_id:'staff1',work_date:addDays(week,i),is_working:true,work_start:'10:00',work_end:'20:00'});
  }
  await page.setContent(`
    <div id="masterMonthCalendar">
      <button class="bosCalDay selected" onclick="selectMasterCalendarDay('2099-09-09')"></button>
      <div id="masterDayEditor"><input id="calWorking" type="checkbox" checked></div>
    </div>
    <p id="calendarSaveMsg"></p>
  `);
  await page.addScriptTag({content:`
    window.state={
      user:{id:'staff1',external_id:'vk1',vk_user_id:'vk1',role:'master'},
      masters:[{id:'staff1',external_id:'vk1',vk_user_id:'vk1',role:'master'}],
      masterSchedule:${JSON.stringify(rows)}
    };
    window.masterSchedule=window.state.masterSchedule;
    window.liveMasterId=()=> 'vk1';
    window.liveMasterUser=()=> window.state.user;
    window.renderMonthCalendar=()=>{};
    window.BOS_NORMALIZE_MASTER_SCHEDULE=()=>{};
    window.drafts={};
    for(const row of window.state.masterSchedule){
      window.drafts[row.work_date]={date:row.work_date,is_working:true,work_start:'10:00',work_end:'20:00'};
    }
    window.BOS_MASTER_CALENDAR={draftFor:date=>window.drafts[date]||(window.drafts[date]={date,is_working:false,work_start:'10:00',work_end:'20:00'})};
    window.saveMasterCalendarMonth=async()=>({ok:true,legacy:true});
    window.calls=[];
    window.api=async(action,payload)=>{
      if(action==='saveMasterSchedule'){
        window.calls.push(JSON.parse(JSON.stringify(payload)));
        return {ok:true};
      }
      if(action==='bootstrap')return {ok:true,masterSchedule:window.state.masterSchedule};
      return {ok:true};
    };
    document.getElementById('calWorking').onchange=e=>{window.drafts['2099-09-09'].is_working=e.target.checked};
  `});

  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','schedule-save-hotfix-v69.js'),'utf8')});
  await page.uncheck('#calWorking');
  await page.evaluate(()=>window.saveMasterCalendarMonth());

  const calls=await page.evaluate(()=>window.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].week_start).toBe(week1);
  expect(calls[0].days).toHaveLength(7);
  expect(calls[0].days.find(d=>d.date==='2099-09-09').is_working).toBeFalsy();
  expect(calls[0].days.filter(d=>d.date!=='2099-09-09').every(d=>d.is_working)).toBeTruthy();
  expect(calls.some(c=>c.week_start===week2)).toBeFalsy();
});
