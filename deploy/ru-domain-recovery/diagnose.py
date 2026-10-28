#!/usr/bin/env python3
"""Read-only, bounded domain/certificate diagnostics for the known BOS host."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.error import URLError
from urllib.request import urlopen

DOMAIN = 'homemaster.qd.je'
IP = '136.234.17.113'
CONTAINER = 'bos-release-to2wblxf-https'
CONFIG = Path('/opt/business-os/deploy/release-to2wblxf/caddy/Caddyfile')
STAGE = Path('/root/bos-domain-homemaster-20261028')

def safe(value, limit=350):
    value = str(value)
    value = re.sub(r'https?://[^\s\"<>]+', lambda m: m[0].split('?')[0], value)
    value = re.sub(r'(?i)(token|password|secret|authorization|cookie)([\s\"=:]+)[^\s,;]+', r'\1\2[redacted]', value)
    return re.sub(r'\s+', ' ', value)[:limit]

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=20)

def certificate_events(raw):
    events=[]
    for line in raw.splitlines():
        try: event=json.loads(line)
        except (ValueError, TypeError): continue
        if not isinstance(event, dict): continue
        logger=str(event.get('logger',''))
        if not (logger.startswith('tls.') or 'acme' in logger): continue
        if DOMAIN not in line: continue
        events.append(event)
    events.sort(key=lambda e: e.get('ts',0))
    starts=[i for i,e in enumerate(events) if e.get('msg') in ('acquiring lock','obtaining certificate')]
    if starts: events=events[max(0,starts[-1]-1):]
    errors=[e for e in events if e.get('level') in ('error','warn') and 'context canceled' not in str(e)]
    progress=[e for e in events if e not in errors and e.get('msg') not in ('releasing lock','job failed')]
    chosen=progress[-4:]+errors[-2:]
    chosen.sort(key=lambda e:e.get('ts',0))
    lines=[]
    for e in chosen:
        stamp=datetime.fromtimestamp(e.get('ts',0),timezone.utc).strftime('%H:%M:%SZ')
        parts=[e.get('msg','')]
        for key in ('challenge_type','error','problem','attempt','retrying_in'):
            if key in e: parts.append(key+'='+safe(e[key]))
        lines.append(stamp+' '+safe(' | '.join(parts),550))
    return len(events),lines

def probe(label,url):
    try:
        with urlopen(url,timeout=10) as response:
            body=json.load(response)
            valid=isinstance(body,dict) and bool(body) if label=='IP_AUTH' else isinstance(body,dict) and 'newOrder' in body
            return label+'='+str(response.status)+(' JSON_OK' if valid else ' UNEXPECTED_JSON')
    except Exception as e:
        reason=e.reason if isinstance(e,URLError) else e
        return label+'='+type(reason).__name__+': '+safe(reason,220)

def main():
    print('BOS_DOMAIN_DIAGNOSTIC (read-only)',flush=True)
    print('UTC='+datetime.now(timezone.utc).isoformat(timespec='seconds'),flush=True)
    try:
        record=json.loads((STAGE/'journal.json').read_text())
        current=CONFIG.read_bytes()
        print('JOURNAL='+record.get('status','unknown')+' ORIGINAL_MATCH='+str(hashlib.sha256(current).hexdigest()==record['before']))
        print('DOMAIN_IN_CONFIG='+str(DOMAIN.encode() in current),flush=True)
    except Exception as e: print('CONFIG_CHECK='+type(e).__name__,flush=True)
    try:
        dns=run(['getent','ahostsv4',DOMAIN])
        addresses=sorted({line.split()[0] for line in dns.stdout.splitlines() if line.strip()})
        print('DNS_A='+(','.join(addresses) or 'NO_ANSWER'),flush=True)
    except Exception as e: print('DNS_A='+type(e).__name__,flush=True)
    print(probe('IP_AUTH','https://'+IP+'/auth/v1/health'),flush=True)
    print(probe('ACME_DIRECTORY','https://acme-v02.api.letsencrypt.org/directory'),flush=True)
    try:
        logs=run(['docker','logs','--tail','2000',CONTAINER])
        if logs.returncode: print('DOCKER_LOGS_FAILED exit='+str(logs.returncode));return
        count,lines=certificate_events(logs.stdout+'\n'+logs.stderr)
        print('DOMAIN_TLS_RECORDS='+str(count),flush=True)
        for line in lines: print(line,flush=True)
        if count and not lines: print('Only cancellation/cleanup records found.')
    except Exception as e: print('LOG_CHECK='+type(e).__name__,flush=True)
    print('BOS_DIAGNOSTIC_END',flush=True)

if __name__=='__main__': main()
