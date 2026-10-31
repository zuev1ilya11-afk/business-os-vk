const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,token}=require('./helpers/edge.cjs');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
const {unzipSync,strFromU8}=require('fflate');
const setup=()=>{const f=fixture();const db=database({orders:f.orders,finance_expenses:f.expenses,business_staff:[...['owner','manager','master','dispatcher'].map(r=>employee(r,r)),...f.staff]});return {f,db,api:edge('mini-app-api',db)}};
for(const role of ['owner','manager'])test(`${role} previews and downloads financial XLSX using authenticated server values`,async()=>{
 const {f,db,api}=setup(),before=structuredClone(db.tables),uid=role==='owner'?'100':'staff_manager';
 const preview=await api({action:'previewFinanceExport',filters:f.filters},uid);
 assert.equal(preview.status,200);assert.equal(preview.body.count,7);assert.equal(preview.body.total.net,2310.5);assert.ok(preview.body.revision);
 const file=await api({action:'downloadFinanceExport',filters:f.filters,revision:preview.body.revision,orders:[{amount:999999}]},uid);
 assert.equal(file.status,200);assert.match(file.headers['content-type'],/spreadsheetml/);assert.match(file.headers['content-disposition'],/business-os-finance-2026-10-01_2026-10-31.xlsx/);
 assert.match(file.headers['cache-control'],/no-store/);
 const entries=unzipSync(file.body);assert.ok(strFromU8(entries['xl/worksheets/sheet1.xml']).includes('2310.5'));
 assert.deepEqual(db.tables,before);
 const orderQueries=db.calls.filter(c=>c.table==='orders');assert.ok(orderQueries.every(c=>c.columns!=='*'&&!/photo|act_url|password/.test(c.columns)));
});
for(const role of ['master','dispatcher'])test(`${role} cannot preview/download even with forged UI permissions`,async()=>{
 const {f,db,api}=setup();
 for(const action of ['previewFinanceExport','downloadFinanceExport'])assert.equal((await api({action,filters:f.filters,role:'owner',permissions:{can_view_finance:true},revision:'forged'},'staff_'+role)).status,403);
 assert.equal(db.calls.filter(c=>['orders','finance_expenses'].includes(c.table)).length,0);
});
test('missing, forged, expired and inactive sessions cannot obtain export data',async()=>{
 const {f,db,api}=setup();
 for(const session of ['',token('100').slice(0,-3)+'bad',token('100',1)])assert.equal((await api({action:'previewFinanceExport',filters:f.filters},'100',session)).status,401);
 db.tables.business_staff.find(s=>s.id==='owner').is_active=false;
 assert.equal((await api({action:'previewFinanceExport',filters:f.filters})).status,401);
});
test('empty periods return no file; expenses-only periods remain exportable',async()=>{
 const {f,db,api}=setup();
 let r=await api({action:'previewFinanceExport',filters:{period:{start:'2027-01-01',end:'2027-01-01'}}});assert.equal(r.status,200);assert.equal(r.body.empty,true);
 assert.equal((await api({action:'downloadFinanceExport',filters:{period:{start:'2027-01-01',end:'2027-01-01'}},revision:r.body.revision})).status,422);
 db.tables.orders=[];r=await api({action:'previewFinanceExport',filters:f.filters});assert.equal(r.body.empty,false);assert.equal(r.body.expenseCount,2);
});
test('changed or missing revision and stale UI totals prevent a misleading download',async()=>{
 const {f,db,api}=setup();const r=await api({action:'previewFinanceExport',filters:f.filters});
 assert.equal((await api({action:'downloadFinanceExport',filters:f.filters})).status,409);
 db.tables.orders[0].amount=1234;
 assert.equal((await api({action:'downloadFinanceExport',filters:f.filters,revision:r.body.revision})).status,409);
 assert.equal((await api({action:'previewFinanceExport',filters:f.filters,expected:{total:7,completed:5,revenue:6000,pay:3539.5,company:2460.5,expenses:150,net:2310.5}})).status,409);
});
test('invalid filters and database errors return sanitized errors with no internal address',async()=>{
 const {api,db}=setup();assert.equal((await api({action:'previewFinanceExport',filters:{status:'Выполнена'}})).status,400);
 db.beforeQuery=(table)=>{if(table==='orders')throw Error('SQL secret-token https://private.invalid')};
 const r=await api({action:'previewFinanceExport',filters:{}});assert.equal(r.status,500);assert.ok(!JSON.stringify(r.body).includes('private.invalid'));assert.ok(!JSON.stringify(r.body).includes('secret-token'));
});
test('export pagination reads past 1000 without losing orders',async()=>{
 const {f,db,api}=setup();db.tables.orders=Array.from({length:1005},(_,i)=>({...f.orders[0],id:String(i+1),master_payout:0}));
 const r=await api({action:'previewFinanceExport',filters:f.filters});assert.equal(r.body.count,1005);assert.equal(r.body.total.revenue,1005000);assert.equal(r.body.total.pay,0);
});
test('authentication lookup failures also suppress internal errors for export requests',async()=>{
 const {db,api}=setup();db.beforeQuery=()=>{throw Error('credential SECRET SQL internal-host')};
 const result=await api({action:'previewFinanceExport',filters:{}});assert.equal(result.status,500);assert.ok(!JSON.stringify(result.body).includes('SECRET'));
});
test('legacy master_id participates in server selection just as it does in the Finance page',async()=>{
 const {f,db,api}=setup();db.tables.orders=[{...f.orders[0],master_staff_id:null,master_id:'m',master_name:'Старое имя'}];
 const result=await api({action:'previewFinanceExport',filters:{...f.filters,master:'m'},expected:{total:1,completed:1,revenue:1000,pay:600,company:400,expenses:50,net:350}});
 assert.equal(result.status,200);assert.equal(result.body.count,1);
});
