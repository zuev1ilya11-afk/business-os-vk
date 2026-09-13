const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('compact schedule reuses master saved hours for all days and keeps single-day override possible', async ({ page }) => {
  await page.setContent(`
    <div id="masterMonthCalendar">
      <div class="card"><div class="row"><div class="bosSchedulePresets compact"></div></div></div>
      <button class="bosCalDay" onclick="selectMasterCalendarDay('2099-09-01')"></button>
      <button class="bosCalDay" onclick="selectMasterCalendarDay('2099-09-02')"></button>
      <button class="bosCalDay" onclick="selectMasterCalendarDay('2099-09-03')"></button>
      <div id="editor"></div>
    </div>
  `);
  await page.addScriptTag({content:`
    window.state={masters:[{id:'m1',role:'master'}],masterSchedule:[{master_id:'m1',work_date:'2099-08-25',is_working:true,work_start:'11:00',work_end:'17:00'}],user:{id:'m1',role:'master'}};
    window.masterSchedule=window.state.masterSchedule;
    window.pages={team:()=>'',dispatch:()=>'',home:()=>''};
    window.reloadData=async()=>{};
    window.renderMonthCalendar=()=>{};
    window.liveMasterMode=()=>true;
    window.liveMasterId=()=> 'm1';
    window.api=async()=>({ok:true});
    window.saveCalls=0;
    window.saveMasterCalendarMonth=async()=>{window.saveCalls++;return {ok:true}};
    window.data={};
    window.selectMasterCalendarDay=(date)=>{
      document.querySelectorAll('.bosCalDay').forEach(b=>b.classList.remove('selected'));
      const btn=[...document.querySelectorAll('.bosCalDay')].find(b=>b.getAttribute('onclick').includes(date));
      btn?.classList.add('selected');
      const d=window.data[date]||(window.data[date]={working:false,start:'10:00',end:'20:00'});
      document.getElementById('editor').innerHTML='<input id="calWorking" type="checkbox"><select id="calStart"><option>10:00</option><option>11:00</option><option>12:00</option></select><select id="calEnd"><option>17:00</option><option>18:00</option><option>20:00</option></select>';
      const w=document.getElementById('calWorking'),s=document.getElementById('calStart'),e=document.getElementById('calEnd');
      w.checked=d.working;s.value=d.start;e.value=d.end;
      w.addEventListener('change',()=>d.working=w.checked);
      s.addEventListener('change',()=>d.start=s.value);
      e.addEventListener('change',()=>d.end=e.value);
    };
  `});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','schedule-identity-v46.js'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','master-schedule-compact-v65.js'),'utf8')});

  await expect(page.locator('.bosCompactSchedule')).toBeVisible();
  await expect(page.locator('.bosCompactSchedule')).toContainText('11:00–17:00');
  await page.getByRole('button',{name:'Все дни'}).click();

  const all=await page.evaluate(()=>Object.values(window.data));
  expect(all).toHaveLength(3);
  expect(all.every(x=>x.working&&x.start==='11:00'&&x.end==='17:00')).toBeTruthy();

  await page.evaluate(()=>window.selectMasterCalendarDay('2099-09-02'));
  await page.uncheck('#calWorking');
  expect(await page.evaluate(()=>window.data['2099-09-02'].working)).toBeFalsy();

  await page.getByRole('button',{name:'Сохранить'}).click();
  await expect.poll(()=>page.evaluate(()=>window.saveCalls)).toBe(1);
});

test('production page loads compact schedule runtime after bulk runtime', async () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  expect(html).toContain('schedule-identity-v46.js?v=20260913-v64');
  expect(html).toContain('master-schedule-compact-v65.js?v=20260913-v65');
  expect(html.indexOf('master-schedule-compact-v65.js')).toBeGreaterThan(html.indexOf('schedule-identity-v46.js'));
});
