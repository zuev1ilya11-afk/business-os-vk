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
