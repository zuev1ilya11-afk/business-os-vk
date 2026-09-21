const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');

const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('owner team page keeps staff credential controls visible',()=>{
  const source=read('team-roles-fix-v31.js');
  assert.match(source,/Доступ сотрудников/);
  assert.match(source,/openStaffAccess\('all'\)/);
  assert.match(source,/ownerMode\(\).*openStaffAccess/s);
});

test('staff credential forms match production password length policy',()=>{
  const source=read('team-roles-fix-v31.js');
  assert.match(source,/setAttribute\('minlength','10'\)/);
  assert.match(source,/Не менее 10 символов/);
});
