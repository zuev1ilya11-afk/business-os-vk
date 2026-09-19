const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('employee creation stays owner-only across UI and API',()=>{
  const ui=fs.readFileSync('employee-form-v16.js','utf8');
  const api=fs.readFileSync('supabase/functions/mini-app-api/index.ts','utf8');

  assert.match(ui,/function canCreateStaff\(\)\{return String\(state\.user\?\.role\|\|''\)==='owner'\}/);
  assert.match(ui,/window\.openEmployeeForm=function\(\)\{if\(!canCreateStaff\(\)\)return;/);
  assert.match(ui,/const teamHtml=canCreateStaff\(\)\?html:html\.replace/);
  assert.match(api,/if\(role!=='owner'\)return j\(\{ok:false,error:'Только владелец может добавлять сотрудников'\},403\)/);
});

test('credential administration stays owner-only in the employee UI',()=>{
  const ui=fs.readFileSync('employee-form-v16.js','utf8');
  assert.match(ui,/function canAdminStaff\(\)\{return String\(state\.user\?\.role\|\|''\)==='owner'\}/);
  assert.match(ui,/if\(!canAdminStaff\(\)\)return html\.replace/);
  assert.match(ui,/Управление сотрудниками/);
});
