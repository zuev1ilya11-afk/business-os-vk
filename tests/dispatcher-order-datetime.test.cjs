const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','management-order-compact-v82.js'),'utf8');

test('dispatcher management order exposes editable date and time',()=>{
  assert.match(source,/id="quickScheduledDate" type="date"/);
  assert.match(source,/id="quickScheduledTime" type="time"/);
});

test('quick save persists scheduled date and time through updateOrder',()=>{
  assert.match(source,/scheduled_date:dateInput\?dateInput\.value:''/);
  assert.match(source,/scheduled_time:timeInput\?timeInput\.value:''/);
  assert.match(source,/api\('updateOrder'/);
});
