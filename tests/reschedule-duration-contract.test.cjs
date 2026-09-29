const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
function fixture(slot='10:00–13:00'){
 const db=database({business_staff:[employee('owner','owner')],orders:[{id:'o',status:'В работе',updated_at:'v1',scheduled_date:'2026-10-01',scheduled_time:'10:00',time_slot:slot,reschedule_requested:true,reschedule_reason:'Позже',master_staff_id:'m',amount:1000,master_payout:552.5}]});
 return {db,api:edge('order-meta-api',db)};
}
const move=(extra={})=>({action:'resolveReschedule',id:'o',scheduled_date:'2026-10-02',scheduled_time:'12:00',...extra});
for(const [old,next] of [['10:00–10:30','12:00–12:30'],['10:00–11:00','12:00–13:00'],['10:00–13:00','12:00–15:00'],['9:00–12:00','12:00–15:00']])test(`reschedule preserves ${old} duration`,async()=>{
 const {db,api}=fixture(old);const r=await api(move());assert.equal(r.status,200);assert.equal(r.body.order.time_slot,next);
 assert.equal(db.tables.orders[0].reschedule_requested,false);assert.equal(db.tables.orders[0].master_payout,552.5);assert.equal(db.tables.orders[0].master_staff_id,'m');
});
test('explicit range is validated and a midnight end is represented as 24:00',async()=>{
 const {api}=fixture();const r=await api(move({scheduled_time:'21:00',time_slot:'21:00–24:00'}));assert.equal(r.status,200);assert.equal(r.body.order.time_slot,'21:00–24:00');
 for(const value of ['11:00–15:00','12:00–11:00','12:00–25:00','garbage','12:00–12:00']){const {api,db}=fixture();const before=structuredClone(db.tables.orders);assert.equal((await api(move({time_slot:value}))).status,400);assert.deepEqual(db.tables.orders,before)}
});
test('a move cannot silently shorten duration beyond midnight',async()=>{
 const {api,db}=fixture(),before=structuredClone(db.tables.orders);assert.equal((await api(move({scheduled_time:'22:00'}))).status,400);assert.deepEqual(db.tables.orders,before);
});
test('a stale second request cannot overwrite a later edit',async()=>{
 const {api,db}=fixture(),before=structuredClone(db.tables.orders);assert.equal((await api(move({expected_updated_at:'old'}))).status,409);assert.deepEqual(db.tables.orders,before);
});
test('concurrent completion wins over a reschedule',async()=>{
 const {api,db}=fixture();db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update')Object.assign(db.tables.orders[0],{status:'Выполнена',updated_at:'v2'})};
 assert.equal((await api(move())).status,409);assert.equal(db.tables.orders[0].status,'Выполнена');assert.equal(db.tables.orders[0].time_slot,'10:00–13:00');assert.equal(db.tables.orders[0].reschedule_requested,true);
});
