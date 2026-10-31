// Minimal streaming OOXML writer for server exports. No formulas, macros or external links.
// ZIP STORE + data descriptors: rows and XML are never assembled as one large string.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_FINANCE_XLSX=api})(globalThis,()=>{
 'use strict';
 const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
 const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const encoder=new TextEncoder();
 // XML 1.0 forbids these characters; strip them from saved user text.
 // deno-lint-ignore no-control-regex
 const escape=v=>String(v).toWellFormed().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const cellText=v=>escape(String(v).slice(0,32767).replace(/_x[0-9a-f]{4}_/gi,m=>'_x005F_'+m.slice(1)));
 function column(i){let name='';for(i++;i;i=Math.floor((i-1)/26))name=String.fromCharCode(65+(i-1)%26)+name;return name}
 function cell(value,ref,type,header=false){
  if(value===null||value===undefined||value==='')return '';
  if(value&&typeof value==='object'){type=value.type;value=value.value}
  const style=header?1:type==='money'?2:type==='date'?3:type==='datetime'?4:0;
  if(type==='date'||type==='datetime'){
   const stamp=Date.parse(type==='date'?value+'T00:00:00Z':value+'Z');
   if(!Number.isFinite(stamp))return '';
   value=(stamp-Date.UTC(1899,11,30))/86400000;
   if(value<61)value-=1;
  }
  if(typeof value==='number')return Number.isFinite(value)?`<c r="${ref}" s="${style}"><v>${value}</v></c>`:'';
  // Explicit inline strings prevent formula injection even for =,+,-,@ prefixes.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`;
 }
 function* worksheet(sheet){
  yield declaration+`<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>`+sheet.columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.width||20}" customWidth="1"/>`).join('')+'</cols><sheetData>';
  yield '<row r="1" ht="42" customHeight="1">'+sheet.columns.map((c,i)=>cell(c.name,column(i)+'1','text',true)).join('')+'</row>';
  let row=1;
  for(const values of sheet.rows()){
   if(++row>1048576)throw Error('XLSX_ROW_LIMIT');
   yield `<row r="${row}">`+sheet.columns.map((c,i)=>cell(values[i],column(i)+row,c.type)).join('')+'</row>';
  }
  yield `</sheetData><autoFilter ref="A1:${column(sheet.columns.length-1)}${row}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
 }
 const styles=declaration+`<styleSheet xmlns="${NS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₽&quot;;[Red]-#,##0.00 &quot;₽&quot;"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243D52"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="center" wrapText="1"/></xf>${[164,165,166].map(id=>`<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 function* entries(sheets){
  yield ['[Content_Types].xml',[declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>']];
  yield ['_rels/.rels',[declaration+`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`]];
  yield ['xl/workbook.xml',[declaration+`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>`+sheets.map((s,i)=>`<sheet name="${escape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>']];
  yield ['xl/_rels/workbook.xml.rels',[declaration+`<Relationships xmlns="${PKG}">`+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`]];
  yield ['xl/styles.xml',[styles]];
  for(const [i,s] of sheets.entries())yield [`xl/worksheets/sheet${i+1}.xml`,worksheet(s)];
 }
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0});
 function crcUpdate(crc,bytes){for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc}
 function header(size,fields){const bytes=new Uint8Array(size),v=new DataView(bytes.buffer);for(const [offset,value,width] of fields)width===2?v.setUint16(offset,value,true):v.setUint32(offset,value,true);return bytes}
 function* chunks(parts){let pending='';for(const part of parts){pending+=part;if(pending.length>=32768){yield encoder.encode(pending);pending=''}}if(pending)yield encoder.encode(pending)}
 function* zip(sheets){
  let offset=0;const central=[];
  for(const [filename,parts] of entries(sheets)){
   const name=encoder.encode(filename),start=offset;let crc=0xffffffff,size=0;
   const local=header(30,[[0,0x04034b50],[4,20,2],[6,0x808,2],[12,33,2],[26,name.length,2]]);
   yield local;yield name;offset+=local.length+name.length;
   for(const data of chunks(parts)){crc=crcUpdate(crc,data);size+=data.length;offset+=data.length;if(offset>128*1024*1024)throw Error('XLSX_SIZE_LIMIT');yield data}
   crc=(crc^0xffffffff)>>>0;
   const desc=header(16,[[0,0x08074b50],[4,crc],[8,size],[12,size]]);yield desc;offset+=16;
   central.push([header(46,[[0,0x02014b50],[4,20,2],[6,20,2],[8,0x808,2],[14,33,2],[16,crc],[20,size],[24,size],[28,name.length,2],[42,start]]),name]);
  }
  const start=offset;
  for(const [record,name] of central){yield record;yield name;offset+=record.length+name.length}
  yield header(22,[[0,0x06054b50],[8,central.length,2],[10,central.length,2],[12,offset-start],[16,start]]);
 }
 function stream(sheets){
  const iterator=zip(sheets);
  return new ReadableStream({pull(controller){try{const next=iterator.next();if(next.done)controller.close();else controller.enqueue(next.value)}catch(error){console.error('finance-export-stream',{code:error?.message==='XLSX_SIZE_LIMIT'?'SIZE_LIMIT':'GENERATION_FAILED'});controller.error(Error('EXPORT_FAILED'));iterator.return()}},cancel(){iterator.return()}});
 }
 return Object.freeze({stream});
});
