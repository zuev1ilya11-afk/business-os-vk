const {test}=require('node:test');const assert=require('node:assert/strict');const {workbook,headers}=require('./helpers/lemana-xlsx.cjs');
function libs(){require('../vendor/lemana-xlsx.js');return {X:globalThis.BOS_XLSX,L:require('../lemana-import.js')}}
test('XLSX header mapping retains identifiers and explicit timezone without UTC guessing',()=>{
 const {X,L}=libs();const parsed=X.read(workbook());assert.equal(parsed.rows[0]['Номер заказа'].value,'00042');
 assert.throws(()=>L.preview(parsed,[],[],''),/часовой пояс/i);
 const out=L.preview(parsed,[],[{id:'m',full_name:'Тестовый мастер',role:'master',is_active:true}],'Europe/Moscow');
 const r=out.rows[0];assert.equal(r.kind,'new');assert.equal(r.order.order_number,'00042');assert.equal(r.order.created_at,'2026-10-20T07:30:00.000Z');assert.equal(r.order.scheduled_date,'2026-10-21');assert.equal(r.order.scheduled_time,'12:00:00');assert.equal(r.order.work,'');assert.equal(r.order.work_items,undefined);assert.equal(r.order.original_amount,1000);
});
test('XLSX rejects formulas, relationships, missing headers and oversized input',()=>{
 const {X}=libs();assert.throws(()=>X.read(workbook([[{formula:'HYPERLINK("https://example.invalid")'}]])),/формул/i);
 assert.throws(()=>X.read(workbook([], {files:{'xl/_rels/sheet.xml.rels':'<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>'}})),/внешн/i);
 assert.throws(()=>X.read(workbook([],{headers:['Номер заказа']})),/столбц/i);
 assert.throws(()=>X.read(new Uint8Array(5*1024*1024+1)),/размер/i);
});
test('cross-source numbers, duplicate file rows, missing data, unknown status/master are blocked',()=>{
 const {X,L}=libs();const row=['001','Тест','+79990000001','Тест','Категория',500,'20.10.2026 10:30','','','','Подтвержден',''];
 const parsed=X.read(workbook([row,[...row.slice(0,10),'Неизвестно','']]));
 const duplicate=L.preview(parsed,[],[],'Europe/Moscow');assert.ok(duplicate.rows.every(r=>r.kind==='error'));
 const p=X.read(workbook([row]));assert.equal(L.preview(p,[{source:'Телефон',order_number:'001'}],[],'Europe/Moscow').rows[0].kind,'possible');
 assert.equal(L.preview(p,[{source:'Лемана Про',order_number:'001'}],[],'Europe/Moscow').rows[0].kind,'existing');
 row[2]='';assert.equal(L.preview(X.read(workbook([row])),[],[],'Europe/Moscow').rows[0].kind,'error');
});

test('actual ZIP expansion cannot bypass limits by forged uncompressed sizes',()=>{
 const {X}=libs();const data=workbook(undefined,{files:{'junk.xml':'<a/>'+' '.repeat(21*1024*1024)}});
 // Forge both local and central uncompressed sizes. The compressed stream is unchanged.
 const v=new DataView(data.buffer,data.byteOffset,data.byteLength);
 for(let p=0;p<data.length-46;p++){
  const sig=v.getUint32(p,true);if(sig!==0x04034b50&&sig!==0x02014b50)continue;
  const central=sig===0x02014b50,head=central?46:30,len=v.getUint16(p+(central?28:26),true);
  if(new TextDecoder().decode(data.subarray(p+head,p+head+len))==='junk.xml')v.setUint32(p+(central?24:22),4,true);
 }
 assert.throws(()=>X.read(data),/размер|большой/i);
});

test('headers can move and extra columns are ignored; numeric identifiers/dates retain their meaning',()=>{
 const {X,L}=libs(),base=['00009','Тест','+79990000001','Тест','Категория',500,'20.10.2026 10:30','','','','Подтвержден',''];
 const reordered=X.read(workbook([['Дополнение','Ещё','','',...base.slice().reverse()]],{headers:['Неизвестный столбец','Неизвестный столбец','','',...headers.slice().reverse()]}));
 assert.equal(L.preview(reordered,[],[],'UTC').rows[0].order.created_at,'2026-10-20T10:30:00.000Z');assert.equal(reordered.rows[0]['Номер заказа'].value,'00009');
 assert.equal(L.identifier({value:'42',kind:'number',format:'00000'}),'00042');
 assert.equal(L.localDate({value:'1.5',kind:'number'},true).local,'1904-01-02 12:00:00');
 assert.throws(()=>L.localDate({value:'60',kind:'number'}),/дата/i);
 assert.throws(()=>L.localDate({value:'31.02.2026',kind:'text'}),/дата/i);
});

test('export timestamps preserve milliseconds and the explicitly selected timezone',()=>{
 const {X,L}=libs();
 for(const [text,fraction] of [['2026-01-02T00:30:05.123','123'],['2026-01-02T00:30:05.1','100'],['02.01.2026 00:30:05.01','010'],['2026-01-02T00:30:05.000','000']]){
  const local=L.localDate({value:text,kind:'text'});
  assert.equal(local.local,'2026-01-02 00:30:05.'+fraction);
  assert.equal(L.instant(local,'Europe/Moscow'),'2026-01-01T21:30:05.'+fraction+'Z');
  assert.equal(L.instant(local,'UTC'),'2026-01-02T00:30:05.'+fraction+'Z');
 }
 const row=['fraction-001','Синтетический клиент','+79990000001','Тестовый адрес','Категория',500,'2026-01-02T00:30:05.123','2026-01-03T12:00:00.250','2026-01-04T12:00:00.987','','Подтвержден',''];
 const out=L.preview(X.read(workbook([row])),[],[],'Europe/Moscow').rows[0];
 assert.equal(out.kind,'new');assert.equal(out.order.created_at,'2026-01-01T21:30:05.123Z');assert.equal(out.order.received_date,'2026-01-02');
 assert.equal(out.order.scheduled_time,'12:00:00.250');assert.equal(out.dates.scheduled,'2026-01-03 12:00:00.250');
 assert.equal(out.order.lemana_import_meta.reported_completed_at,'2026-01-04T09:00:00.987Z');
});

test('invalid export dates name the column and never silently discard a timezone or precision',()=>{
 const {X,L}=libs(),row=['date-001','Синтетический клиент','+79990000001','Тестовый адрес','Категория',500,'2026-01-02T10:30:00.123','','','','Подтвержден',''];
 for(const [column,name] of [[6,'Дата создания заказа'],[7,'Назначенная дата'],[8,'Дата выполнения']]){
  const input=row.slice();input[column]='2026-02-30T10:30:00.123';const out=L.preview(X.read(workbook([input])),[],[],'Europe/Moscow').rows[0];
  assert.equal(out.kind,'error');assert.ok(out.reason.startsWith(name+': '));assert.equal(out.order,null);
 }
 for(const value of ['2026-01-02T10:30:00.123Z','2026-01-02T10:30:00.123+03:00','2026-01-02T10:30:00.1234','2026-01-02T10:30.123','2026-01-02T24:30:00.123'])assert.throws(()=>L.localDate({value,kind:'text'}),/Дата|дата/);
});
