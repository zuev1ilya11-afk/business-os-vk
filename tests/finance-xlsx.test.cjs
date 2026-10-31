const {test}=require('node:test');
const assert=require('node:assert/strict');
const {unzipSync,strFromU8}=require('fflate');
const {XMLParser,XMLValidator}=require('fast-xml-parser');
const {fixture}=require('./helpers/finance-export-fixture.cjs');
const X=require('../finance-export-data.js');
let W;try{W=require('../supabase/functions/_shared/finance-xlsx.js')}catch{}
test('XLSX writer exposes a byte stream',()=>assert.equal(typeof W?.stream,'function'));
test('download is valid OOXML with typed money/date cells, UTF-8 text, filters and frozen headers',async()=>{
 const f=fixture();f.orders[0].comment='=HYPERLINK("https://test.invalid")\u0001 & <текст>';
 const stream=W.stream(X.sheets(X.snapshot(f.orders,f.staff,f.expenses,f.filters),new Date('2026-10-31T09:00:00Z')));
 const bytes=new Uint8Array(await new Response(stream).arrayBuffer()),files=unzipSync(bytes);
 assert.ok(files['[Content_Types].xml']);assert.ok(files['_rels/.rels']);
 for(const [name,data] of Object.entries(files))assert.equal(XMLValidator.validate(strFromU8(data)),true,name);
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
 const wb=parser.parse(strFromU8(files['xl/workbook.xml']));assert.equal(wb.workbook.sheets.sheet.length,6);
 const xml=strFromU8(files['xl/worksheets/sheet2.xml']),doc=parser.parse(xml).worksheet;
 assert.equal(doc.sheetViews.sheetView.pane['@_state'],'frozen');assert.equal(doc.autoFilter['@_ref'],'A1:AA8');
 const cells=doc.sheetData.row[1].c,cell=ref=>cells.find(c=>c['@_r']===ref);
 assert.equal(cell('B2')['@_t'],'inlineStr');assert.equal(cell('B2').is.t['#text'],'00001');
 assert.equal(cell('D2').v,'46296');assert.equal(cell('D2')['@_s'],'3');
 assert.equal(cell('N2').v,'1000');assert.equal(cell('N2')['@_s'],'2');
 assert.equal(cell('Q2'),undefined);assert.ok(!xml.includes('<f>'));assert.ok(xml.includes('=HYPERLINK'));
 assert.ok(strFromU8(files['xl/styles.xml']).includes('₽'));assert.ok(!xml.includes('\u0001'));
});
test('stream lazily consumes detail rows and cancellation stops generation',async()=>{
 let produced=0;
 const stream=W.stream([{name:'Тест',columns:[{name:'ID',width:20}],rows:function*(){for(let i=0;i<100000;i++){produced++;yield [String(i)]}}}]);
 const reader=stream.getReader();await reader.read();await reader.cancel();assert.ok(produced<1000);
});
test('XML escapes spreadsheet escape sequences literally and does not mutate text into formulas',async()=>{
 const stream=W.stream([{name:'Текст',columns:[{name:'Текст',width:30}],rows:function*(){yield ['_x0041_ +cmd @SUM -12 \u0000'];}}]);
 const files=unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
 const xml=strFromU8(files['xl/worksheets/sheet1.xml']);assert.ok(xml.includes('_x005F_x0041_'));assert.ok(xml.includes('t="inlineStr"'));assert.ok(!xml.includes('<f>'));
});
