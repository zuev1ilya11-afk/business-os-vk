// Traversal only: callers retain their existing auth, filters and import rules.
export async function syncHandsPages(body:any,status:string,fetchPage:(query:URLSearchParams)=>Promise<any>,importRow:(row:any)=>Promise<any>){
  const perPage=Math.min(500,Math.max(1,Number(body.per_page||500)));
  const maxPages=Math.min(10,Math.max(1,Number(body.max_pages||4)));
  if(!Number.isInteger(perPage)||!Number.isInteger(maxPages))throw new Error('HANDS_SYNC_ARGUMENTS_INVALID');
  let seen=0,created=0,updated=0,pages=0,failed=0,received=0,more=false;
  const reasons=new Set<string>();
  for(let page=1;page<=maxPages;page++){
    const query=new URLSearchParams({page:String(page),per_page:String(perPage)});
    if(status)query.set('status',status);
    for(const key of ['date_from','date_to','search'])if(body[key])query.set(key,String(body[key]).trim());
    const data=await fetchPage(query);
    let rows:any[]=Array.isArray(data)?data:[];
    if(!Array.isArray(data)){
      const key=['results','orders','items','data'].find(key=>Array.isArray(data?.[key]));
      if(!key)throw new Error('HANDS_RESPONSE_INVALID');
      rows=data[key];
    }
    const metadata=(key:string,min:number):number|null=>{
      if(Array.isArray(data)||data[key]===undefined)return null;
      const value=data[key];
      if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw new Error('HANDS_RESPONSE_INVALID');
      return value;
    };
    const current=metadata('page',1),size=metadata('per_page',1)??perPage;
    const last=metadata('pages',0),total=metadata('total',0);
    if((current!==null&&current!==page)||(last!==null&&last<page&&!(last===0&&page===1&&rows.length===0)))throw new Error('HANDS_RESPONSE_INVALID');
    if(!rows.length&&((last!==null&&last>page)||(total!==null&&total>0)))throw new Error('HANDS_RESPONSE_INVALID');
    received+=rows.length;
    if(total!==null&&(received>total||(last!==null&&page>=last&&received<total)))throw new Error('HANDS_RESPONSE_INVALID');
    more=last!==null?page<last:total!==null?received<total:rows.length>=size;
    pages++;
    for(const row of rows){
      try{
        const result=await importRow(row);
        if(!result?.ok){failed++;reasons.add('MISSING_ID');continue}
        seen++;result.created?created++:updated++;
      }catch(error){
        failed++;
        reasons.add(error instanceof Error&&error.message==='ORDER_CHANGED'?'ORDER_CHANGED':'IMPORT_FAILED');
      }
    }
    if(!more)break;
  }
  // Never turn a bounded or partly failed run into the existing UI's "Готово".
  if(failed)throw new Error(`HANDS_IMPORT_PARTIAL: failed=${failed}; saved=${seen}; ${[...reasons].join(',')}${more?'; HANDS_SYNC_INCOMPLETE':''}`);
  if(more)throw new Error(`HANDS_SYNC_INCOMPLETE: pages=${pages}; saved=${seen}`);
  return {seen,created,updated,pages,status};
}
