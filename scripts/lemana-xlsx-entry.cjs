// Build with scripts/build-lemana-xlsx.cjs. Server-only, no network or formula engine.
const {unzipSync,Unzip,UnzipInflate,strFromU8}=require('fflate');
const {XMLParser}=require('fast-xml-parser');
const MAX_FILE=5*1024*1024,MAX_XML=20*1024*1024;
const HEADERS=['Номер заказа','ФИО клиента','Телефон клиента','Адрес клиента','Категория заказа','Стоимость заказа','Дата создания заказа','Назначенная дата','Дата выполнения','ФИ мастера','Статус','Магазин'];
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,parseAttributeValue:false,trimValues:false,removeNSPrefix:true,processEntities:false});
function decode(v){return String(v??'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,entity)=>{const basic={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(basic[entity])return basic[entity];const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):''})}
function txt(v){if(typeof v==='string')return decode(v);if(!v)return '';return txt(v.t??v['#text']??'')+array(v.r).map(txt).join('')}
function read(bytes){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_FILE)throw Error('Недопустимый размер файла. Максимум 5 МБ');
 if(bytes[0]!==80||bytes[1]!==75)throw Error('Выберите файл XLSX');
 let total=0,count=0;const entries=new Map(),files={};
 try{
  // Preflight central directory WITHOUT inflation. Never trust its sizes as the actual limit.
  unzipSync(bytes,{filter:f=>{
   if(++count>256||f.originalSize>MAX_XML||(total+=f.originalSize)>MAX_XML)throw Error('Распакованный файл слишком большой');
   if(entries.has(f.name)||f.name.includes('..')||f.name.startsWith('/'))throw Error('Некорректная структура XLSX');
   if(/externalLinks|vbaProject|\.bin$/i.test(f.name))throw Error('Файл содержит внешние ссылки или макросы');
   entries.set(f.name,f.originalSize);return false;
  }});
  let actualTotal=0,finished=0;const opened=new Set();
  const stream=new Unzip(file=>{
   if(!entries.has(file.name)||opened.has(file.name))throw Error('Некорректная структура XLSX');opened.add(file.name);
   let actual=0;const chunks=[],keep=/\.(xml|rels)$/i.test(file.name);
   file.ondata=(error,data,final)=>{
    if(error)throw error;actual+=data.length;actualTotal+=data.length;
    if(actual>entries.get(file.name)||actualTotal>MAX_XML){file.terminate();throw Error('Распакованный файл слишком большой или размер повреждён')}
    if(keep)chunks.push(data);
    if(final){if(actual!==entries.get(file.name))throw Error('Размер файла XLSX повреждён');finished++;
     if(keep){const out=new Uint8Array(actual);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}files[file.name]=out}
    }
   };file.start();
  });stream.register(UnzipInflate);
  // Small compressed chunks bound each inflation allocation; count real output before continuing.
  for(let at=0;at<bytes.length;at+=1024)stream.push(bytes.subarray(at,at+1024),at+1024>=bytes.length);
  if(finished!==entries.size)throw Error('Неполный файл XLSX');
 }catch(e){throw Error(e.message||'Не удалось прочитать XLSX')}
 function xml(name){const bytes=files[name];if(!bytes)throw Error('Некорректный XLSX: отсутствует '+name);const s=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY|<\s*(?:\w+:)?f(?:\s|>|\/)/i.test(s))throw Error('Формулы и объявления сущностей в XLSX не поддерживаются');return parser.parse(s,true)}
 // Inspect all XML, including unused sheets; never load external references.
 for(const name of Object.keys(files)){const obj=xml(name);if(name.endsWith('.rels')&&array(obj.Relationships?.Relationship).some(r=>String(r['@TargetMode']).toLowerCase()==='external'))throw Error('Внешние ссылки в XLSX не поддерживаются')}
 const book=xml('xl/workbook.xml').workbook,rels=array(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
 const sheet=array(book?.sheets?.sheet).find(s=>decode(s['@name'])==='Tasks');if(!sheet)throw Error('В книге нет листа Tasks');
 const rel=rels.find(r=>r['@Id']===sheet['@id']);if(!rel)throw Error('Не найден лист Tasks');const target=String(rel['@Target']);
 const sheetPath=target.startsWith('/xl/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target;
 const shared=files['xl/sharedStrings.xml']?array(xml('xl/sharedStrings.xml').sst?.si).map(txt):[];
 const styles=files['xl/styles.xml']?xml('xl/styles.xml').styleSheet:{};
 const fmts=new Map(array(styles?.numFmts?.numFmt).map(f=>[String(f['@numFmtId']),decode(f['@formatCode'])]));
 const xfs=array(styles?.cellXfs?.xf);
 const rows=array(xml(sheetPath).worksheet?.sheetData?.row);if(rows.length>1001)throw Error('В одном файле допускается не более 1000 строк');
 function cell(c){
  const kind=c['@t']||'n',formatId=String(xfs[Number(c['@s']||0)]?.['@numFmtId']||'0'),format=fmts.get(formatId)||'';
  const raw=kind==='inlineStr'?txt(c.is):kind==='s'?shared[Number(c.v)]??'':decode(c.v??'');
  return {value:raw,kind:kind==='n'?'number':'text',format,date:([14,15,16,17,18,19,20,21,22,45,46,47].includes(Number(formatId))||/[dy]/i.test(format.replace(/"[^"]*"|\\./g,'')))};
 }
 function cells(row){const out=new Map();for(const c of array(row.c)){const match=/^([A-Z]{1,3})\d+$/.exec(c['@r']||'');if(!match)throw Error('Некорректный адрес ячейки');let index=0;for(const ch of match[1])index=index*26+ch.charCodeAt(0)-64;if(index>256)throw Error('Слишком много столбцов');if(out.has(index-1))throw Error('Повторяющаяся ячейка');out.set(index-1,cell(c))}return out}
 const header=cells(rows[0]||{}),map=new Map();for(const [index,c] of header){const name=c.value.trim();if(!HEADERS.includes(name))continue;if(map.has(name))throw Error('Повторяется заголовок столбца: '+name);map.set(name,index)}
 const missing=HEADERS.filter(h=>!map.has(h));if(missing.length)throw Error('Отсутствуют столбцы: '+missing.join(', '));
 return {date1904:['1','true'].includes(String(book?.workbookPr?.['@date1904'])),rows:rows.slice(1).map((r,i)=>{const values=cells(r),out={_row:i+2};for(const h of HEADERS)out[h]=values.get(map.get(h))||{value:'',kind:'text'};return out}).filter(r=>HEADERS.some(h=>r[h].value!==''))};
}
globalThis.BOS_XLSX={read,MAX_FILE,HEADERS};
