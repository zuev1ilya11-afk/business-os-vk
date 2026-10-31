import { projections, workbook } from './finance-export-models.mjs';
import { readClaimFinancialSnapshots, withClaimFinancialSnapshot } from './claim-finance.ts';

type ExportRow=Record<string,unknown>;
interface ExportQuery extends PromiseLike<{data:ExportRow[]|null;error:unknown}>{
 order(column:string):ExportQuery;
 range(from:number,to:number):ExportQuery;
 gte(column:string,value:string):ExportQuery;
 lte(column:string,value:string):ExportQuery;
}
interface ExportDatabase{from(table:string):{select(columns:string):ExportQuery}}
interface ExportFilters{period:{start:string;end:string};format:string}
interface ExportSnapshot{
 rows:{id:string;order:ExportRow}[];
 unresolved:{id:string}[];
 allMap:Map<string,{order:ExportRow}>;
 claims:ExportRow[]|null;
 expenses:ExportRow[];
 total:Record<string,unknown>;
 period:{start:string;end:string};
 filename:string;
}
interface ExportSheet{rows():Iterable<unknown[]>}
interface ExportGlobals{
 BOS_FINANCE_EXPORT_DATA:{filters(input:unknown):ExportFilters;snapshot(orders:ExportRow[],staff:ExportRow[],expenses:ExportRow[],filters:ExportFilters,claims?:ExportRow[]):ExportSnapshot;sheets(snapshot:ExportSnapshot):ExportSheet[]};
 BOS_FINANCE_XLSX:{stream(sheets:ExportSheet[]):ReadableStream<Uint8Array>};
}
const EXPORT_ERROR='Не удалось сформировать финансовую детализацию. Повторите попытку.';
// Explicit projection: never read photo arrays, signed attachment URLs, raw provider payloads or credentials.
const EXPORT_ORDER_COLUMNS='id,order_number,external_id,external_source,source,created_at,received_date,master_agreed_at,scheduled_date,completed_at,report_reviewed_at,status,is_claim,client,phone,address,city,master_staff_id,master_id,master_name,amount,original_amount,extra_work_amount,extra_work_description,uncompleted_work_amount,uncompleted_work_description,uncompleted_work_items,master_payout,comment,report_upload_token,report_review_status,report_uploaded_at,manual_completion_history,work,work_items';
const EXPORT_STAFF_COLUMNS='id,external_id,full_name,role,is_active,city';
const EXPORT_EXPENSE_COLUMNS='id,expense_date,category,comment,amount,order_id,employee_id,city,created_by_name,created_at,updated_at';
async function exportRows(query:ExportQuery){
 const rows:ExportRow[]=[];
 for(let offset=0;;offset+=1000){
  const page=await query.range(offset,offset+999);
  if(page.error)throw page.error;
  rows.push(...(page.data||[]));
  if(rows.length>50000)throw Error('EXPORT_LIMIT');
  if((page.data||[]).length<1000)return rows;
 }
}
export async function financeExport(db:ExportDatabase,body:Record<string,unknown>,me:{is_active?:boolean;role?:string}|null,cors:Record<string,string>){
 const headers={...cors,'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(!me||!me.is_active)return json({ok:false,error:'Доступ не подтверждён'},401);
 if(!['owner','manager'].includes(me.role||''))return json({ok:false,error:'Недостаточно прав для просмотра финансов'},403);
 const X=projections as ExportGlobals['BOS_FINANCE_EXPORT_DATA'],W=workbook as ExportGlobals['BOS_FINANCE_XLSX'];
 let filters:ExportFilters;
 try{filters=X.filters(body.filters)}catch{return json({ok:false,error:'Некорректные фильтры выгрузки',code:'INVALID_FILTERS'},400)}
 try{
  let eq=db.from('finance_expenses').select(EXPORT_EXPENSE_COLUMNS).order('id');
  if(filters.period.start)eq=eq.gte('expense_date',filters.period.start).lte('expense_date',filters.period.end);
  // Keep the same date fallback/master/source rules as the UI. Filter in the shared projection,
  // rather than SQL approximations that lose completed-at fallbacks or expenses on older orders.
  let cq=db.from('order_claims').select('id,order_id,master_staff_id,opened_at').order('id');
  if(filters.period.start)cq=cq.gte('opened_at',filters.period.start+'T00:00:00+03:00').lte('opened_at',filters.period.end+'T23:59:59.999999+03:00');
  const [staff,expenses,claims,financialSnapshots]=await Promise.all([
   exportRows(db.from('business_staff').select(EXPORT_STAFF_COLUMNS).order('id')),
   filters.format==='master'?Promise.resolve([]):exportRows(eq),
   filters.format==='master'?Promise.resolve([]):exportRows(cq),
   readClaimFinancialSnapshots(db),
  ]);
  const linked=new Set(expenses.filter(e=>e.order_id).map(e=>String(e.order_id))),orders:ExportRow[]=[];
  for(let offset=0;;offset+=1000){
   const page=await db.from('orders').select(EXPORT_ORDER_COLUMNS).order('id').range(offset,offset+999);
   if(page.error)throw page.error;
   const data=(page.data||[]).map(o=>withClaimFinancialSnapshot(o,financialSnapshots)),pageSnapshot=X.snapshot(data,staff,[],filters),selected=new Set([...pageSnapshot.rows,...pageSnapshot.unresolved].map(r=>r.id));
   orders.push(...data.filter(o=>selected.has(String(o.id))||linked.has(String(o.id))));
   if(orders.length>50000)throw Error('EXPORT_LIMIT');
   if(data.length<1000)break;
  }
  const s=X.snapshot(orders,staff,expenses,filters,claims),empty=!s.rows.length&&!s.expenses.length;
  if(filters.format==='master'&&s.unresolved.length)return json({ok:false,error:'По рекламациям не восстановлено исходное начисление. Обратитесь к руководителю.',code:'CLAIM_HISTORY_REQUIRED'},409);
  if(body.expected){
   const keys=['total','completed','revenue','pay','company','expenses','net'];
   const expected=body.expected as Record<string,unknown>;
   if(keys.some(k=>expected[k]!==s.total[k]))return json({ok:false,error:'Данные изменились. Обновите раздел «Финансы» и повторите скачивание.',code:'STALE_VIEW'},409);
  }
  const serialized=JSON.stringify({filters,orders:s.rows.map(r=>r.order).sort((a,b)=>String(a.id).localeCompare(String(b.id))),unresolved:s.unresolved.map(r=>r.id).sort(),staff,claims:s.claims,expenses:s.expenses,links:s.expenses.map(e=>s.allMap.get(String(e.order_id))?.order||null)});
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
  const revision=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  if(body.action==='previewFinanceExport')return json({ok:true,empty,count:s.rows.length,expenseCount:s.expenses.length,period:s.period,allTime:!filters.period.start,filename:s.filename,total:s.total,revision});
  if(empty)return json({ok:false,error:'За выбранный период данных для выгрузки нет',code:'EMPTY_EXPORT'},422);
  if(body.revision!==revision)return json({ok:false,error:'Данные изменились. Повторите подготовку детализации.',code:'STALE_EXPORT'},409);
  const sheets=X.sheets(s);
  // Check the expensive sheet before sending headers; never send a silently truncated workbook.
  let workRows=0;for(const _row of sheets[filters.format==='master'?0:2].rows())if(++workRows>250000)throw Error('EXPORT_LIMIT');
  const disposition=filters.format==='master'?`attachment; filename="business-os-master-${s.period.start}_${s.period.end}.xlsx"; filename*=UTF-8''${encodeURIComponent(s.filename)}`:`attachment; filename="${s.filename}"`;
  return new Response(W.stream(sheets),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':disposition,'Access-Control-Expose-Headers':'Content-Disposition'}});
 }catch(error){
  const limit=error instanceof Error&&error.message==='EXPORT_LIMIT';
  // Only structured diagnostics. Never log customer fields, tokens, SQL or upstream error messages.
  console.error('finance-export',{code:limit?'EXPORT_LIMIT':'EXPORT_FAILED',errorType:error instanceof Error?error.name:'DatabaseError'});
  return json({ok:false,error:limit?'Слишком большой объём данных. Выберите меньший период.':EXPORT_ERROR,code:limit?'EXPORT_LIMIT':'EXPORT_FAILED'},limit?413:500);
 }
}
