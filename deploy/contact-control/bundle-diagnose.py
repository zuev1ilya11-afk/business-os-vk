#!/usr/bin/env python3
"""Compare bundles and rebuild the original API offline in private scratch space.

No database access, production file replacement, service restart or activation.
Requires the exact d56030e installer already downloaded to /root/bos295.pyz.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile
import uuid

PACKAGE = Path('/root/bos295.pyz')
PACKAGE_SHA = '830a64c4c84cd6be1744f456dc968d6d2cdd2034478ca045cb222a26e5bd89cb'
SLUG = 'master-workflow-api'
ENTRY = 'supabase/functions/master-workflow-api/index.ts'
FILENAME = SLUG + '.eszip'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_bytes(path):
    f.require(path.resolve() == path and path.is_file() and not path.is_symlink()
              and path.stat().st_size <= 32 * 1024 * 1024, 'Unsafe or oversized diagnostic input')
    return path.read_bytes()


def describe(label, data):
    f.emit(label + ' bytes=' + str(len(data)) + ' magic=' + data[:8].hex())
    f.emit(label + '_SHA256=' + digest(data))


def version_tokens(data):
    # These are diagnostic tokens, not a claim about the dependency graph.
    return sorted({x.decode('ascii') for x in re.findall(
        rb'(?<![0-9.])[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}(?![0-9.])', data)})


def compare(old, new, label):
    describe(label, new)
    before, after = set(version_tokens(old)), set(version_tokens(new))
    f.emit(label + '_VERSION_TOKENS_REMOVED=' + json.dumps(sorted(before-after)[:24]))
    f.emit(label + '_VERSION_TOKENS_ADDED=' + json.dumps(sorted(after-before)[:24]))
    common = next((i for i, (a, z) in enumerate(zip(old, new)) if a != z), min(len(old), len(new)))
    f.emit(label + '_FIRST_DIFFERENCE=' + str(common if old != new else -1))


def find_cache(rec):
    matches = []
    expected = rec['before']['bundles'][FILENAME]['sha256']
    for edge in sorted(f.PARENT.glob('service-trial-*/edge')):
        if edge.resolve() != edge or not (edge/'cache').is_dir():
            continue
        try:
            same = (json.loads(safe_bytes(edge/'image.json'))['image_id'] == rec['image']
                    and digest(safe_bytes(edge/'bundles'/FILENAME)) == expected
                    and digest(safe_bytes(edge/'sources'/SLUG/ENTRY)) == b.SOURCE_BEFORE
                    and digest(safe_bytes(edge/'sources'/SLUG/'order-payroll.js')) == b.PAYROLL_BEFORE)
        except (OSError, ValueError, KeyError, f.Stop):
            continue
        if same:
            matches.append(edge/'cache')
    f.emit('MATCHING_ORIGINAL_CACHES=' + str(len(matches)))
    f.require(len(matches) == 1, 'Cannot uniquely match cache to the active image, source and bundle')
    return matches[0]


def offline_args(rec, work, nonce):
    return ['docker', 'run', '-d', '--pull=never', '--network', 'none',
            '--label', 'bos.contact295='+nonce, '--name', 'bos-contact295-diagnose-'+nonce,
            *b.LIMITS, '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=128m',
            '--env', 'DENO_DIR=/bos-cache', '--entrypoint', '/bin/sh',
            '--mount', 'type=bind,src='+str(work/'sources')+',dst=/bos-src/'+SLUG+',readonly',
            '--mount', 'type=bind,src='+str(work/'cache')+',dst=/bos-cache',
            '--mount', 'type=bind,src='+str(work/'bundles')+',dst=/bos-bundles',
            rec['image'], '-c', 'while :; do sleep 1; done']


def offline_trial(rec, old):
    cache = find_cache(rec)
    before = f.snapshot(cache)
    size = sum(entry.get('size', 0) for entry in before.values())
    f.require(shutil.disk_usage(f.PARENT).free > size*2+256*1024*1024, 'Insufficient private staging space')
    work = Path(tempfile.mkdtemp(prefix='contact-295-diagnose-', dir=f.PARENT))
    f.emit('DIAGNOSTIC_DIR=' + str(work))
    f.copy_tree(cache, work/'cache')
    f.require(f.snapshot(work/'cache') == before, 'Cache copy does not match original')
    source = Path(rec['roots']['sources'])/SLUG
    source_before = f.snapshot(source)
    f.copy_tree(source, work/'sources')
    f.require(f.snapshot(work/'sources') == source_before, 'Source copy does not match original')
    (work/'bundles').mkdir(mode=0o700)
    original_stage, b.STAGE = b.STAGE, work
    nonce = uuid.uuid4().hex
    result = {}
    try:
        cid = b.private_command(offline_args(rec, work, nonce), 'diagnostic-start').decode().strip()
        b.assert_isolated(cid)
        command = ['docker', 'exec', cid, 'edge-runtime', 'bundle',
                   '--entrypoint', '/bos-src/'+SLUG+'/'+ENTRY,
                   '--output', '/bos-bundles/'+FILENAME, '--timeout', '300']
        previous = None
        for attempt in (1, 2):
            f.emit('OFFLINE_BASELINE_BUILD=' + str(attempt))
            label = 'cached-baseline-'+str(attempt)
            try:
                b.private_command(command, label, timeout=330)
            except f.Stop:
                # This compiler receives only public source, copied dependency
                # cache and DENO_DIR. No production environment/credentials.
                log = work/(label+'.log')
                if log.is_file():
                    for line in log.read_text(errors='replace').splitlines()[-8:]:
                        f.emit('ISOLATED_COMPILER: '+line[:240])
                raise
            path = work/'bundles'/FILENAME
            data = safe_bytes(path)
            compare(old, data, 'CACHED_'+str(attempt))
            path.rename(work/('attempt-'+str(attempt)+'.eszip'))
            result['attempt_'+str(attempt)] = digest(data)
            if data == old:
                f.emit('CACHED_BASELINE_MATCH=yes')
                result['matches_live'] = True
                break
            if previous is not None:
                f.emit('REPEAT_REPRODUCIBLE=' + str(previous == data).lower())
            previous = data
        else:
            result['matches_live'] = False
            f.emit('CACHED_BASELINE_MATCH=no')
        (work/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    finally:
        try:
            b.cleanup({'nonce': nonce})
        finally:
            b.STAGE = original_stage
            f.require(f.snapshot(cache) == before, 'Original cache changed during diagnostic')
            f.require(f.snapshot(source) == source_before, 'Original API source changed during diagnostic')
            b.check(rec, 'before')
    f.emit('DIAGNOSTIC_DONE; production unchanged')


def main():
    global f, b, r
    if os.geteuid() != 0 or not PACKAGE.is_file() or PACKAGE.is_symlink() or digest(PACKAGE.read_bytes()) != PACKAGE_SHA:
        raise ValueError('Run as root with the unchanged d56030e installer at /root/bos295.pyz')
    sys.path.insert(0, str(PACKAGE))
    import frontend as f
    import backend as b
    import release as r
    os.umask(0o077)
    f.require(f.PARENT.is_dir() and f.PARENT.resolve() == f.PARENT, 'Unexpected deployment directory')
    lock = os.open(f.PARENT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rec = r.load(b.STAGE)
        f.require(rec is not None and rec['state'] == 'preparing', 'Expected an inactive failed preparation')
        b.check(rec, 'before')
        b.checked_payload(rec)
        old = safe_bytes(b.STAGE/'backup'/FILENAME)
        new = safe_bytes(b.STAGE/'output'/FILENAME)
        describe('LIVE_BASELINE', old)
        compare(old, new, 'FRESH_CACHE')
        offline_trial(rec, old)
    finally:
        os.close(lock)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print('DIAGNOSTIC_STOP: ' + (str(error) if type(error).__name__ in ('Stop', 'ValueError') else type(error).__name__), flush=True)
        sys.exit(1)
