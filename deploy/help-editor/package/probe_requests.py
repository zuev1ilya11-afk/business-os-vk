"""Executed inside the disposable network namespace, stdin contains test keys only."""
import base64
import concurrent.futures
import copy
import hashlib
import hmac
import json
import sys
import time
import urllib.request
import urllib.error

def run():
    config=json.load(sys.stdin);secret=config['secret'];checks=0
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    def call(role,body,signed=True):
        raw='preview_'+role+'.'+str(int(time.time())+3600)
        token=raw+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),raw.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        request=urllib.request.Request('http://127.0.0.1:9000/functions/v1/master-memo-api',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-BOS-Session':token if signed else 'invalid'},method='POST')
        try:r=opener.open(request,timeout=6)
        except urllib.error.HTTPError as error:r=error
        with r:return r.status,json.loads(r.read(2000000))
    def check(ok,name):
        nonlocal checks
        if not ok:raise AssertionError(name)
        checks+=1
    def listing(role):
        status,data=call(role,{'action':'help_list'})
        check(status==200 and data.get('ok') is True,'read '+role)
        check(data['can_edit']==(role in ['owner','manager']),'permissions '+role)
        return {r['id']:r for r in data['items']}
    if config['phase']=='ready':
        listing('master')
    elif config['phase']=='before':
        original=listing('master');check(len(original)==31,'31 initial materials')
        text=json.dumps(original,ensure_ascii=False)
        check('Как и кому оплачивать?' not in text and 'Можно в следующий раз вызвать вас напрямую?' not in text,'removed FAQ')
        content={'id':'probe-owner','question':'Проверка владельца','answer':'Сохранено','category':'work'}
        create={'action':'help_save','id':content['id'],'kind':'faq','version':0,'content':content}
        check(call('owner',create)[0]==200,'owner create')
        repeat=call('owner',create);check(repeat[0]==200 and repeat[1]['item']['version']==1,'retry idempotent')
        check(call('master',{**create,'role':'owner','previewRole':'owner'})[0]==403,'master direct spoof forbidden')
        check(call('dispatcher',create)[0]==403,'dispatcher forbidden')
        check(call('inactive',create)[0]==403,'inactive owner forbidden')
        check(call('owner',create,False)[0]==401,'invalid signature forbidden')
        check(call('owner',{**create,'id':'probe-empty','content':{**content,'id':'probe-empty','answer':''}})[0]==400,'empty card forbidden')
        for role,kind,item in [
            ('manager','problems',{'id':'probe-manager','title':'Проверка руководителя','actions':['Шаг один','Шаг два']}),
            ('owner','lessons',{'id':'probe-lesson','title':'Новый урок','steps':[{'id':'probe-step','title':'Шаг без картинки','text':'Текст шага'}]}),
            ('manager','talk',{'id':'probe-talk','title':'Новая ситуация','say':'Готовая фраза','actions':['Действие'],'warning':'Примечание'})]:
            check(call(role,{'action':'help_save','id':item['id'],'kind':kind,'version':0,'content':item})[0]==200,role+' creates '+kind)
        lesson=next(r for r in original.values() if r['kind']=='lessons')
        revised=copy.deepcopy(lesson['content']);revised['title']+=' — проверено'
        status,data=call('owner',{'action':'help_save','id':lesson['id'],'kind':'lessons','version':1,'content':revised})
        check(status==200 and data['item']['content']['steps']==lesson['content']['steps'],'existing illustrations and training actions retained')
        edit={**create,'version':1,'content':{**content,'answer':'Редакция руководителя'}}
        check(call('manager',edit)[0]==200,'manager edit')
        pending_edits=[{**create,'version':2,'content':{**content,'answer':'Параллельная правка '+role}} for role in ['owner','manager']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda pair:call(*pair),zip(['owner','manager'],pending_edits)))
        check(sorted(r[0] for r in responses)==[200,409],'atomic concurrent edit conflict')
        check(len(listing('master'))==35,'master sees saved additions')
        listing('owner');listing('manager')
    else:
        rows=listing('master')
        check(len(rows)==35,'no duplicates after restart and reseed')
        check(rows['probe-owner']['version']==3 and rows['probe-owner']['content']['answer'].startswith('Параллельная правка'),'persisted CAS winner')
        check(any(r['kind']=='lessons' and r['version']==2 and r['content']['title'].endswith(' — проверено') for r in rows.values()),'seed preserves edited lesson')
        check(rows['probe-manager']['content']['actions']==['Шаг один','Шаг два'],'manager content survived restart')
        check(rows['probe-lesson']['content']['steps'][0]['text']=='Текст шага','text-only step survived restart')
    print(json.dumps({'ok':True,'checks':checks,'phase':config['phase']}))

if __name__=='__main__':run()
