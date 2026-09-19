const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('manager and dispatcher get the reschedule orders filter',()=>{
  const ui=fs.readFileSync('order-filters-v22.js','utf8');

  assert.match(ui,/function odRescheduleRole\(\)/);
  assert.match(ui,/\['manager','dispatcher'\]\.includes\(role\)/);
  assert.match(ui,/isDispatcherPreview/);
  assert.match(ui,/isManagerPreview/);
  assert.match(ui,/bosOrderFilter==='reschedule'/);
  assert.match(ui,/!!o\.reschedule_requested/);
  assert.match(ui,/\['reschedule','Нужно перенести',odCount\('reschedule'\)\]/);
  assert.match(ui,/bosRescheduleChip/);
});

test('reschedule filter is not granted to owner by the base role check',()=>{
  const ui=fs.readFileSync('order-filters-v22.js','utf8');
  const roleGuard=ui.match(/function odRescheduleRole\(\)\{([^}]*)\}/)?.[1]||'';
  assert.doesNotMatch(roleGuard,/owner/);
});
