(()=>{
'use strict';
if(window.BOS_SCHEDULE_SAVE_HOTFIX_V69)return;
window.BOS_SCHEDULE_SAVE_HOTFIX_V69=true;
const baseSave=window.saveMasterCalendarMonth;
if(typeof baseSave!=='function')return;
window.saveMasterCalendarMonth=async function(){
  const result=await baseSave.apply(this,arguments);
  try{window.BOS_NORMALIZE_MASTER_SCHEDULE?.()}catch(_){ }
  try{window.renderMonthCalendar?.()}catch(_){ }
  return result;
};
})();
