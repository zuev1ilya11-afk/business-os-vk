// Temporary feature-branch generator. Removed before the production PR is merged.
const fs=require('node:fs');
function replace(file,from,to){let s=fs.readFileSync(file,'utf8');if(s.includes(to))return;if(s.split(from).length!==2)throw Error('Unexpected source: '+file);fs.writeFileSync(file,s.replace(from,to));}
replace('supabase/functions/push-api/index.ts',"const VERSION='web-push-v211';","const VERSION='web-push-v211-control-v2';");
replace('supabase/functions/push-api/index.ts',"report_pending:'Отчёт ожидает проверки',test:","report_pending:'Отчёт ожидает проверки',control_due:'Наступил срок поручения по заявке',test:");
replace('supabase/functions/push-api/index.ts',"['status','subscribe','test'].includes(action)","['status','subscribe','test','controlList','controlSave','controlClear'].includes(action)");
replace('supabase/functions/push-api/index.ts',"    const cfg=await config(db);\n    if(!cfg.enabled)","    if(['controlList','controlSave','controlClear'].includes(action)){\n      if(action!=='controlList'&&actor.role==='master')return json(req,{ok:false,error:'Назначения меняет диспетчер или руководитель.'},403);\n      const result=await rpc(db,'bos_control_action',{p_actor:actor.id,p_action:action,p_input:body});\n      return json(req,result,result?.ok?200:([400,403,404,409].includes(result?.status)?result.status:500));\n    }\n    const cfg=await config(db);\n    if(!cfg.enabled)");
replace('pwa-register.js',"    './web-push-v211.js',","    './web-push-v211.js',\n    './order-control-tasks.js',");
replace('.github/workflows/ui-smoke.yml','          bash scripts/test-hands-reports.sh','          bash scripts/test-hands-reports.sh\n          bash scripts/test-control-tasks.sh');
const migration='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_order_control_tasks_v2.sql'));
const marker='-- Ordinary business push behavior is unchanged; control reminders get at most one network attempt.';
if(!fs.readFileSync(migration,'utf8').includes(marker)){
 const base=fs.readFileSync('supabase/migrations/20260929163737_web_push_v211.sql','utf8');
 let s=base.slice(base.indexOf('create or replace function public.bos_push_claim()'),base.indexOf('create or replace function bos_push_private.maintenance()'));
 s=s.replace("attempts>=5 and coalesce(locked_until,'-infinity')<now()","(attempts>=5 or (event_type='control_due' and attempts>=1)) and coalesce(locked_until,'-infinity')<now()");
 s=s.replace('where expires_at>now() and attempts<5 and',"where expires_at>now() and attempts<5 and (event_type<>'control_due' or attempts=0) and");
 s=s.replace('when p_retry and attempts<5 and expires_at>now()',"when p_retry and d.event_type<>'control_due' and attempts<5 and expires_at>now()");
 s=s.replace("and ((d.event_type='test'","and ((d.event_type='control_due' and exists(select 1 from bos_control_private.tasks t where t.reminder_event=d.event_id and t.assignee_id=b.id and t.order_id=d.order_id and t.remind and t.due_at<=now() and bos_control_private.current_task(t)) and exists(select 1 from bos_control_private.runtime where enabled))\n      or (d.event_type='test'");
 fs.appendFileSync(migration,'\n'+marker+'\n'+s);
}
