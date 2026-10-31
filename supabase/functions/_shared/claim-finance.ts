type ClaimFinancialOrder=Record<string,unknown>;
interface ClaimFinancialQuery extends PromiseLike<{data:ClaimFinancialOrder[]|null;error:unknown}>{
 order(column:string):ClaimFinancialQuery;
 range(from:number,to:number):ClaimFinancialQuery;
}
interface ClaimFinancialDatabase{from(table:string):{select(columns:string):ClaimFinancialQuery}}

export async function readClaimFinancialSnapshots(db:ClaimFinancialDatabase){
 const map=new Map<string,ClaimFinancialOrder>();
 for(let offset=0;;offset+=1000){
  const q=await db.from('order_financial_snapshots').select('order_id,financial_data').order('order_id').range(offset,offset+999);
  if(q.error)throw q.error;
  const rows=q.data||[];
  for(const row of rows){
   const value=row.financial_data;
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_FINANCIAL_SNAPSHOT');
   const order=value as ClaimFinancialOrder;
   if(String(order.id)!==String(row.order_id)||order.status!=='Выполнена')throw Error('INVALID_FINANCIAL_SNAPSHOT');
   map.set(String(row.order_id),order);
  }
  if(map.size>50000)throw Error('EXPORT_LIMIT');
  if(rows.length<1000)return map;
 }
}

export function withClaimFinancialSnapshot(order:ClaimFinancialOrder,snapshots:Map<string,ClaimFinancialOrder>,masterIds?:string[]):ClaimFinancialOrder{
 const result:ClaimFinancialOrder={...order,financial_snapshot:undefined,financial_snapshot_status:undefined};
 const snapshot=snapshots.get(String(order.id));
 if(!snapshot)return result;
 if(!masterIds){result.financial_snapshot=snapshot;return result}
 if(![snapshot.master_staff_id,snapshot.master_id].some(id=>id!==null&&id!==undefined&&masterIds.includes(String(id)))){
  result.financial_snapshot_status='other_master';return result;
 }
 // A master can see their saved pay but never the company's historical cost,
 // other-role payroll, comments or original report identifiers.
 const allowed=['id','status','completed_at','report_reviewed_at','scheduled_date','source','external_source','external_id','order_number','master_staff_id','master_id','master_name','address','city','work','master_payout','extra_work_amount','extra_work_description','uncompleted_work_amount','uncompleted_work_description'];
 result.financial_snapshot=Object.fromEntries(allowed.filter(key=>Object.hasOwn(snapshot,key)).map(key=>[key,snapshot[key]]));
 return result;
}
