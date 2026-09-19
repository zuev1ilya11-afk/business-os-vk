const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('master report exposes a reschedule flow and client call action',()=>{
  const ui=fs.readFileSync('master-reschedule-call-v87.js','utf8');
  const loader=fs.readFileSync('pwa-register.js','utf8');

  assert.match(loader,/master-reschedule-call-v87\.js/);
  assert.match(ui,/Нужно перенести/);
  assert.match(ui,/Причина переноса/);
  assert.match(ui,/maxlength=\"80\"/);
  assert.match(ui,/profile-self-api/);
  assert.match(ui,/@@BOS_R1@@\|/);
  assert.match(ui,/href=`tel:\$\{tel\}`/);
  assert.match(ui,/Позвонить/);
});

test('reschedule persistence is scoped to the assigned active master order',()=>{
  const fields=fs.readFileSync('supabase/migrations/20260919203032_add_order_reschedule_request_fields.sql','utf8');
  const bridge=fs.readFileSync('supabase/migrations/20260919203544_master_reschedule_profile_bridge.sql','utf8');

  assert.match(fields,/reschedule_requested boolean not null default false/);
  assert.match(fields,/reschedule_reason text/);
  assert.match(fields,/reschedule_requested_by uuid references public\.business_staff\(id\)/);
  assert.match(bridge,/old\.role <> 'master'/);
  assert.match(bridge,/master_staff_id = old\.id/);
  assert.match(bridge,/status not in \('Выполнена', 'Отменена'\)/);
  assert.match(bridge,/new\.district := old\.district/);
});
