const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('Netlify gateway allows staff administration endpoint',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','netlify','functions','proxy.mts'),'utf8');
  expect(source).toContain('"staff-admin-api"');
});

test('master schedule presets change calendar draft and schedule save retries once',async({page})=>{
  await page.setContent(`
    <div id="masterMonthCalendar">
      <button class="bosCalDay" onclick="selectMasterCalendarDay('2026-09-01')"></button>
      <button class="bosCalDay" onclick="selectMasterCalendarDay('2026-09-05')"></button>
      <label class="bosMiniPreset"><input onclick="setMasterSchedulePreset('weekdays')"></label>
    </div>
  `);
  await page.addScriptTag({content:`
    window.state={masters:[],masterSchedule:[],user:{role:'master'}};
    window.pages={dispatch:()=>'',home:()=>'',team:()=>''};
    window.reloadData=async()=>{};
    window.calendarState={'2026-09-01':false,'2026-09-05':true};
    window.selectMasterCalendarDay=date=>{
      let box=document.getElementById('calWorking');
      if(box)box.remove();
      box=document.createElement('input');
      box.id='calWorking';box.type='checkbox';box.checked=window.calendarState[date];
      box.onchange=()=>{window.calendarState[date]=box.checked};
      document.body.appendChild(box);
    };
    window.apiCalls=0;
    window.api=async(action)=>{
      if(action==='saveMasterSchedule'){
        window.apiCalls++;
        if(window.apiCalls===1)throw new Error('Не удалось связаться с сервером. Проверьте интернет и повторите попытку.');
        return {ok:true};
      }
      return {ok:true};
    };
    window.masterSchedule=[];
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','schedule-identity-v46.js')});

  await page.evaluate(()=>window.setMasterSchedulePreset('weekdays'));
  const state=await page.evaluate(()=>window.calendarState);
  expect(state['2026-09-01']).toBe(true);
  expect(state['2026-09-05']).toBe(false);

  const result=await page.evaluate(()=>window.api('saveMasterSchedule',{days:[]}));
  expect(result.ok).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.apiCalls)).toBe(2);
});
