"""Probe unchanged gateway routing and existing authentication, without a session."""
import json
import sys
import subprocess
import backend as b

PROBE=r'''
import json,sys,urllib.request,urllib.error
d=json.load(sys.stdin)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
okay=True
for action in ['help_list','help_save','list']:
 req=urllib.request.Request(d['base']+'/functions/v1/master-memo-api',data=json.dumps({'action':action}).encode(),headers={'Content-Type':'application/json'},method='POST')
 try:
  try:r=opener.open(req,timeout=4)
  except urllib.error.HTTPError as e:r=e
  with r:
   body=json.loads(r.read(8192));okay=okay and r.status==401 and body.get('error')=='Доступ не подтверждён'
 except Exception:okay=False
print(json.dumps(okay))
'''

def probe(rec,*,pid=None,public=False,cors=True,readonly=False):
    args=[sys.executable,'-c',PROBE]
    if not public:args=['nsenter','-t',str(pid),'-n',*args]
    payload=json.dumps({'base':b.ORIGIN if public else 'http://127.0.0.1:9000'}).encode()
    if readonly:
        try:output=subprocess.run(args,input=payload,capture_output=True,timeout=20,check=True).stdout
        except (OSError,subprocess.SubprocessError):return False
    else:output=b.private_command(args,'public-auth-probe' if public else 'private-auth-probe',timeout=20,input_data=payload)
    return json.loads(output) is True


def probe_readonly(rec,**kwargs):return probe(rec,readonly=True,**kwargs)
