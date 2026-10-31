const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
let X;try{X=require('../finance-export-data.js')}catch{}
test('finance export exposes a read-only snapshot builder',()=>assert.equal(typeof X?.snapshot,'function'));
const snapshot=(patch={})=>{const f={...fixture(),...patch};return X.snapshot(f.orders,f.staff,f.expenses,f.filters)};
test('export reconciles saved payroll without 6% deduction, extras and company expenses',()=>{
 const f=fixture(),before=structuredClone(f),s=X.snapshot(f.orders,f.staff,f.expenses,f.filters);
 // 600 + (1105 + 300) + 442 + 552.50 + 540 = 3539.50.
 assert.deepEqual([s.total.total,s.total.completed,s.total.revenue,s.total.pay,s.total.company,s.total.expenses,s.total.net,s.total.average],[7,5,6000,3539.5,2460.5,150,2310.5,1200]);
 assert.deepEqual(f,before);
 const sheets=X.sheets(s,new Date('2026-10-31T09:00:00Z'));
 assert.deepEqual(sheets.map(x=>x.name),['Сводка','Заявки','Работы','Мастера','Источники','Расходы']);
 const orders=[...sheets[1].rows()];assert.equal(orders.length,7);
 assert.deepEqual(orders[0].slice(13,23),[1000,0,0,null,null,1000,600,50,400,350]);
 assert.equal(orders[0][1],'00001');assert.equal(orders[0][3].type,'date');
 assert.equal(orders[6][16],null);assert.equal(orders[6][17],null);
 const sources=[...sheets[4].rows()];assert.equal(sources.filter(r=>r[0]==='Руки (Hands)').length,1);assert.equal(sources.find(r=>r[0]==='Руки (Hands)')[3],3100);assert.ok(sources.some(r=>r[0]==='Лемана Про'));
});
test('work quantities, prices and deductions are separate; missing allocations remain blank',()=>{
 const ws=[...X.sheets(snapshot())[2].rows()];
 assert.deepEqual(ws[0].slice(5,12),['Монтаж','основная',2,'шт.',500,1000,null]);
 assert.equal(ws[0][12],null); // No per-line payroll snapshot is persisted.
 const extra=ws.find(r=>r[6]==='дополнительная');assert.equal(extra[5],'Дополнительный крепёж');assert.equal(extra[7],null);assert.equal(extra[10],300);assert.equal(extra[12],300);
 const removed=ws.find(r=>r[6]==='невыполненная');assert.equal(removed[7],1);assert.equal(removed[10],200);assert.equal(removed[12],null);
 const legacy=ws.find(r=>r[0]==='3'&&r[6]==='основная');assert.equal(legacy[5],'Подрезка карниза по длине');assert.equal(legacy[7],5);assert.equal(legacy[9],null);
});
test('selected period, master, source, city, work and drilldown/search are honoured',()=>{
 const f=fixture();
 const filters={...f.filters,source:'Руки (Hands)',city:'Санкт-Петербург',master:'m',work:'standard_020'};
 assert.deepEqual(snapshot({filters}).rows.map(x=>x.id),['3']);
 assert.deepEqual(snapshot({filters:{...f.filters,period:{start:'2026-10-11',end:'2026-10-11'}}}).rows.map(x=>x.id),['1','2','3','4','5','6','7']);
 assert.equal(snapshot({filters:{...f.filters,period:{start:'2026-10-10',end:'2026-10-10'}}}).rows.length,0);
 assert.equal(snapshot({filters:{...f.filters,selected:'n'}}).rows.length,1);
 assert.equal(snapshot({filters:{...f.filters,search:'ВТОРОЙ'}}).rows.length,1);
});
test('unknown saved money stays unknown and no-expense workbook has five sheets',()=>{
 const f=fixture();f.orders=[{...f.orders[0],master_payout:null,amount:null}];f.expenses=[];
 const s=snapshot(f);assert.equal(s.total.pay,null);assert.equal(s.total.revenue,null);assert.equal(s.total.net,null);assert.equal(X.sheets(s).length,5);
});
test('expenses use their own dates, preserve unrelated/unallocated amounts, and never duplicate across masters',()=>{
 const f=fixture();f.orders[0].completed_at='2026-09-01';f.expenses[0].employee_id='n';
 const s=snapshot(f);assert.equal(s.total.expenses,150);
 const sheets=X.sheets(s),sources=[...sheets[4].rows()],masters=[...sheets[3].rows()];
 assert.equal(sources.reduce((n,r)=>n+r[5],0),150);
 assert.equal(masters.reduce((n,r)=>n+r[7],0),150);
 assert.equal(masters.find(r=>r[0]==='Второй мастер')[7],50);
});
test('invalid periods and unknown filters fail instead of exporting a broader selection',()=>{
 for(const filters of [{period:{start:'2026-02-30',end:'2026-03-01'}},{period:{start:'2026-10-02',end:'2026-10-01'}},{status:'Выполнена'},{master:['m']},{period:{start:'2026-01-01'}},{source:'x'.repeat(501)}])assert.throws(()=>X.filters(filters));
});
test('master corrections count distinct persisted claims on selected orders within the export period',()=>{
 const f=fixture(),claims=[{id:'c1',order_id:'1',master_staff_id:'m',opened_at:'2026-10-10T10:00:00Z'},{id:'c2',order_id:'4',master_staff_id:'n',opened_at:'2026-09-01T00:00:00Z'}];
 const s=X.snapshot(f.orders,f.staff,f.expenses,f.filters,claims);
 assert.equal([...X.sheets(s)[3].rows()].find(r=>r[0]==='Тестовый мастер')[10],1);
 assert.equal([...X.sheets(s)[3].rows()].find(r=>r[0]==='Второй мастер')[10],0);
});
test('mixed manual text and structured work items both survive without duplicated generated lines',()=>{
 const f=fixture();f.orders=[{...f.orders[0],work:'Ручной демонтаж\nМонтаж × 2 шт.'}];
 const work=[...X.sheets(snapshot(f))[2].rows()];
 assert.equal(work.length,2);assert.ok(work.some(r=>r[5]==='Ручной демонтаж'&&r[7]===null&&r[10]===null));assert.equal(work.filter(r=>r[5]==='Монтаж').length,1);
});
test('expense search uses the same historical name with active-only bootstrap and full server staff',()=>{
 const f=fixture();f.staff[0].is_active=false;f.staff[0].full_name='Новое имя';f.expenses[0].employee_id='m';f.filters.search='Тестовый мастер';
 const client=X.snapshot(f.orders,f.staff.filter(x=>x.is_active),f.expenses,f.filters),server=X.snapshot(f.orders,f.staff,f.expenses,f.filters);
 assert.equal(client.total.expenses,50);assert.equal(server.total.expenses,50);
});
test('inactive master search also preserves their historical claim count',()=>{
 const f=fixture();f.staff[0].is_active=false;f.staff[0].full_name='Новое имя';f.filters.search='Тестовый мастер';
 const s=X.snapshot(f.orders,f.staff,f.expenses,f.filters,[{id:'c1',order_id:'1',master_staff_id:'m',opened_at:'2026-10-10T10:00:00Z'}]);
 assert.equal([...X.sheets(s)[3].rows()].find(r=>r[0]==='Тестовый мастер')[10],1);
});
