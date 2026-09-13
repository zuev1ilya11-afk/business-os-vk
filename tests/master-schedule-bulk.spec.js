const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('bulk schedule applies one time range to all visible days and keeps single-day override possible', async ({ page }) => {
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
    window.state={masters:[],masterSchedule:[],user:{role:'master'}};
    window.masterSchedule=[];
    window.pages={team:()=>'',dispatch:()=>'',home:()=>''};
    window.reloadData=async()=>{};
    window.renderMonthCalendar=()=>{};
    window.liveMasterMode=()=>true;
    window.api=async()=>({ok:true});
    window.data={};
    window.selectMasterCalendarDay=(date)=>{
      const d=window.data[date]||(window.data[date]={working:false,start:'10:00',end:'20:00'});
      document.getElementById('editor').innerHTML='<input id="calWorking" type="checkbox"><select id="calStart"><option>09:00</option><option>10:00</option><option>11:00</option></select><select id="calEnd"><option>18:00</option><option>19:00</option><option>20:00</option></select>';
      const w=document.getElementById('calWorking'),s=document.getElementById('calStart'),e=document.getElementById('calEnd');
      w.checked=d.working;s.value=d.start;e.value=d.end;
      w.addEventListener('change',()=>d.working=w.checked);
      s.addEventListener('change',()=>d.start=s.value);
      e.addEventListener('change',()=>d.end=e.value);
    };
  `});
  const script=fs.readFileSync(path.join(__dirname,'..','schedule-identity-v46.js'),'utf8');
  await page.addScriptTag({content:script});
  await expect(page.getByText('Быстро задать график')).toBeVisible();
  await page.selectOption('#bosBulkStart','09:00');
  await page.selectOption('#bosBulkEnd','18:00');
  await page.getByRole('button',{name:'Все дни'}).click();
  const all=await page.evaluate(()=>Object.values(window.data));
  expect(all).toHaveLength(3);
  expect(all.every(x=>x.working&&x.start==='09:00'&&x.end==='18:00')).toBeTruthy();
  await page.evaluate(()=>window.selectMasterCalendarDay('2099-09-02'));
  await page.uncheck('#calWorking');
  const changed=await page.evaluate(()=>window.data['2099-09-02']);
  expect(changed.working).toBeFalsy();
});

test('production page cache-busts the bulk schedule runtime', async () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  expect(html).toContain('schedule-identity-v46.js?v=20260913-v64');
  expect(html).toContain('master-ux-runtime-v44.js');
});
