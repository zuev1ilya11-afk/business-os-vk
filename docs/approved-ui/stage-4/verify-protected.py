"""Byte checks of protected logic against accepted dispatcher + merged main."""
from pathlib import Path
import subprocess,hashlib,json
BASE='12f4472962c342e64ada480b855e50bfe052cad5'
root=Path.cwd(); checks=[]
def part(s,start,end):
 a=s.index(start) if start else 0
 return s[a:s.index(end,a+len(start or '')) if end else len(s)]
def check(file,label,start=None,end=None):
 old=subprocess.check_output(['git','show',BASE+':'+file],text=True);new=(root/file).read_text()
 a,b=part(old,start,end),part(new,start,end)
 checks.append(dict(file=file,label=label,unchanged=a==b,sha256=hashlib.sha256(b.encode()).hexdigest()))
for args in [
 ('finance-page.js','expense request/loading/actor guards',' function resetExpenses',' function expenseContent'),
 ('finance-page.js','expense submit/delete payloads and validation',' function expenseSaved',' function select'),
 ('finance-page.js','sorting calculations',' function sorted',' function masterTable'),
 ('finance-page.js','all existing financial navigation/filter/form handlers',' pages.finance=render;',None),
 ('owner-dashboard-v9.js','role guards and dashboard financial/load snapshot',None,'function metric'),
 ('owner-dashboard-v9.js','calendar calculations','})(typeof window',None),
 ('owner-dashboard-v9.js','refresh and data reconciliation','function refreshDay',None),
 ('order-control.js','identity/permissions/filter classification',None,'  function render'),
 ('order-control.js','original action handlers and all collection algorithms','  function refresh',None),
 ('report-review-patch.js','signed act viewer/intake header/snapshot and review guards',None,'  window.openReportReview='),
 ('report-review-patch.js','original approve/reject validation/finalization payload','  window.submitReportReview=',None),
 ('report-review-runtime-v30.js','review permissions and extra/uncompleted enrichment',None,'  const openReview='),
 ('report-review-runtime-v30.js','original queue decorators','  const home=',None),
 ('staff-permissions-calendar-v43.js','role capability guards and calendar functions',None,'// Presentation-only'),
 ('staff-permissions-calendar-v43.js','employee admin actions/payload','const box=document.createElement','window.disableStaffProfile='),
 ('staff-permissions-calendar-v43.js','disable profile and original team guards','window.disableStaffProfile=',None),
 ('employee-profile-patch.js','employee data/payroll helpers',None,'function openEmployeeProfile'),
 ('team-roles-fix-v31.js','role guards',None,'function teamCard'),
 ('team-roles-fix-v31.js','credential policy and preview handlers','function syncCredentialPolicy',None),
]:check(*args)
# All other source files touched by previous stages and all server/database code stay byte identical.
whole=['order-control-tasks.js','schedule-contract.js','dispatcher-permissions.js','order-payroll.js','finance-data.js','finance-expenses.js','finance-patch.js','salary-periods.js','order-lifecycle-v106.js','management-order-delete-v100.js','management-order-compact-v82.js','owner-calendar-team-v10.js','dispatcher-mobile-dispatch-v107.js','dispatcher-smart-assign-v119.js','dispatcher-free-slots-v120.js','dispatcher-reschedule-v91.js','unified-schedule-v102.js','report-supabase-patch.js','report-chunk-upload-v23.js','auth-api-session-v41.js','mandatory-auth-v29.js','auth-ui-patch.js','manager-preview-v28.js','profile-logout-v96.js','staff-invite-ui-v66.js','hands-integration-v69.js','avito-messages-v25.js']
tracked=subprocess.check_output(['git','ls-files'],text=True).splitlines()
for f in whole:
 if f in tracked:check(f,'entire protected file')
for f in tracked:
 if f.startswith('supabase/'):check(f,'entire server/database file')
output=root/'docs/approved-ui/stage-4/protected-handlers.json'
output.write_text(json.dumps(dict(base=BASE,checks=checks),ensure_ascii=False,indent=2)+'\n')
fail=[x for x in checks if not x['unchanged']]
print(f'{len(checks)} protected comparisons; {len(fail)} changed')
for x in fail:print(x['file'],x['label'])
raise SystemExit(bool(fail))
