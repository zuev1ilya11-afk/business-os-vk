#!/usr/bin/env python3
"""Read-only comparison of the RU report sources and deployed ESZIP modules.

No DB queries, network requests, file writes, service changes, environment
values, source text, attachment URLs or customer data are emitted.
Run from the reviewed checkout; only its vendored ESZIP parser is executed.
"""
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
RELEASE = Path('/opt/business-os/deploy/release-to2wblxf')
EDGE = 'bos-release-to2wblxf-edge'
PARSER_SHA256 = 'e08b2fa98c3e462a1c0b1ec529015e047f42a2836658ffea61b6236bbd36ef5f'
APIS = ('order-lifecycle-api', 'report-api')
FIXED = {
    'order-lifecycle-api': 'f6513572aae74917e49de742fe85d535e29f4e6168e086f992de584ffc24485b',
    'report-api': '3b97c3213562a0c00b5359e284dceda95d09cacc5e6cdf26fcc4bcebf1aa819d',
}
BEFORE = {
    'order-lifecycle-api': '2b8f5dd41d2419512c76ad225d38f570d9c95dca8158b5c9e1acff71470a0520',
    'report-api': 'a41a571c246b72c5210e39832f4473d8dcb8babc1e5e8b0b6e857b73ffd61ad1',
}
RECEIPT_CHECK = "if(!reportReceipt(r.data,token))return json({ok:false,error:'REPORT_NOT_SAVED',message:'Сервер не подтвердил сохранение отчёта. Данные формы сохранены; проверьте состояние перед повтором.'},409);"


class Stop(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path, limit=4_000_000):
    path = Path(path)
    if path.is_symlink() or path.resolve() != path or not path.is_file():
        raise Stop('PATH_MISSING_OR_UNSAFE')
    with path.open('rb') as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise Stop('FILE_SIZE_LIMIT')
    return data


def clean_code(text):
    # Only comparison counts are printed. No source text escapes this function.
    strings = r"(?s)'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`"
    text = re.sub(strings, 'STR', text)
    text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
    return re.findall(r'[A-Za-z_$][\w$]*|\d+|[^\s]', text)


def features(text):
    patterns = {
        'receipt': r'\bfunction\s+reportReceipt\s*\(',
        'write': r'\bfunction\s+reportWriteReceipt\s*\(',
        'started': r'\bfunction\s+reportWorkStarted\s*\(',
        'locked': r'\bfunction\s+reportLocked\s*\(',
        'not_saved': r'\bREPORT_NOT_SAVED\b',
    }
    return ' '.join(key + ':' + str(len(re.findall(pattern, text)))
                    for key, pattern in patterns.items())


def compare_source(name, live, candidate):
    if digest(candidate) != FIXED[name]:
        raise Stop('CHECKOUT_API_CHANGED')
    after = candidate.decode('utf-8')
    expected = 1 if name == 'order-lifecycle-api' else 2
    if after.count(RECEIPT_CHECK) != expected:
        raise Stop('CHECKOUT_GUARD_COUNT')
    before = after.replace(RECEIPT_CHECK, '')
    if digest(before.encode()) != BEFORE[name]:
        raise Stop('BASELINE_RECONSTRUCTION_FAILED')
    actual = live.decode('utf-8')
    state = 'FIXED' if actual == after else 'BASELINE' if actual == before else 'DIFFERS'
    print(name + ' SOURCE=' + state + ' bytes=' + str(len(live)))
    print('  ' + features(actual))
    a, b = clean_code(before), clean_code(actual)
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    edits = [(tag, j-i, v-u) for tag, i, j, u, v in matcher.get_opcodes() if tag != 'equal']
    print('  diff_groups=' + str(len(edits)) + ' token_changes=' +
          str(sum(x[1] + x[2] for x in edits)))
    # Offsets and lengths permit a focused follow-up without disclosing source.
    print('  diff_sizes=' + json.dumps(edits[:6], separators=(',', ':')))
    return actual


def parser():
    path = REPO / 'deploy/finance-export/eszip.py'
    source = read(path)
    # Pin the reviewed parser instead of importing anything from production.
    if digest(source) != PARSER_SHA256:
        raise Stop('PARSER_CHANGED')
    namespace = {'__name__': 'bos_report_eszip_inspect'}
    exec(compile(source, str(path), 'exec'), namespace)
    return namespace['parse']


def inspect_bundle(parse, name, source):
    data = read(RELEASE / ('edge/bundles/' + name + '.eszip'), 128 * 1024 * 1024)
    graph = parse(data)
    suffix = '/supabase/functions/' + name + '/index.ts'
    keys = [key for key in graph['modules'] if key.endswith(suffix)]
    if len(keys) != 1:
        raise Stop('BUNDLE_ENTRY_NOT_UNIQUE')
    key = keys[0]
    code = graph['modules'][key][1].decode('utf-8')
    original = []
    mapping = graph['maps'].get(key)
    if mapping:
        record = json.loads(mapping)
        original = [x for x in record.get('sourcesContent', []) if isinstance(x, str)]
    matching = 'YES' if source in original else 'NO' if original else 'UNAVAILABLE'
    print('  BUNDLE source_map_matches=' + matching + ' ' + features(code))


def main():
    raw = subprocess.run(['docker', 'inspect', EDGE], check=True, capture_output=True,
                         timeout=15).stdout
    info = json.loads(raw)[0]
    mounts = info.get('Mounts', [])
    for source, target in [('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')]:
        found = [x for x in mounts if x.get('Type') == 'bind' and x.get('Destination') == target]
        if len(found) != 1 or found[0]['Source'] != str(RELEASE / 'edge' / source):
            raise Stop('ACTIVE_MOUNT_MISMATCH')
    if not info.get('State', {}).get('Running'):
        raise Stop('EDGE_NOT_RUNNING')
    print('ACTIVE_MOUNTS=OK CHECK_ONLY=YES')
    parse = parser()
    for name in APIS:
        relative = 'supabase/functions/' + name + '/index.ts'
        actual = compare_source(name, read(RELEASE / 'edge/sources' / name / relative),
                                read(REPO / relative))
        inspect_bundle(parse, name, actual)
    print('COMPLETE=YES PRODUCTION_CHANGED=NO')


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    try:
        main()
    except Stop as error:
        print('STOP=' + str(error))
        sys.exit(1)
    except Exception as error:
        # Exceptions may contain source/config values; only print the class.
        print('STOP=' + type(error).__name__)
        sys.exit(1)
