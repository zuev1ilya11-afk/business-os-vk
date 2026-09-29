const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const ctx={window:{}};vm.runInNewContext(readFileSync('schedule-contract.js','utf8'),ctx);
const c=ctx.window.BOS_SCHEDULE_CONTRACT;
test('schedule uses scheduled_time start and preserves slot duration without rounding',()=>{
 const r=c.range({scheduled_time:'12:00:00',time_slot:'10:00–11:00'});assert.equal(r.start,720);assert.equal(r.end,780);
 assert.equal(c.timeOf({time_slot:'9:00–10:00'}),'09:00');
 assert.equal(c.move({time_slot:'10:10–11:45'},'12:05'),'12:05–13:40');
});
test('only 24:00 end is valid; bad and reversed slots fall back to sixty minutes',()=>{
 assert.equal(c.range({time_slot:'23:00–24:00'}).duration,60);assert.equal(c.minutes('24:00'),null);
 for(const value of ['24:01','24:00:01','24:00:00.01','25:00','9:60','n/a'])assert.equal(c.minutes(value,true),null);
 assert.equal(c.minutes('24:00:00',true),1440);
 for(const slot of ['10:00–09:00','10:00–invalid','10:00'])assert.equal(c.range({time_slot:slot}).duration,60);
 assert.equal(c.range({}),null);assert.equal(c.move({time_slot:'10:00–13:00'},'22:00'),null);
});
test('master aliases join through staff directory, never through order external_id',()=>{
 const masters=[{id:'m',external_id:'staff_m',vk_user_id:123,full_name:'Иван'},{id:'n',external_id:'staff_n',full_name:'Иван'}];
 for(const order of [{master_staff_id:'m'},{master_vk_id:'staff_m'},{master_vk_id:123}])assert.equal(c.masterKey(order,masters),'staff:m');
 assert.equal(c.sameMaster(masters[0],{master_staff_id:'n',master_name:'Иван'}),false);
 assert.equal(c.masterKey({id:'m',external_id:'staff_m'},masters),'');
 assert.equal(c.sameMaster({},{}),false);assert.equal(c.sameMaster(masters[0],{master_name:'Иван'}),true);
});
