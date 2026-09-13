const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20260913163500_staff_invites.sql','utf8');
const api=fs.readFileSync('supabase/functions/staff-invite-api/index.ts','utf8');
const ui=fs.readFileSync('staff-invite-ui-v66.js','utf8');
const html=fs.readFileSync('index.html','utf8');

test('staff invites are hashed, expiring and one-time',()=>{
  assert.match(migration,/code_hash text not null unique/i);
  assert.match(migration,/expires_at > now\(\)/i);
  assert.match(migration,/consumed_at is null/i);
  assert.match(migration,/for update/i);
  assert.match(migration,/revoked_at = now\(\)/i);
  assert.match(api,/sha256hex\(code\)/);
  assert.doesNotMatch(api,/code_plain|plain_code/i);
});

test('direct unverified VK linking is blocked at the database boundary',()=>{
  assert.match(migration,/business_staff_vk_link_guard/i);
  assert.match(migration,/VK_LINK_REQUIRES_INVITE/);
  assert.match(migration,/current_setting\('app\.staff_invite_redeem'/);
  assert.match(migration,/revoke all on function public\.redeem_staff_invite\(text, text\) from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function public\.redeem_staff_invite\(text, text\) to service_role/i);
});

test('VK onboarding uses owner invitation UI',()=>{
  assert.match(ui,/simpleInviteForm/);
  assert.match(ui,/invitePost\('redeem'/);
  assert.match(ui,/invitePost\('issue'/);
  assert.match(html,/staff-invite-ui-v66\.js\?v=20260913-v66/);
});
