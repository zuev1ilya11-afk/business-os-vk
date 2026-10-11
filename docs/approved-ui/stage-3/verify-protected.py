"""Byte comparisons against accepted Stage 2, excluding presentation templates."""
from pathlib import Path
import subprocess,hashlib,json,os
BASE=os.environ.get('BOS_PROTECTED_BASE','cd3bf9232a6ac632cb8da151aa32a0b2b478361e')
root=Path.cwd(); checks=[]
def fragment(text,start,end):
 a=text.index(start) if start else 0
 return text[a:text.index(end,a+len(start or '')) if end else len(text)]
def compare(file,label,start=None,end=None):
 old=subprocess.check_output(['git','show',BASE+':'+file],text=True);new=(root/file).read_text();a=fragment(old,start,end);b=fragment(new,start,end)
 checks.append({'file':file,'label':label,'from':start,'until':end,'unchanged':a==b,'sha256':hashlib.sha256(b.encode()).hexdigest()})
for file,label,start,end in [
 ('dispatcher-workspace-v6.js','staff/role/payroll helpers',None,'function attentionButton'),
 ('dispatcher-attention-v123.js','existing attention/conflict predicates and decorators',None,'// Shared queue view'),
 ('dispatcher-mobile-dispatch-v107.js','operational eligibility/range/conflict/helpers','function dispatcherMode','function orderCard'),
 ('dispatcher-mobile-dispatch-v107.js','original day/order cards and status/actions','function orderCard','// Presentation uses only explicit saved ranges.'),
 ('dispatcher-mobile-dispatch-v107.js','original date navigation and operational fallback actions','window.dmDispatchSetDay=','const baseDispatch='),
 ('dispatcher-smart-assign-v119.js','candidate eligibility/ranking/date/duration contract',None,'function renderMobileModal'),
 ('dispatcher-smart-assign-v119.js','assignment handler/payload','async function assignMobile','window.openDispatcherSmartAssign119'),
 ('dispatcher-smart-assign-v119.js','original late form/card decorators','window.openDispatcherSmartAssign119',None),
 ('dispatcher-free-slots-v120.js','availability/ranges/master guards',None,'function panelHtml'),
 ('dispatcher-free-slots-v120.js','existing date/slot listeners','function bindPanel','function ensurePanel'),
 ('dispatcher-free-slots-v120.js','existing panel reconciliation and assignment payload','function renderPanel','pages.opsFreeSlots='),
 ('dispatcher-reschedule-v91.js','guards and API helper',None,'window.openDispatcherReschedule='),
 ('dispatcher-reschedule-v91.js','reschedule submit/payload/failure','  const form=document.getElementById',None),
 ('management-order-compact-v82.js','master/management guard and readonly helpers',None,'window.openOrder='),
 ('management-order-compact-v82.js','saveQuickOrder existing handler/payload','window.saveQuickOrder=',None),
 ('staff-permissions-calendar-v43.js','role, permissions and original calendar functions',None,'// Presentation-only saved visit selection;'),
 ('staff-permissions-calendar-v43.js','original employee disable action/payload','window.disableStaffProfile=','if(typeof pages!'),
 ('staff-permissions-calendar-v43.js','original employee admin actions','const box=document.createElement','window.disableStaffProfile='),
 ('unified-schedule-v102.js','master helpers/timeline/month/editor/cancel',None,'function pageHtml'),
 ('unified-schedule-v102.js','master presentation branch',"return masterView==='month'?",'function render'),
 ('unified-schedule-v102.js','master editor events/presets and management selection','function render','let opsMonthMaster='),
 ('unified-schedule-v102.js','master save payload/failure and original wrappers','const monday=',None),
 ('dispatcher-report-patch.js','report data, pay and period helpers',None,'function dispatcherReportHtml'),
 ('dispatcher-report-patch.js','report period actions and print handler','function showDispatcherReport',None),
 ('order-filters-v22.js','original filter setters and refresh','window.setBosOrderFilter=',None),
 ('new-order-card-v104.js','field node/listener helpers',None,'function enhanceNewOrderForm'),
]:
 # A source-side new declaration is the end boundary; original ends immediately before it.
 if file in ['dispatcher-free-slots-v120.js','unified-schedule-v102.js','dispatcher-mobile-dispatch-v107.js','dispatcher-attention-v123.js','staff-permissions-calendar-v43.js'] and end in ['pages.opsFreeSlots=','let opsMonthMaster=','// Presentation uses only explicit saved ranges.','// Shared queue view','// Presentation-only saved visit selection;']:
  old=subprocess.check_output(['git','show',BASE+':'+file],text=True)
  old_end={'pages.opsFreeSlots=':'window.renderDispatcherFreeSlots120=','let opsMonthMaster=':"document.addEventListener('click'",'// Presentation uses only explicit saved ranges.':'function pageHtml','// Shared queue view':'const style=','// Presentation-only saved visit selection;':'const baseEmployeeProfile='}[end]
  new=(root/file).read_text();a=fragment(old,start,old_end);b=fragment(new,start,end);checks.append({'file':file,'label':label,'from':start,'until':old_end,'unchanged':a==b,'sha256':hashlib.sha256(b.encode()).hexdigest()})
 else:compare(file,label,start,end)
whole=['schedule-contract.js','dispatcher-permissions.js','android-navigation-v112.js','order-create-fields-patch.js','dispatcher-order-workflow-v114.js','dispatcher-orders-v3.js','dispatcher-responsive-workbench-v157.js','order-payroll.js','finance-patch.js','finance-data.js','salary-periods.js','order-lifecycle-v106.js','master-order-actions-v179.js','report-review-patch.js','report-review-runtime-v30.js','report-supabase-patch.js','report-chunk-upload-v23.js','hands-integration-v69.js','avito-messages-v25.js','auth-api-session-v41.js','mandatory-auth-v29.js','manager-preview-v28.js','profile-logout-v96.js']
tracked=subprocess.check_output(['git','ls-files'],text=True).splitlines()
whole+= [p for p in tracked if p.startswith('supabase/')]
for file in whole:compare(file,'entire protected file')
output=root/'docs/approved-ui/stage-3/protected-handlers.json';output.write_text(json.dumps({'base':BASE,'checks':checks},ensure_ascii=False,indent=2)+'\n')
fail=[x for x in checks if not x['unchanged']];print(f'{len(checks)} protected comparisons; {len(fail)} changed')
for x in fail:print(x['file'],x['label'])
raise SystemExit(bool(fail))
