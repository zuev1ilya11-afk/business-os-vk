const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
const id='b1b34875-2935-4e79-93e2-1c6b5a135b08';
const fixture=()=>database({business_staff:[employee('owner','owner'),employee('manager','manager'),employee('master','master'),employee('dispatcher','dispatcher')],finance_expenses:[],orders:[{id:'17',amount:1000,master_payout:600,source:'Авито',city:'Москва'}]});
const input={id,expense_date:'2026-10-04',amount:'15000.25',category:'avito',comment:'Пополнение тарифа'};
test('expense CRUD derives author, preserves creator on edit and never touches orders',async()=>{
 const db=fixture(),api=edge('mini-app-api',db),orders=structuredClone(db.tables.orders);
 let r=await api({action:'createExpense',...input,created_by_staff_id:'attacker',created_by_name:'Fake'},'100');
 assert.equal(r.status,200);assert.equal(r.body.expense.amount,15000.25);assert.equal(r.body.expense.created_by_staff_id,'owner');assert.equal(r.body.expense.created_by_name,'owner');assert.ok(r.body.expense.created_at);
 const before=r.body.expense.updated_at;
 r=await api({action:'updateExpense',...input,amount:4500,updated_at:before,category:'tools'},'staff_manager');assert.equal(r.status,200);assert.equal(r.body.expense.created_by_staff_id,'owner');
 r=await api({action:'listExpenses',start:'2026-10-04',end:'2026-10-04'},'100');assert.equal(r.status,200);assert.equal(r.body.expenses.length,1);assert.equal(r.body.expenses[0].amount,4500);assert.equal(r.body.categories.length,13);
 assert.equal((await api({action:'listExpenses',start:'2026-10-05',end:'2026-10-31'},'100')).body.expenses.length,0);
 assert.equal((await api({action:'deleteExpense',id,updated_at:db.tables.finance_expenses[0].updated_at},'100')).status,200);assert.equal(db.tables.finance_expenses.length,0);assert.deepEqual(db.tables.orders,orders);
});
for(const role of ['master','dispatcher'])test(`${role} has no expense read/write access even with forged permission`,async()=>{
 const db=fixture(),api=edge('mini-app-api',db);
 for(const action of ['listExpenses','createExpense','updateExpense','deleteExpense'])assert.equal((await api({action,...input,role:'owner',can_view_finance:true,permissions:{can_view_finance:true}},'staff_'+role)).status,403);
 assert.equal(db.calls.filter(c=>c.table==='finance_expenses').length,0);
});
test('expense validates amount, calendar date, category and comment before persistence',async()=>{
 const db=fixture(),api=edge('mini-app-api',db);
 for(const patch of [{amount:0},{amount:-1},{amount:1.001},{amount:'Infinity'},{amount:'1e3'},{amount:true},{amount:1000000000},{expense_date:'2026-02-30'},{expense_date:'2026-10-04T12:00:00Z'},{category:'bad'},{category:'x'.repeat(100)},{comment:'x'.repeat(501)},{category:'other',comment:' '}])assert.equal((await api({action:'createExpense',...input,...patch},'100')).status,400,JSON.stringify(patch));
 assert.equal((await api({action:'listExpenses',start:'2026-10-05',end:'2026-10-04'},'100')).status,400);
 assert.equal(db.tables.finance_expenses.length,0);
});
test('same request retry creates one expense; stale edits and deletes are rejected',async()=>{
 const db=fixture(),api=edge('mini-app-api',db);
 const r=await api({action:'createExpense',...input},'100');assert.equal(r.status,200);
 assert.equal((await api({action:'createExpense',...input},'100')).status,200);assert.equal(db.tables.finance_expenses.length,1);
 assert.equal((await api({action:'createExpense',...input,amount:999},'100')).status,409);
 for(const action of ['updateExpense','deleteExpense'])assert.equal((await api({action,...input,updated_at:'2020-01-01T00:00:00Z'},'100')).status,409);
 assert.equal(db.tables.finance_expenses[0].amount,15000.25);
});
test('expense selection, category sums and net profit do not invent unknown income',()=>{
 const E=require('../finance-expenses.js');
 const rows=[{id:'1',expense_date:'2026-10-04',amount:10.10,category:'avito',city:'Москва'},{id:'2',expense_date:'2026-10-05',amount:20.20,category:'avito',order_id:'17'},{id:'3',expense_date:'2026-09-04',amount:100,category:'tools'}];
 const chosen=E.select(rows,{period:{start:'2026-10-01',end:'2026-10-31'}});assert.equal(chosen.length,2);
 assert.equal(E.summary(chosen,100).expenses,30.30);assert.equal(E.summary(chosen,100).net,69.70);assert.equal(E.summary(chosen,null).net,null);assert.equal(E.summary(chosen,0).net,-30.30);assert.deepEqual(E.summary(chosen,100).categories.map(c=>[c.key,c.amount]),[['avito',30.30]]);
 const orders=[{id:'17',city:'Москва',master:'m',source:'Авито',works:[{key:'w'}],workKnown:true}];
 assert.deepEqual(E.select(rows,{source:'Авито'},orders).map(x=>x.id),['2']);assert.equal(E.select(rows,{city:'Москва'},orders).length,2);
});
