#!/usr/bin/env python3
"""Read-only GAS transport checks on the user's VPS. Never activates a release."""
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, build_opener

ACTIVATE_SHA = '42d71a8b41072b383787f7fe8abccbc3b9a6121d363cdbb9d4d7b0b8f6b95059'
HOSTS = ('script.google.com','script.googleusercontent.com')


def emit(label,value):
    print(label+'='+json.dumps(value,separators=(',',':')),flush=True)


def error_info(error):
    inner = error.reason if isinstance(error,URLError) and isinstance(error.reason,BaseException) else error
    result = {'type':type(inner).__name__}
    number = getattr(inner,'errno',None)
    if isinstance(number,int):
        result['errno'] = number
    code = getattr(inner,'verify_code',None)
    if isinstance(code,int):
        result['certificate_code'] = code
    reason = getattr(inner,'reason',None)
    if isinstance(reason,str) and re.fullmatch(r'[A-Z0-9_]{1,80}',reason):
        result['tls_reason'] = reason
    return result


class TraceHTTPS(HTTPSHandler):
    def https_open(self,req):
        host = urlsplit(req.full_url).hostname
        if host not in HOSTS:
            raise RuntimeError('UNEXPECTED_GAS_HOST')
        emit('GAS_HOP_START',{'host':host,'method':req.get_method()})
        try:
            response = super().https_open(req)
        except Exception as error:
            emit('GAS_HOP_ERROR',{'host':host,**error_info(error)})
            raise
        emit('GAS_HOP_HTTP',{'host':host,'status':response.status})
        return response


def trace_opener(*handlers):
    return build_opener(*handlers,TraceHTTPS())


def network_checks():
    emit('PROXY_ENV_PRESENT',any(os.environ.get(k) for k in ('HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy')))
    emit('TRANSPORT_MODE','direct-with-certificate-verification')
    for host in HOSTS:
        try:
            answers = socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            emit('GAS_DNS',{'host':host,'ipv4':len({x[4][0] for x in answers if x[0]==socket.AF_INET}),
                            'ipv6':len({x[4][0] for x in answers if x[0]==socket.AF_INET6})})
        except OSError as error:
            emit('GAS_DNS',{'host':host,**error_info(error)})
        for family in ('4','6'):
            try:
                result = subprocess.run(['curl','-q','--noproxy','*','-'+family,'--head','--silent',
                    '--output','/dev/null','--connect-timeout','6','--max-time','12',
                    '--write-out','%{http_code} %{time_connect} %{time_appconnect}',
                    'https://'+host+'/'],capture_output=True,timeout=15)
                fields = result.stdout.decode(errors='replace').strip().split()
                report = {'host':host,'family':family,'curl_exit':result.returncode}
                if len(fields)==3 and all(re.fullmatch(r'[0-9.]{1,20}',x) for x in fields):
                    report.update(http=fields[0],tcp_seconds=fields[1],tls_seconds=fields[2])
                emit('GAS_TLS',report)
            except Exception as error:
                emit('GAS_TLS',{'host':host,'family':family,**error_info(error)})


def main():
    import hashlib
    sys.dont_write_bytecode = True
    path = Path('/tmp/bos-activate.py')
    if path.resolve()!=path or hashlib.sha256(path.read_bytes()).hexdigest()!=ACTIVATE_SHA:
        raise RuntimeError('ACTIVATION_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_gas_activation',path)
    app = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app)
    app.s,app.v,app.r = app.load_helpers()
    journals = list(app.s.PARENT.glob('report-acceptance-stage-*/locked-*/runtime-*/runtime-journal.json'))
    app.require(bool(journals),'SUCCESSFUL_RUNTIME_JOURNAL_MISSING')
    journal = max(journals,key=lambda p:p.stat().st_mtime_ns)
    record = json.loads(app.s.read(journal))
    edge = app.s.inspect(record['edge_id'])
    app.require(edge['Image']==record['image'] and edge['State']['Running'],'EDGE_CHANGED')
    config = json.loads(app.s.read(journal.parent/'candidate/edge/main/bos-report-env.json'))
    app.require(config['gas']==app.GAS,'GAS_ENDPOINT_CHANGED')
    sync = app.v.environment(edge).get('BOS_SYNC_KEY','')
    app.require(bool(sync),'SIGNING_KEY_MISSING')
    emit('CHECK_ONLY',True)
    network_checks()
    app.build_opener = trace_opener
    original_request = app.request
    def traced_request(*args,**kwargs):
        try:
            return original_request(*args,**kwargs)
        except Exception as error:
            emit('GAS_RESPONSE_ERROR',error_info(error))
            raise
    app.request = traced_request
    try:
        app.verify_gas(sync)
    except Exception as error:
        label = str(error)
        emit('GAS_SIGNED_CHECK',label if re.fullmatch(r'[A-Z_]{1,100}',label) else 'FAILED')
    else:
        emit('GAS_SIGNED_CHECK','PASSED')
    emit('DIAGNOSTICS_COMPLETE',True)
    emit('PRODUCTION_UPDATED',False)


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        label = str(error)
        emit('GAS_DIAGNOSTICS_STOPPED',label if isinstance(error,RuntimeError) and re.fullmatch(r'[A-Z_]{1,100}',label) else 'CHECK_UNAVAILABLE')
        raise SystemExit(1)
