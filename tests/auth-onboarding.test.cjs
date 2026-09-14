const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('mandatory VK onboarding uses staff invites, not phone linking',()=>{
  const source=fs.readFileSync('mandatory-auth-v29.js','utf8');
  assert.match(source,/staff-invite-api/);
  assert.match(source,/simpleInviteForm/);
  assert.match(source,/inviteApi\('redeem'/);
  assert.doesNotMatch(source,/registerByPhone/);
  assert.doesNotMatch(source,/simplePhoneForm/);
});

test('database migration guards direct VK linking and keeps redeem atomic',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260913163500_staff_invites.sql','utf8');
  assert.match(sql,/business_staff_vk_link_guard/);
  assert.match(sql,/VK_LINK_REQUIRES_INVITE/);
  assert.match(sql,/redeem_staff_invite/);
  assert.match(sql,/for update/i);
  assert.match(sql,/app\.staff_invite_redeem/);
});
