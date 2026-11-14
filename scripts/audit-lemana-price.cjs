// Read-only comparison with the original workbook. Does not import orders or write files.
const fs=require('node:fs'),crypto=require('node:crypto');
const {unzipSync,strFromU8}=require('fflate');
const {XMLParser}=require('fast-xml-parser');
const expected=require('../data/lemana-price-2026-11-11.json');
const filename=process.argv[2];
if(!filename)throw Error('Pass the original price XLSX path');
const bytes=fs.readFileSync(filename),zip=unzipSync(bytes);
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
const list=v=>v==null?[]:Array.isArray(v)?v:[v];
const text=v=>typeof v==='string'?v:v?text(v.t??v['#text']??'')+list(v.r).map(text).join(''):'';
const strings=list(parser.parse(strFromU8(zip['xl/sharedStrings.xml'])).sst.si).map(text);
const sheet=parser.parse(strFromU8(zip['xl/worksheets/sheet1.xml'])).worksheet,cells={};
for(const row of list(sheet.sheetData.row))for(const c of list(row.c)){
 if(c.f!==undefined)throw Error('Unexpected formula in source price workbook');
 if(c.v!==undefined||c.is)cells[c['@_r']]=c['@_t']==='s'?strings[Number(c.v)]:c['@_t']==='inlineStr'?text(c.is):Number(c.v);
}
const clean=v=>String(v??'').trim().replace(/\s+/g,' ');
const semantic=v=>clean(v).replace(/\s/g,'');
const mismatches=[],spacingOnly=[];
for(const item of expected.services){
 const [start,end]=item.sourceRange.match(/\d+/g).map(Number);
 if(item.p!==cells['C'+start])mismatches.push({id:item.id,field:'price'});
 const units=[...new Set(Array.from({length:end-start+1},(_,i)=>clean(cells['B'+(start+i)])).filter(Boolean))];
 if(units.length>1||(units[0]||'')!==item.u)mismatches.push({id:item.id,field:'unit'});
 const sourceName=clean(cells['A'+start]);
 const sourceNote=Array.from({length:end-start},(_,i)=>clean(cells['A'+(start+i+1)])).filter(Boolean).join('\n');
 for(const [field,source] of [['n',sourceName],['note',sourceNote]]){
  if(semantic(item[field])!==semantic(source))mismatches.push({id:item.id,field});
  else if(clean(item[field])!==clean(source))spacingOnly.push({id:item.id,field});
 }
}
const numericRows=Object.entries(cells).filter(([k,v])=>/^C\d+$/.test(k)&&typeof v==='number').length;
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const result={sha256,sourceHashMatches:sha256===expected.source.sha256,numericPriceRows:numericRows,catalogRows:expected.services.length,pricesAndUnitsMatch:!mismatches.some(x=>['price','unit'].includes(x.field)),mismatches,spacingOnly};
console.log(JSON.stringify(result,null,2));
if(!result.sourceHashMatches||numericRows!==expected.services.length||mismatches.length)process.exitCode=1;
