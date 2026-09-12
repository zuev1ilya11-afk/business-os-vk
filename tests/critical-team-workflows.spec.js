const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('mini app bootstrap never exposes staff password hashes',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','supabase','functions','mini-app-api','index.ts'),'utf8');
  expect(source).toContain('delete x.password_hash');
  expect(source).toContain("can_manage_staff:['owner','manager'].includes(role)");
});

test('employee creation succeeds once even when district metadata fails',async({page})=>{
  await page.setContent('<div id="modalRoot"></div><div id="content"></div>');
  await page.addScriptTag({content:`
    window.state={busy:false,user:{role:'owner'},users:[],masters:[]};
    window.pages={team:()=>'<div>team</div>'};
    window.ROLE_NAMES={owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'};
    window.$=s=>document.querySelector(s);
    window.esc=s=>String(s??'');
    window.openModal=html=>{document.querySelector('#modalRoot').innerHTML='<div class="modal">'+html+'</div>'};
    window.closeModal=()=>{document.querySelector('#modalRoot').innerHTML=''};
    window.show=()=>{};
    window.setBusy=(form,b)=>{window.state.busy=b;form.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=b)};
    window.reloadData=async()=>({ok:true});
    window.addEmployeeCalls=0;
    window.api=async(action,payload)=>{
      if(action==='addEmployee'){
        window.addEmployeeCalls++;
        const user={id:'staff-1',external_id:'staff_1',vk_user_id:'staff_1',full_name:payload.full_name,role:payload.role,phone:payload.phone,city:'Санкт-Петербург',is_active:true};
        return {ok:true,user,master:payload.role==='master'?user:null};
      }
      return {ok:true};
    };
    window.BOS_AUTH_HEADERS=async()=>({'Content-Type':'application/json','X-BOS-Session':'test'});
    window.fetch=async()=>({ok:false,status:502,json:async()=>({ok:false,error:'metadata offline'})});
  `});
  await page.addScriptTag({path:path.join(__dirname,'..','employee-form-v16.js')});
  await page.evaluate(()=>window.openEmployeeForm());
  await expect(page.locator('#empForm select[name="role"] option[value="owner"]')).toHaveCount(0);
  await page.locator('#empForm input[name="full_name"]').fill('Новый мастер');
  await page.locator('#empForm input[name="phone"]').fill('+7 999 123-45-67');
  await page.locator('#empForm input[name="district"]').fill('Центральный');
  await page.locator('#empForm button[type="submit"]').click();
  await expect.poll(()=>page.evaluate(()=>window.addEmployeeCalls)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.state.users.length)).toBe(1);
  await expect(page.locator('#modalRoot')).toContainText('Сотрудник создан');
});

async function mockTeamApp(page,role){
  const user={id:'actor-1',external_id:role==='owner'?'owner_1':'dispatcher_1',vk_user_id:role==='owner'?'owner_1':'dispatcher_1',full_name:role==='owner'?'Владелец':'Диспетчер',role,city:'Санкт-Петербург',is_active:true};
  const master={id:'master-id',external_id:'master_1',vk_user_id:'master_1',full_name:'Мастер Тест',role:'master',city:'Санкт-Петербург',is_active:true};
  const orders=[{id:'ORDER-CRIT-1',status:'В работе',client:'Клиент',phone:'79990000000',address:'Невский 1',work:'Монтаж',amount:5000,original_amount:5000,scheduled_date:'2026-09-13',scheduled_time:'10:00',master_vk_id:'',master_name:''}];
  const updates=[];
  await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','critical-session'));
  const mini=async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    if(body.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user,orders,users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{permissions:{can_manage_orders:true,can_manage_schedule:true,can_manage_staff:role==='owner',can_review_reports:true,can_view_finance:role==='owner'}}})});
    if(body.action==='updateOrder'){
      updates.push(body);
      const i=orders.findIndex(o=>String(o.id)===String(body.id));
      const assigned=String(body.master_vk_id||'');
      orders[i]={...orders[i],...body,master_name:assigned?'Мастер Тест':orders[i].master_name};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:orders[i]})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  };
  await page.route('**/api/proxy/mini-app-api',mini);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',mini);
  const ok=route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"claims":[],"orders":[],"masters":[]}'});
  await page.route('**/api/proxy/claims-api',ok);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',ok);
  return {orders,master,updates};
}

test('owner can assign an order to a master through the real order UI',async({page})=>{
  const {updates}=await mockTeamApp(page,'owner');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  await page.getByText('ORDER-CRIT-1',{exact:true}).click();
  await page.locator('#quickMaster').selectOption('master_1');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect.poll(()=>updates.some(x=>x.action==='updateOrder'&&x.id==='ORDER-CRIT-1'&&x.master_vk_id==='master_1')).toBe(true);
});

test('dispatcher can close an active order through the real order UI',async({page})=>{
  const {updates}=await mockTeamApp(page,'dispatcher');
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  await page.getByText('ORDER-CRIT-1',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Закрыть заявку',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть заявку',exact:true}).click();
  await expect.poll(()=>updates.some(x=>x.action==='updateOrder'&&x.id==='ORDER-CRIT-1'&&x.status==='Выполнена')).toBe(true);
});
