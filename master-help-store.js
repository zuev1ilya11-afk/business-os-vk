(()=>{
'use strict';
const initial=structuredClone(window.BOS_MASTER_HELP_DATA),kinds=['lessons','talk','faq','problems'];
let rows=[],canEdit=false,identity='',authStamp='',notice='',loadSequence=0;
const userKey=()=>String(typeof state!=='undefined'?(state.user?.id||state.user?.external_id||''):'');
const cacheKey=()=> 'bos_shared_help_v1:'+userKey();
const clone=x=>structuredClone(x);
const assemble=items=>{const d={...clone(initial)};for(const k of kinds)d[k]=items.filter(r=>r.kind===k).map(r=>clone(r.content));return d};
function validRows(items){return Array.isArray(items)&&items.every(r=>r&&kinds.includes(r.kind)&&r.content?.id===r.id&&Number.isInteger(r.version)&&r.version>0)}
function cache(){if(identity&&identity===userKey())try{localStorage.setItem(cacheKey(),JSON.stringify({items:rows}))}catch(_){}}
async function credentials(){const h=await window.BOS_AUTH_HEADERS?.()||{};const headers=new Headers(h);headers.set('Content-Type','application/json');return headers}
const stamp=h=>JSON.stringify(['x-bos-session','x-vk-launch-params'].map(k=>h.get(k)||''));
async function call(body,headers){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  // The RU app serves this route on its own origin. Never fall back to old cloud services.
  const response=await fetch('/functions/v1/master-memo-api',{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:controller.signal,bosReconcileBeforeRetry:true});
  const result=await response.json();
  if(!response.ok||!result.ok){const e=new Error(result.error||'Не удалось получить подтверждение сервера');e.code=result.code;e.status=response.status;throw e}
  return result;
 }catch(e){if(e.status)throw e;throw new Error('Нет подтверждения сервера. Проверьте соединение. Введённый текст сохранён в форме; повторите сохранение после восстановления связи.')}
 finally{clearTimeout(timer)}
}
window.BOS_HELP_STORE={
 get canEdit(){return canEdit&&identity===userKey()},get notice(){return notice},
 get data(){return assemble(rows)},get(id){return clone(rows.find(r=>r.id===id))},
 async load(){
  const sequence=++loadSequence;
  canEdit=false;identity=userKey();rows=[];notice='';
  const who=identity,headers=await credentials();
  if(sequence!==loadSequence)return this.data;
  authStamp=stamp(headers);
  try{
   const r=await call({action:'help_list'},headers);
   if(sequence!==loadSequence)return this.data;
   if(who!==userKey())throw Error('Пользователь изменился. Откройте подсказки заново.');
   if(!validRows(r.items)||r.items.length===0)throw Error('Общее хранилище подсказок ещё не подготовлено.');
   rows=r.items;canEdit=r.can_edit===true;cache();
  }catch(e){
   if(sequence!==loadSequence)return this.data;
   canEdit=false;
   if(who!==userKey()){rows=[];throw e}
   if(e.status===401||e.status===403){notice='Доступ не подтверждён. Войдите в приложение заново.';try{localStorage.removeItem(cacheKey())}catch(_){};}
   else{try{const saved=JSON.parse(localStorage.getItem(cacheKey()));if(validRows(saved?.items))rows=saved.items}catch(_){}notice=rows.length?'Показана ранее загруженная версия. Сохранение недоступно до подключения к серверу.':'Общие подсказки недоступны. Показана начальная версия для чтения.';}
   if(!rows.length)for(const k of kinds)for(const x of initial[k])rows.push({id:x.id,kind:k,content:clone(x),version:0});
  }
  return this.data;
 },
 async latest(id){
  const who=userKey(),headers=await credentials(),r=await call({action:'help_list'},headers);
  if(who!==userKey()||stamp(headers)!==authStamp)throw Error('Сеанс изменился. Откройте подсказки заново.');
  if(!validRows(r.items))throw Error('Не удалось проверить актуальную версию.');
  return clone(r.items.find(row=>row.id===id));
 },
 async save(item){
  if(!this.canEdit)throw Error('Редактирование недоступно. Откройте подсказки заново.');
  const headers=await credentials();if(stamp(headers)!==authStamp)throw Error('Сеанс изменился. Скопируйте текст и откройте подсказки заново.');
  const who=identity,r=await call({action:'help_save',id:item.id,kind:item.kind,version:item.version,content:item.content},headers);
  if(who!==userKey())throw Error('Сеанс изменился. Проверьте сохранённый результат после входа.');
  if(!validRows([r.item]))throw Error('Не удалось проверить ответ сервера. Текст оставлен в форме.');
  const index=rows.findIndex(x=>x.id===r.item.id);if(index<0)rows.push(r.item);else rows[index]=r.item;cache();return clone(r.item);
 }
};
})();
