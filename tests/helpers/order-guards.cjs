// Behavioral fixture for the production triggers captured in
// 20260929160000_capture_live_order_guards.sql. CI executes those SQL definitions
// in PostgreSQL as well; this helper is not a substitute for that integration.
function orderGuards(old,patch){
 const next={...old,...patch},has=k=>Object.prototype.hasOwnProperty.call(patch,k);
 if(has('status')||has('report_review_status')){
  const rejected=next.report_review_status==='rejected'&&old.report_review_status!=='rejected';
  if(next.status==='Выполнена'&&old.status!=='Выполнена'){
   if(!next.report_uploaded_at||!String(next.report_act_url||'').trim()||!String(next.report_photo_urls||'').trim()||next.report_photo_urls==='[]')throw new Error('REPORT_REQUIRED_BEFORE_COMPLETION');
   if(next.report_type==='measurement'&&!String(next.report_measurement_url||'').trim())throw new Error('MEASUREMENT_REPORT_REQUIRED');
  }
  if(next.status==='В работе'&&(old.status!=='В работе'||rejected)){
   next.master_workflow_stage='assigned';
   for(const k of ['master_called_at','master_agreed_at','master_departed_at','master_arrived_at','master_started_at','completed_at','report_type','report_act_url','report_measurement_url','report_uploaded_at','report_upload_token','report_archive_url','drive_archive_folder_id','drive_archive_url','drive_archive_error','drive_archived_at'])next[k]=null;
   next.report_photo_urls='[]';next.drive_archive_status='pending';
   if(!rejected){next.report_review_status='not_submitted';next.report_reviewed_by=null;next.report_reviewed_at=null;next.report_review_comment=''}
  }
  if(next.status!=='Выполнена'){
   next.completed_at=null;
   if(old.status==='Выполнена'||next.report_review_status==='approved'){next.report_review_status=next.report_uploaded_at?'pending':'not_submitted';next.report_reviewed_by=null;next.report_reviewed_at=null;next.report_review_comment=''}
  }
 }
 if(['status','master_payout','manager_payout','dispatcher_payout'].some(has)&&next.status==='Отменена')next.master_payout=next.manager_payout=next.dispatcher_payout=0;
 next.updated_at=new Date().toISOString();return next;
}
module.exports={orderGuards};
