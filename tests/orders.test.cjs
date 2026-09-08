const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/gas.cjs');
const draft={client:'Клиент',address:'Тестовый адрес',work:'Ремонт',phone:'+79990000000',amount:100,city:'Москва',scheduled_date:'2026-09-10',scheduled_time:'12:30',request_id:'test_request_001'};
test('create, retry, edit, assign, start, complete and cancel',()=>{
 const f=fixture();const a=f.request('createOrder',draft);assert.equal(a.ok,true);assert.equal(a.order.status,'Новая');
 const retry=f.request('createOrder',draft);assert.equal(retry.order.id,a.order.id);assert.equal(f.data.Orders.length,2);
 const id=a.order.id;
 assert.equal(f.request('updateOrder',{id,status:'Назначена'}).error,'MASTER_REQUIRED');
 let r=f.request('updateOrder',{id,master_vk_id:'102',master_name:'spoof',comment:"100% + = ' &",amount:250});assert.equal(r.order.master_name,'Тестовый мастер');assert.equal(r.order.status,'Назначена');
 assert.equal(f.request('updateOrder',{id,status:'В работе'},'102').ok,true);
 assert.equal(f.request('updateOrder',{id,status:'Выполнена'},'102').ok,true);
 assert.equal(f.request('updateOrder',{id,status:'В работе'},'102').error,'BAD_STATUS');
 assert.equal(f.request('updateOrder',{id,status:'Отменена'}).ok,true);
 const order=f.request('bootstrap').orders[0];assert.equal(order.phone,'+79990000000');assert.equal(order.comment,"100% + = ' &");assert.equal(order.scheduled_time,'12:30');
});
test('access checks, inactive flags and city boundaries',()=>{
 const f=fixture();const order=f.request('createOrder',draft).order;
 assert.equal(f.request('createOrder',draft,'102').error,'FORBIDDEN');
 assert.equal(f.request('updateOrder',{id:order.id,status:'В работе'},'102').error,'FORBIDDEN');
 assert.equal(f.request('updateOrder',{id:order.id,comment:'cross city'},'104').error,'FORBIDDEN');
 assert.equal(f.request('createOrder',draft,'104').error,'FORBIDDEN');
 assert.equal(f.request('bootstrap',{},'102').users.length,1);
 f.data.Users[2][4]='FALSE';assert.equal(f.request('bootstrap',{},'102').error,'ACCESS_DENIED');
 assert.equal(f.request('bootstrap',{},'999').error,'ACCESS_DENIED');
});
test('first owner is pinned, not the first random visitor',()=>{
 const f=fixture();f.data.Users.length=1;
 assert.equal(f.request('bootstrap',{},'999').error,'ACCESS_DENIED');
 assert.equal(f.data.Users.length,1);
 assert.equal(f.request('bootstrap').user.role,'owner');
 assert.equal(f.data.Users.length,2);
});
test('rejects invalid forms and protects the last owner',()=>{
 const f=fixture();for(const patch of [{client:''},{amount:-1},{scheduled_date:'2026-02-30'},{scheduled_time:'25:00'},{master_vk_id:'999'}])assert.equal(f.request('createOrder',{...draft,...patch}).ok,false);
 assert.equal(f.data.Orders.length,1);
 assert.equal(f.request('setUserRole',{vk_user_id:'101',role:'master'}).error,'LAST_OWNER');
 assert.equal(f.request('setUserRole',{vk_user_id:'103',role:'manager'}).user.role,'manager');
 assert.equal(f.request('setUserRole',{vk_user_id:'103',role:'owner'},'102').error,'FORBIDDEN');
});
test('JSON payload retains literal percent escapes; supports old frontend encoding',()=>{
 const f=fixture();const payload={comment:'literal %2B + 100% & ='};
 assert.equal(f.context.parsePayload_(JSON.stringify(payload)).comment,payload.comment);
 assert.equal(f.context.parsePayload_(encodeURIComponent(JSON.stringify(payload))).comment,payload.comment);
 assert.throws(()=>f.context.parsePayload_('garbage'));
});
test('date/time cells normalize to input formats and spreadsheet formulas are escaped',()=>{
 const f=fixture();const r=f.context.rowObject_(['scheduled_date','scheduled_time'],[new Date('2026-09-10T00:00:00Z'),new Date('1899-12-30T12:30:00Z')]);assert.equal(r.scheduled_date,'2026-09-10');assert.equal(r.scheduled_time,'12:30');
 assert.equal(f.context.cellValue_('=1+1'),"'=1+1");assert.equal(f.context.cellValue_(42),42);
});
