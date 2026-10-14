#!/usr/bin/env python3
"""Repeat only PR289's isolated candidate probe; never activate or restart production."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import uuid

PACKAGE_SHA = '466511c1d33b3cf5d26f41701bc0cd9de1b9bd16220bd7f927a0150124f890a9'


def redact(log, source, metadata):
    log = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', log)
    log = ''.join(c for c in log if c in '\n\t' or ord(c) >= 32)
    values = set()
    for item in metadata:
        for entry in item.get('Config', {}).get('Env', []) or []:
            value = entry.partition('=')[2]
            if value:
                values.add(value)
    assignments = r'\b[\w$]*(?:token|secret|password|api_key|service_key)[\w$]*\s*(?::\s*[^=;\n]+)?=\s*([\'\"])(.*?)\1'
    values.update(match[1] for match in re.findall(assignments, source, re.IGNORECASE) if match[1])
    for _, value in re.findall(r'([\'\"])([^\'\"\r\n]{16,})\1', source):
        if not re.search(r'\s', value):
            values.add(value)
    representations = set()
    for value in values:
        representations.update((value, urllib.parse.quote(value, safe=''), urllib.parse.quote_plus(value),
                               json.dumps(value)[1:-1], json.dumps(value, ensure_ascii=False)[1:-1]))
    if representations:
        pattern = '|'.join(re.escape(v) for v in sorted(representations, key=len, reverse=True))
        log = re.sub(pattern, '[REDACTED]', log)
    return re.sub(r'[A-Za-z0-9_+/.=-]{32,}', '[OPAQUE_VALUE]', log)


def main():
    package = Path(__file__).resolve().with_name('bos289.pyz')
    if os.geteuid() != 0 or hashlib.sha256(package.read_bytes()).hexdigest() != PACKAGE_SHA:
        raise RuntimeError('Run as root beside the pinned PR291 bos289.pyz')
    sys.path.insert(0, str(package))
    import frontend as f
    import backend as b
    import release as r
    os.umask(0o077)
    lock = os.open(f.PARENT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rec = r.load(b.STAGE)
        f.require(rec and rec['state'] == 'preparing', 'Expected an unactivated preparation')
        f.require(not f.STAGE.exists(), 'Frontend staging already exists; review required')
        live = b.check(rec, 'before')
        web = Path(rec['roots']['main']).parent.parent / 'web'
        fresh = b.discover(web)
        f.require(all(fresh[k] == rec[k] for k in fresh), 'Saved configuration differs from discovery')
        for folder, before in rec['before'].items():
            actual = f.snapshot(b.STAGE / folder)
            f.require(actual.keys() == before.keys(), 'Staged file set differs')
            for name, value in before.items():
                if b.TARGETS.get(folder) == name:
                    f.require(all(actual[name][k] == value[k] for k in ('mode', 'uid', 'gid', 'type')),
                              'Staged target metadata differs')
                else:
                    f.require(actual[name] == value, 'Unrelated staged file differs')
        f.require(f.sha((b.STAGE / 'sources/push-api/index.ts').read_bytes()) == b.SOURCE_AFTER,
                  'Expected the approved CORS-only source')
        candidate = (b.STAGE / 'bundles/push-api.eszip').read_bytes()
        f.require(len(candidate) > 64 and candidate == (b.STAGE / 'output/push-api.eszip').read_bytes(),
                  'Compiled candidate differs from saved build output')
        rec = dict(rec, nonce=uuid.uuid4().hex)
        diagnostic = b.STAGE / ('diagnosis-' + rec['nonce'])
        diagnostic.mkdir(mode=0o700)
        paths = [b.STAGE / 'sources/push-api/index.ts', *sorted((b.STAGE / 'main').rglob('*.ts'))]
        source = '\n'.join(p.read_text() for p in paths)

        def private_command(args, label, timeout=60, input_data=None):
            result = subprocess.run(args, input=input_data, capture_output=True, timeout=timeout)
            (diagnostic / (label + '.log')).write_bytes(result.stdout + b'\n' + result.stderr)
            f.require(result.returncode == 0, label + ': failed; private diagnostic retained')
            return result.stdout

        original_cleanup = b.cleanup

        def capture_then_cleanup(record):
            try:
                ids = f.command(['docker', 'ps', '-aq', '--filter', 'label=bos.pr289=' + record['nonce']]).decode().split()
                f.require(len(ids) <= 1, 'Unexpected diagnostic container count')
                for cid in ids:
                    info = f.inspect(cid)
                    state = info['State']
                    print('CANDIDATE_STATE=' + json.dumps({
                        'running': bool(state.get('Running')), 'exit_code': state.get('ExitCode'),
                        'oom_killed': bool(state.get('OOMKilled')),
                        'network': info['HostConfig'].get('NetworkMode')}), flush=True)
                    private_command(['docker', 'logs', '--tail', '80', cid], 'runtime')
                    log = (diagnostic / 'runtime.log').read_text(errors='replace')
                    print('SANITIZED_RUNTIME_LOG:', flush=True)
                    print(redact(log, source, [live, info])[-2500:] or '[empty]', flush=True)
            finally:
                original_cleanup(record)

        b.private_command = private_command
        b.cleanup = capture_then_cleanup
        print('DIAGNOSIS: isolated container only; production remains unchanged', flush=True)
        try:
            b.probe_candidate(rec)
            print('ISOLATED_PROBE_OK', flush=True)
        except f.Stop as error:
            print('ISOLATED_PROBE_STOP=' + str(error), flush=True)
        finally:
            b.check(rec, 'before')
        print('PRODUCTION_FILES_UNCHANGED; no production restart performed', flush=True)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Arbitrary subprocess errors can contain private values; keep them out.
        print('DIAGNOSTIC_STOP=' + type(error).__name__, flush=True)
        sys.exit(1)
