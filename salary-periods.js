(function(root){
'use strict';
const ZONE='Europe/Moscow';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
function day(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  const parts=Object.fromEntries(dayFormat.formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function valid(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value))&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value}
function addDays(value,count){const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10)}
function bounds(kind,value=day()){
  if(!valid(value))throw new Error('Некорректная дата периода');
  const d=new Date(`${value}T12:00:00Z`);
  if(kind==='day')return {start:value,end:value};
  if(kind==='month')return {start:value.slice(0,8)+'01',end:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10)};
  const start=addDays(value,-((d.getUTCDay()+6)%7));
  return {start,end:addDays(start,6)};
}
function shift(kind,value,amount){
  const p=bounds(kind,value);
  if(kind!=='month')return addDays(p.start,amount*(kind==='day'?1:7));
  const d=new Date(`${p.start}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+amount);return d.toISOString().slice(0,10);
}
function completedDay(order){
  for(const value of [order?.completed_at,order?.report_reviewed_at]){if(value){const result=day(value);if(result)return result}}
  const fallback=String(order?.scheduled_date||'').slice(0,10);return valid(fallback)?fallback:'';
}
function contains(period,value){return !!value&&value>=period.start&&value<=period.end}
function nextMidnight(now=Date.now()){return Date.parse(`${addDays(day(now),1)}T00:00:00+03:00`)}
const api={ZONE,day,valid,addDays,bounds,shift,completedDay,contains,nextMidnight};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_SALARY_PERIODS=api;
})(globalThis);
