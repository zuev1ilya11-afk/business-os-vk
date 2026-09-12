const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('Netlify gateway allows staff administration endpoint',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','netlify','functions','proxy.mts'),'utf8');
  expect(source).toContain('"staff-admin-api"');
  expect(source).toContain('"master-memo-api"');
});

test('production HTML loads and cache-busts live field fixes',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  expect(html).toContain('schedule-identity-v46.js?v=20260912-v60');
  expect(html).toContain('live-field-hotfix-v60.js?v=20260912-v61');
  expect(html).toContain('employee-form-v16.js?v=20260912-v61');
  expect(html).toContain('master-memo-runtime-v21.js?v=20260912-v62');
  expect(html).toContain('manager-memo-editor-v45.js?v=20260912-v62');
});

test('master memo loads through gateway and offers Word download',async({page})=>{
  await page.setContent('<div id="modalRoot"></div>');
  await page.addScriptTag({content:`
    window.state={user:{role:'master'},busy:false};
    window.$=s=>document.querySelector(s);
    window.esc=s=>String(s??'');
    window.openModal=html=>{document.querySelector('#modalRoot').innerHTML='<div class="modal">'+html+'</div>'};
    window.closeModal=()=>{};
    window.setBusy=()=>{};
    window.openOwnerTools=()=>{};
    window.fetchCalls=[];
    window.fetch=async(url)=>{
      window.fetchCalls.push(String(url));
      return new Response(JSON.stringify({ok:true,items:[{id:'memo-1',category:'tips',title:'Памятка мастеру',note:'Правила работы',file_name:'pamyatka-masteru.docx',file_url:'https://files.example/pamyatka-masteru.docx'}]}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    window.BOS_AUTH_HEADERS=async()=>({'X-BOS-Session':'memo-session'});
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','master-memo-runtime-v21.js')});
  await page.evaluate(()=>window.openMasterMemoItem('tips'));
  await expect(page.getByText('Памятка мастеру',{exact:true})).toBeVisible();
  const download=page.getByRole('link',{name:'Скачать Word'});
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('download','pamyatka-masteru.docx');
  const calls=await page.evaluate(()=>window.fetchCalls);
  expect(calls[0]).toBe('https://business-os-api-gateway.netlify.app/api/proxy/master-memo-api');
});

test('staff admin falls back to direct Supabase when deployed gateway is stale',async({page})=>{
  await page.setContent('<div></div>');
  await page.addScriptTag({content:`
    window.state={masters:[],masterSchedule:[],users:[],user:{role:'owner'}};
    window.pages={dispatch:()=>'',home:()=>'',team:()=>''};
    window.reloadData=async()=>{};
    window.api=async()=>({ok:true});
    window.masterSchedule=[];
    window.fetchCalls=[];
    window.fetch=async function(url){
      window.fetchCalls.push(String(url));
      if(String(url).includes('business-os-api-gateway.netlify.app')){
        return new Response(JSON.stringify({ok:false,error:'SERVICE_NOT_ALLOWED'}),{status:404,headers:{'Content-Type':'application/json'}});
      }
      return new Response(JSON.stringify({ok:true,staff:[]}),{status:200,headers:{'Content-Type':'application/json'}});
    };
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','live-field-hotfix-v60.js')});
  const result=await page.evaluate(async()=>{
    const r=await fetch('https://business-os-api-gateway.netlify.app/api/proxy/staff-admin-api',{method:'POST'});
    return {body:await r.json(),calls:window.fetchCalls};
  });
  expect(result.body.ok).toBe(true);
  expect(result.calls).toEqual([
    'https://business-os-api-gateway.netlify.app/api/proxy/staff-admin-api',
    'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/staff-admin-api'
  ]);
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
    window.fetch=async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','schedule-identity-v46.js')});
  await page.addScriptTag({path:path.join(__dirname,'..','live-field-hotfix-v60.js')});

  await page.evaluate(()=>window.setMasterSchedulePreset('weekdays'));
  const state=await page.evaluate(()=>window.calendarState);
  expect(state['2026-09-01']).toBe(true);
  expect(state['2026-09-05']).toBe(false);

  const result=await page.evaluate(()=>window.api('saveMasterSchedule',{days:[]}));
  expect(result.ok).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.apiCalls)).toBe(2);
});
