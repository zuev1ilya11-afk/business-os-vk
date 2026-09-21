const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('employee profiles refresh staff data from bootstrap automatically',()=>{
  const src=fs.readFileSync('employee-profile-refresh-v94.js','utf8');
  assert.match(src,/api\('bootstrap'\)/);
  assert.match(src,/state\.orders=normalizeOrders\(d\.orders\)/);
  assert.match(src,/state\.users=d\.users/);
  assert.match(src,/state\.masters=d\.masters/);
  assert.match(src,/state\.masterSchedule=d\.masterSchedule/);
  assert.match(src,/window\.BOS_REFRESH_STAFF_STATE=refreshStaffState/);
  assert.match(src,/window\.openEmployeeProfile=function\(id\)/);
  assert.match(src,/baseEmployeeProfile\.call\(this,id\)/);
});

test('staff actions trigger a quiet state refresh',()=>{
  const src=fs.readFileSync('employee-profile-refresh-v94.js','utf8');
  assert.match(src,/wrapFormOpener\('openMasterProfileEdit','#masterProfileEditForm'\)/);
  assert.match(src,/wrapFormOpener\('openEmployeeForm','#empForm'\)/);
  assert.match(src,/wrapFormOpener\('openMasterReportForm','#masterReportForm'\)/);
  assert.match(src,/wrapAsyncAction\('saveMasterCalendarMonth'\)/);
  assert.match(src,/wrapAsyncAction\('saveMasterWeek'\)/);
  assert.match(src,/wrapAsyncAction\('masterWorkflowSetStage'\)/);
});

test('refresh patch is loaded after employee action patches',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const refresh=html.indexOf('employee-profile-refresh-v94.js?v=20260921-v94');
  const workflow=html.indexOf('master-workflow-v25.js?v=20260920-v25');
  assert.ok(refresh>workflow,'refresh patch must load after employee action scripts');
});
