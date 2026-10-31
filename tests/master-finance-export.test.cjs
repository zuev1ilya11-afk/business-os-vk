const {test}=require('node:test'),assert=require('node:assert/strict');
const X=require('../finance-export-data.js');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
const {edge,database,employee}=require('./helpers/edge.cjs');
const {unzipSync,strFromU8}=require('fflate');

test('master statement contains one master, completed orders and only shareable columns',()=>{
 const f=fixture();
 const s=X.snapshot(f.orders,f.staff,f.expenses,{...f.filters,master:'m',format:'master'});
 const sheets=X.sheets(s),rows=[...sheets[0].rows()];
 assert.equal(sheets.length,1);
 assert.deepEqual(sheets[0].columns.map(c=>c.name),['Дата выполнения','№ заявки','Источник','Адрес','Работы','Начислено мастеру']);
 assert.equal(rows.length,4);
 assert.equal(s.total.pay,2987);
 assert.equal(rows.reduce((sum,r)=>sum+r[5],0),2987);
 assert.match(rows[0][4],/Монтаж — 2 шт\./);
 assert.match(rows[1][4],/Дополнительно: Дополнительный крепёж/);
 assert.match(rows[2][4],/Не выполнено: Подрезка — 1 пил\./);
 assert.equal(rows[0][1],'00001');
 const visible=JSON.stringify(sheets.map(sheet=>({columns:sheet.columns,head:sheet.preamble,rows:[...sheet.rows()]})));
 for(const secret of ['+70000000000','Тестовый клиент','synthetic-report','Второй мастер','Прибыль','Доля компании','Внутренний ID'])assert.ok(!visible.includes(secret),secret);
 assert.match(s.filename,/Тестовый мастер/);
});
test('master statement requires an explicit single master and honours combined filters',()=>{
 const f=fixture();
 for(const filters of [{format:'master'},{format:'bad'},{format:'master',master:'m',selected:'n'},{format:'master',master:'unassigned'}])assert.throws(()=>X.filters(filters));
 const s=X.snapshot(f.orders,f.staff,f.expenses,{...f.filters,selected:'n',format:'master',source:'Лемана Про',city:'Санкт-Петербург'});
 assert.deepEqual(s.rows.map(r=>r.id),['4']);assert.equal(s.total.pay,552.5);
 const empty=X.snapshot(f.orders,f.staff,f.expenses,{...f.filters,master:'m',format:'master',source:'Лемана Про'});
 assert.equal(empty.rows.length,0);assert.equal(empty.expenses.length,0);
});
test('authenticated compact export streams one sheet and binds revision to its format',async()=>{
 const f=fixture(),db=database({orders:f.orders,finance_expenses:f.expenses,business_staff:[employee('owner','owner'),employee('master'),employee('dispatcher','dispatcher'),...f.staff]});
 const api=edge('mini-app-api',db),filters={...f.filters,selected:'m',format:'master'};
 const p=await api({action:'previewFinanceExport',filters});
 assert.equal(p.status,200);assert.equal(p.body.count,4);assert.equal(p.body.total.pay,2987);
 const file=await api({action:'downloadFinanceExport',filters,revision:p.body.revision});
 assert.equal(file.status,200);
 const zip=unzipSync(file.body),workbook=strFromU8(zip['xl/workbook.xml']),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.equal(Object.keys(zip).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length,1);
 assert.match(workbook,/Начисления/);assert.match(sheet,/>2987</);assert.match(sheet,/ySplit="6"/);assert.match(sheet,/autoFilter ref="A6:F10"/);
 for(const secret of ['+70000000000','Тестовый клиент','synthetic-report','Прибыль','Второй мастер'])assert.ok(!sheet.includes(secret));
 assert.equal((await api({action:'downloadFinanceExport',filters:{...filters,format:'full'},revision:p.body.revision})).status,409);
 for(const role of ['master','dispatcher'])assert.equal((await api({action:'previewFinanceExport',filters},'staff_'+role)).status,403);
 assert.equal(db.calls.filter(c=>c.mode!=='select'&&c.table).length,0);
});
