(()=>{
'use strict';
// Exact appointment data is independent of the visual grid's 30-minute cells.
function minutes(value,end=false){
  const m=String(value??'').trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?$/);
  if(!m)return null;const h=Number(m[1]),n=Number(m[2]);
  return h<24?h*60+n:end&&h===24&&n===0&&Number(m[3]||0)===0&&Number(m[4]||0)===0?1440:null;
}
function format(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`}
function range(order){
  const raw=String(order?.time_slot||'').trim(),parts=raw.split(/\s*[–—-]\s*/),a=minutes(parts[0]),b=parts.length===2?minutes(parts[1],true):null;
  const start=minutes(order?.scheduled_time)??a;if(start===null)return null;
  const duration=parts.length===2&&a!==null&&b!==null&&b>a?b-a:60;
  return {start,end:start+duration,duration};
}
function timeOf(order){const r=range(order);return r?format(r.start):''}
function move(order,time){const start=minutes(time),duration=range(order)?.duration||60;if(start===null||start+duration>1440)return null;return `${format(start)}–${format(start+duration)}`}
const masterIds=m=>[m?.id,m?.staff_id,m?.master_staff_id,m?.master_id,m?.vk_user_id,m?.external_id,m?.user_id].filter(v=>v!==undefined&&v!==null&&String(v).trim()).map(String);
// Order.id and order.external_id are order identifiers, never master aliases.
const orderIds=o=>[o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(v=>v!==undefined&&v!==null&&String(v).trim()).map(String);
function sameMaster(master,order){const ids=orderIds(order);if(ids.length)return masterIds(master).some(id=>ids.includes(id));const name=String(order?.master_name||'').trim();return !!name&&name===String(master?.full_name||master?.name||'').trim()}
function masterKey(order,masters=[]){
  const ids=orderIds(order),matches=masters.filter(m=>sameMaster(m,order));
  if(matches.length===1)return `staff:${masterIds(matches[0])[0]}`;
  if(ids.length)return `alias:${ids[0]}`;
  const name=String(order?.master_name||'').trim();return name?`name:${name}`:'';
}
window.BOS_SCHEDULE_CONTRACT={minutes,format,range,timeOf,move,masterIds,orderIds,sameMaster,masterKey};
})();
