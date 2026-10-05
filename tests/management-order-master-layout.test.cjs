const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const management=fs.readFileSync('management-order-compact-v82.js','utf8');
const master=fs.readFileSync('master-order-hands-layout-v72.js','utf8');
const editor=fs.readFileSync('business-os-custom-v3.js','utf8');

test('management order mirrors master information blocks and stays editable',()=>{
  assert.match(management,/bosManageTitle/);
  assert.match(management,/Поступила \$\{esc\(received\(o\)\)\}/);
  assert.match(management,/bosHandsBlock/);
  assert.match(management,/Комментарий/);
  assert.match(management,/Состав работ/);
  assert.match(management,/data-bos-contact-order/);
  assert.match(management,/Быстрое редактирование/);
  assert.match(management,/Редактировать заявку/);
  assert.match(management,/managementRoles=new Set\(\['owner','manager','dispatcher'\]\)/);
});

test('leadership editor supports multiple phones, works and a master comment',()=>{
  assert.match(editor,/bosPhoneStack/);
  assert.match(editor,/id="bosPhone"/);
  assert.match(editor,/bosAddPhone/);
  assert.match(editor,/bosWorkStack/);
  assert.match(editor,/id="bosService"/);
  assert.match(editor,/bosAddWork/);
  assert.match(editor,/Комментарий мастеру/);
  assert.doesNotMatch(editor,/цена не указана в прайсе/);
});

test('master received date is shown inline with the order number',()=>{
  assert.match(master,/bosMasterTitle/);
  assert.match(master,/bosReceivedInline/);
  assert.match(master,/bosReceivedInline bosCompactReceived/);
});
