// Entirely synthetic OOXML. Never load the user's example in automated tests.
const {zipSync,strToU8}=require('fflate');
const headers=['Номер заказа','ФИО клиента','Телефон клиента','Адрес клиента','Категория заказа','Стоимость заказа','Дата создания заказа','Назначенная дата','Дата выполнения','ФИ мастера','Статус','Магазин'];
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const col=i=>i<26?String.fromCharCode(65+i):'A'+String.fromCharCode(65+i-26);
function workbook(rows=[['00042','Синтетический клиент','+79990000001','Тестовый адрес','Тестовая категория',1000,'20.10.2026 10:30','21.10.2026 12:00','','Тестовый мастер','Назначена дата','Тестовый магазин']],opts={}){
 const hs=opts.headers||headers;
 const xml=[hs,...rows].map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>`<c r="${col(c)}${r+1}"${typeof v==='number'?'':' t="inlineStr"'}>${v?.formula?'<f>'+escape(v.formula)+'</f><v>1</v>':typeof v==='number'?'<v>'+v+'</v>':'<is><t>'+escape(v??'')+'</t></is>'}</c>`).join('')}</row>`).join('');
 const files={'[Content_Types].xml':'<Types/>','xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+xml+'</sheetData></worksheet>',...(opts.files||{})};
 return zipSync(Object.fromEntries(Object.entries(files).map(([n,x])=>[n,strToU8(x)])));
}
module.exports={workbook,headers};
