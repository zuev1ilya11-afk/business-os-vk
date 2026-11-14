#!/usr/bin/env python3
"""Read-only hash verification of the observed report -> Lemana release journals.
No installer imports, subprocesses, network, database access or file writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

LIVE = '/opt/business-os/deploy/release-to2wblxf'
REPORT = '/root/bos-report-runtime'
PRICE = '/root/bos-lemana-price'
MAX_FILE, MAX_TOTAL, MAX_JSON, MAX_FILES = 128 << 20, 512 << 20, 8 << 20, 512
APIS = ('report-api', 'order-lifecycle-api')
WEB = ('service-catalog.js', 'report-deduction.js', 'report-uncompleted-ui.js',
       'order-work-editor.js', 'business-os-custom-v3.js', 'master-price-memo-v131.js',
       'employee-profile-patch.js', 'finance-data.js')
VERSIONS = {'web/' + p for p in ('index.html', 'sw.js', 'build-version.js')}
REPORT_REQUIRED = VERSIONS | {'web/startup-shell.bundle.js'} | {
    'edge/sources/' + n + '/supabase/functions/' + n + '/index.ts' for n in APIS
} | {'edge/bundles/' + n + '.eszip' for n in APIS}
PRICE_REQUIRED = VERSIONS | {
    'edge/sources/' + n + '/' + p for n in APIS for p in ('service-catalog.js', 'report-deduction.js')
} | {'edge/sources/mini-app-api/supabase/functions/_shared/finance-export-models.mjs'} | {
    'edge/bundles/' + n + '.eszip' for n in (*APIS, 'mini-app-api')}
REPORT_ALLOWED = REPORT_REQUIRED | {'web/report-chunk-upload-v23.js'}
PRICE_ALLOWED = PRICE_REQUIRED | {'web/' + p for p in (*WEB, 'startup-shell.bundle.js', 'startup-eager.bundle.js')}
DISPLAY = REPORT_ALLOWED | PRICE_ALLOWED | {'edge/main/' + p for p in ('index.ts', 'routes.json', 'bos-report-env.json', 'deno.json', 'import_map.json')}


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


def relative(value):
    require(isinstance(value, str) and len(value) <= 300 and
            re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value) and
            all(p not in ('.', '..') for p in value.split('/')), 'UNSAFE_PATH')
    return value


def root(path):
    path = Path(path).absolute()
    require(path.resolve() == path and path.is_dir(), 'UNSAFE_OR_MISSING_ROOT')
    return path


def fingerprint(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


class Reader:
    def __init__(self):
        self.total = 0

    def read(self, path, capture=False):
        require(path.resolve() == path, 'SYMLINK_PATH')
        before = path.lstat()
        require(stat.S_ISREG(before.st_mode), 'NOT_REGULAR_FILE')
        limit = MAX_JSON if capture else MAX_FILE
        require(before.st_size <= limit and self.total + before.st_size <= MAX_TOTAL, 'READ_BUDGET')
        digest, parts, size = hashlib.sha256(), [], 0
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
            require(fingerprint(os.fstat(handle.fileno())) == fingerprint(before), 'FILE_CHANGED')
            while chunk := handle.read(65536):
                size += len(chunk)
                self.total += len(chunk)
                require(size <= limit and self.total <= MAX_TOTAL, 'READ_BUDGET')
                digest.update(chunk)
                if capture:
                    parts.append(chunk)
        require(fingerprint(path.lstat()) == fingerprint(before) and path.resolve() == path, 'FILE_CHANGED')
        return b''.join(parts) if capture else digest.hexdigest()

    def json(self, path):
        def unique(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, 'DUPLICATE_JSON_KEY')
                result[key] = value
            return result
        return json.loads(self.read(path, True), object_pairs_hook=unique)


def sha(value):
    require(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value), 'INVALID_SHA')
    return value


def journal(reader, work, allowed, required):
    work = root(work)
    pointer = reader.json(work / 'current.json')
    stage = pointer.get('stage') if isinstance(pointer, dict) else None
    require(isinstance(stage, str) and re.fullmatch('stage-[A-Za-z0-9_-]{1,120}', stage), 'INVALID_STAGE_POINTER')
    record = reader.json(root(work / stage) / 'journal.json')
    require(isinstance(record, dict) and record.get('status') == 'applied', 'RELEASE_NOT_APPLIED')
    for key in ('build', 'old_build'):
        require(isinstance(record.get(key), str) and re.fullmatch('[a-f0-9]{20}', record[key]), 'INVALID_BUILD')
    files = record.get('files')
    require(isinstance(files, dict) and required <= set(files) <= allowed, 'INVALID_RELEASE_FILES')
    for path, value in files.items():
        relative(path)
        require(isinstance(value, dict) and isinstance(value.get('before'), dict), 'INVALID_FILE_RECORD')
        sha(value.get('after'))
        sha(value['before'].get('sha'))
    return record


def main_tree(path):
    path, result, pending, count = root(path), set(), [''], 0
    while pending:
        directory = pending.pop()
        with os.scandir(path / directory) as entries:
            for entry in entries:
                count += 1
                require(count <= MAX_FILES, 'TREE_BUDGET')
                name = relative((directory + '/' if directory else '') + entry.name)
                info = entry.stat(follow_symlinks=False)
                require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'TREE_LINK_OR_SPECIAL')
                require((path / name).resolve() == path / name, 'SYMLINK_PATH')
                if stat.S_ISDIR(info.st_mode):
                    pending.append(name)
                else:
                    result.add(name)
    return result


def verify(live=LIVE, report=REPORT, price=PRICE):
    out = {'READ_ONLY': True, 'CHAIN_MATCH': False, 'REPORT_BUILD': None, 'LEMANA_BUILD': None,
           'LIVE_BUILD': None, 'EFFECTIVE_FILES': 0, 'FILES_MATCHED': 0, 'MAIN_FILES': 0,
           'MAIN_MATCHED': 0, 'MISMATCH_COUNT': 0, 'MISMATCHES': [], 'ERRORS': [],
           'COMPLETE': False, 'VERIFIED': False,
           'LIMITS': 'FILE_HASHES_ONLY_NO_DOCKER_ENV_DB_METADATA_OR_BACKUP_CHECK'}
    reader = Reader()
    def problem(code, path=None):
        if code not in out['ERRORS']:
            out['ERRORS'].append(code)
        if path:
            out['MISMATCH_COUNT'] += 1
            if path in DISPLAY and len(out['MISMATCHES']) < 5:
                out['MISMATCHES'].append(path)
    try:
        live = root(live)
        old = journal(reader, report, REPORT_ALLOWED, REPORT_REQUIRED)
        new = journal(reader, price, PRICE_ALLOWED, PRICE_REQUIRED)
        out['REPORT_BUILD'], out['LEMANA_BUILD'] = old['build'], new['build']
        require(new['old_build'] == old['build'], 'BUILD_CHAIN_MISMATCH')
        for path in old['files'].keys() & new['files'].keys():
            require(new['files'][path]['before']['sha'] == old['files'][path]['after'], 'FILE_CHAIN_MISMATCH')
        out['CHAIN_MATCH'] = True
        raw = reader.read(live / 'web/build-version.js', True)
        match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\s*', raw, re.S)
        require(match is not None, 'INVALID_LIVE_MANIFEST')
        meta = json.loads(match[1])
        require(isinstance(meta, dict) and isinstance(meta.get('id'), str) and re.fullmatch('[a-f0-9]{20}', meta['id']), 'INVALID_LIVE_MANIFEST')
        out['LIVE_BUILD'] = meta['id']
        require(meta['id'] == new['build'], 'LIVE_BUILD_MISMATCH')
        mapping = meta.get('assetBundles', {})
        require(isinstance(mapping, dict), 'INVALID_LIVE_MANIFEST')
        for name in WEB:
            target = mapping.get(name, name)
            require(target in (name, 'startup-shell.bundle.js', 'startup-eager.bundle.js') and 'web/' + target in new['files'], 'MISSING_PRICE_WEB_TARGET')
        effective = {path: value['after'] for record in (old, new) for path, value in record['files'].items()}
        baseline = new.get('before', {}).get('main')
        require(isinstance(baseline, dict) and 0 < len(baseline) <= MAX_FILES, 'INVALID_MAIN_BASELINE')
        for path, value in baseline.items():
            relative(path)
            require(isinstance(value, dict), 'INVALID_MAIN_BASELINE')
            sha(value.get('sha'))
        out['EFFECTIVE_FILES'], out['MAIN_FILES'] = len(effective), len(baseline)
        current = main_tree(live / 'edge/main')
        for path in sorted(current - baseline.keys()):
            problem('MAIN_EXTRA_FILE', 'edge/main/' + path)
        complete = True
        expected = [(p, digest, 'FILES_MATCHED') for p, digest in effective.items()]
        expected += [('edge/main/' + p, v['sha'], 'MAIN_MATCHED') for p, v in baseline.items()]
        require(len(expected) <= MAX_FILES, 'FILE_COUNT_BUDGET')
        for path, digest, counter in sorted(expected):
            try:
                actual = reader.read(live / path)
                if actual == digest:
                    out[counter] += 1
                else:
                    problem('FILE_HASH_MISMATCH', path)
            except (Stop, OSError) as error:
                complete = False
                problem(str(error) if isinstance(error, Stop) else 'FILE_UNREADABLE_OR_MISSING', path)
        out['COMPLETE'] = complete
        out['VERIFIED'] = complete and not out['ERRORS']
    except (Stop, OSError, ValueError, TypeError, AttributeError, RecursionError) as error:
        problem(str(error) if isinstance(error, Stop) else 'INVALID_OR_UNREADABLE_EVIDENCE')
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name, default in (('live', LIVE), ('report', REPORT), ('price', PRICE)):
        parser.add_argument('--' + name, default=default)
    result = verify(**vars(parser.parse_args(argv)))
    for key, value in result.items():
        print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')))
    return 0 if result['VERIFIED'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
