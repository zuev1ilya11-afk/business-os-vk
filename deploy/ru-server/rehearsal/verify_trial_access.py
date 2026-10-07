#!/usr/bin/env python3
"""Read-only catalog comparison: current hosted baseline vs isolated restore trial.

No permission repairs. Matching these categories does not certify all service
behavior or all PostgreSQL object types. Extension owners remain explicit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

from rehearse_restore import stop_trial
from vault_rekey_trial import validate_container

CATEGORIES = {'schema_metadata', 'relation_metadata', 'column_acl', 'function_metadata',
              'default_acl', 'policies', 'roles', 'memberships', 'extension_function_access',
              'extension_relation_access', 'extension_sequence_access', 'extension_member_owners'}


def validate_inventory(value):
    if (not isinstance(value, dict) or set(value) != {
            'categories', 'database_grants', 'database_owner', 'extension_owners'}
            or not isinstance(value['categories'], dict)
            or set(value['categories']) != CATEGORIES):
        raise ValueError('Incomplete access inventory')
    for item in value['categories'].values():
        if (not isinstance(item, dict) or set(item) != {'objects', 'fingerprint'}
                or type(item['objects']) is not int or item['objects'] < 0
                or not isinstance(item['fingerprint'], str)
                or not re.fullmatch(r'[a-f0-9]{32}', item['fingerprint'])):
            raise ValueError('Invalid category summary')
    if (not isinstance(value['database_owner'], str) or not value['database_owner']
            or not isinstance(value['extension_owners'], dict) or not value['extension_owners']
            or not all(isinstance(k, str) and k and isinstance(v, str) and v
                       for k, v in value['extension_owners'].items())):
        raise ValueError('Invalid ownership inventory')
    grants = value['database_grants']
    if not isinstance(grants, list) or not grants:
        raise ValueError('Missing database grants')
    for grant in grants:
        if (not isinstance(grant, list) or len(grant) != 4
                or not all(isinstance(v, str) and v for v in grant[:2])
                or grant[2] not in ('CREATE', 'CONNECT', 'TEMPORARY')
                or type(grant[3]) is not bool):
            raise ValueError('Invalid database grant')
    if len({tuple(g) for g in grants}) != len(grants):
        raise ValueError('Duplicate database grant')


def validate_baseline(baseline, query, validator=validate_inventory):
    if (baseline.get('project_id') != 'obsropbslfwtanyspjbi'
            or baseline.get('query_sha256') != hashlib.sha256(query).hexdigest()
            or not baseline.get('captured_at')):
        raise ValueError('Source baseline identity mismatch')
    validator(baseline['inventory'])


def validate_details(value):
    if (not isinstance(value, dict) or set(value) != {
            'schema_metadata', 'extension_member_owners', 'extension_security_definers'}):
        raise ValueError('Incomplete access details')
    for category in ('schema_metadata', 'extension_member_owners'):
        if (not isinstance(value[category], dict) or not value[category]
                or not all(isinstance(k, str) and k for k in value[category])):
            raise ValueError('Missing named access entries')
    for owner in value['extension_member_owners'].values():
        if not isinstance(owner, str) or not owner:
            raise ValueError('Invalid member owner')
    definers = value['extension_security_definers']
    if (not isinstance(definers, list) or not all(isinstance(k, str) for k in definers)
            or len(set(definers)) != len(definers)
            or not set(definers).issubset(value['extension_member_owners'])):
        raise ValueError('Invalid security definer inventory')
    for schema in value['schema_metadata'].values():
        if (not isinstance(schema, list) or len(schema) != 2
                or not isinstance(schema[0], str) or not schema[0] or not isinstance(schema[1], list)):
            raise ValueError('Invalid schema metadata')
        for grant in schema[1]:
            if (not isinstance(grant, list) or len(grant) != 4
                    or not all(isinstance(v, str) and v for v in grant[:2])
                    or grant[2] not in ('CREATE', 'USAGE') or type(grant[3]) is not bool):
                raise ValueError('Invalid schema grant')


def compare_details(expected, actual):
    validate_details(expected)
    validate_details(actual)

    def differences(category):
        return {k: {'source': expected[category].get(k), 'trial': actual[category].get(k)}
                for k in sorted(set(expected[category]) | set(actual[category]))
                if expected[category].get(k) != actual[category].get(k)}

    schemas = differences('schema_metadata')
    owners = differences('extension_member_owners')
    old_definers, new_definers = map(set, (expected['extension_security_definers'],
                                          actual['extension_security_definers']))
    changed_definers = sorted(((old_definers | new_definers) & set(owners)) | (old_definers ^ new_definers))
    return {'schema_differences': schemas, 'member_owner_differences': owners,
            'changed_security_definers': changed_definers,
            'all_match': not (schemas or owners or changed_definers)}


def compare(expected, actual):
    validate_inventory(expected)
    validate_inventory(actual)
    missing = set(map(tuple, expected['database_grants'])) - set(map(tuple, actual['database_grants']))
    extra = set(map(tuple, actual['database_grants'])) - set(map(tuple, expected['database_grants']))
    categories = sorted(k for k in CATEGORIES if expected['categories'][k] != actual['categories'][k])
    extension_names = set(expected['extension_owners']) | set(actual['extension_owners'])
    owners = sorted(k for k in extension_names
                    if expected['extension_owners'].get(k) != actual['extension_owners'].get(k))
    db_owner = expected['database_owner'] == actual['database_owner']
    return {'all_match': not (missing or extra or categories or owners or not db_owner),
            'different_categories': categories, 'database_owner_match': db_owner,
            'different_extension_owners': owners,
            'missing_database_grants': sorted(missing), 'extra_database_grants': sorted(extra)}


def run_command(command, stage, **kwargs):
    result = subprocess.run(command, capture_output=True, **kwargs)
    # Metadata stdout is parsed separately. Never log rows or credentials.
    with (stage / 'verify.log').open('ab') as log:
        log.write(result.stderr)
    return result


def collect(cid, stage, query, validator=validate_inventory):
    psql = ['docker', 'exec', '-i', cid, 'psql', '-X', '-w', '-qAt',
            '-h', '127.0.0.1', '-U', 'bos_restore_loader', '-d', 'bos_restore_check',
            '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse']
    try:
        result = run_command(['docker', 'start', cid], stage, timeout=30)
        if result.returncode:
            raise RuntimeError('Trial start failed')
        for _ in range(30):
            result = run_command(psql, stage, input=b'SHOW cron.launch_active_jobs;', timeout=10)
            if result.returncode == 0:
                if result.stdout.strip() != b'off':
                    raise RuntimeError('Cron must remain disabled')
                break
            time.sleep(1)
        else:
            raise RuntimeError('Trial startup timeout')
        result = run_command(psql, stage, input=query, timeout=60)
        if result.returncode:
            raise RuntimeError('Catalog read failed')
        inventory = json.loads(result.stdout)
        validator(inventory)
        return inventory
    finally:
        if not stop_trial(cid):
            print('BOS_TRIAL_STOP_FAILED', flush=True)
            raise RuntimeError('Trial stop failed')
        print('Пробный контейнер остановлен.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--details', action='store_true', help='Compare named schemas and extension member owners')
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    folder = Path(__file__).resolve().parent
    mode = 'details' if args.details else 'inventory'
    validator = validate_details if args.details else validate_inventory
    query = (folder / f'access_{mode}.sql').read_bytes()
    baseline = json.loads((folder / f'source_access_{mode}.json').read_bytes())
    validate_baseline(baseline, query, validator)
    info = json.loads(subprocess.run(['docker', 'inspect', args.container], check=True,
                      capture_output=True, text=True, timeout=20).stdout)[0]
    cid = validate_container(info, args.container)
    stage = Path(tempfile.mkdtemp(prefix='access-verify-', dir='/opt/business-os/deploy'))
    print('Каталог проверки:', stage, flush=True)

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    actual = collect(cid, stage, query, validator)
    comparator = compare_details if args.details else compare
    comparison = comparator(baseline['inventory'], actual)
    report = {'source_project': baseline['project_id'], 'source_captured_at': baseline['captured_at'],
              'query_sha256': baseline['query_sha256'], 'container_id': cid,
              'expected': baseline['inventory'], 'actual': actual, 'comparison': comparison, 'mode': mode,
              'scope': 'current catalog metadata; not complete service or migration validation'}
    (stage / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if args.details:
        print('Расхождения схем (источник / пробная БД):', json.dumps(comparison['schema_differences'], ensure_ascii=False))
        groups = {}
        for name, change in comparison['member_owner_differences'].items():
            group = (name.split('|', 1)[0], change['source'], change['trial'])
            groups[group] = groups.get(group, 0) + 1
        print('Различия владельцев объектов расширений:', json.dumps([
            {'extension': k[0], 'source_owner': k[1], 'trial_owner': k[2], 'objects': count}
            for k, count in sorted(groups.items(), key=lambda item: json.dumps(item[0]))]))
        print('Изменённые SECURITY DEFINER:', json.dumps(comparison['changed_security_definers']))
        print('BOS_TRIAL_ACCESS_DETAILS_OK', flush=True)
        print('BOS_TRIAL_ACCESS_DETAILS_MATCH' if comparison['all_match'] else 'BOS_TRIAL_ACCESS_DETAILS_DIFFERENCES', flush=True)
        return 0
    print('Категорий совпало:', len(CATEGORIES) - len(comparison['different_categories']), '/', len(CATEGORIES))
    print('Расхождения категорий:', json.dumps(comparison['different_categories'], ensure_ascii=False))
    print('Владелец базы совпал:', comparison['database_owner_match'])
    print('Различия владельцев расширений:', json.dumps(comparison['different_extension_owners']))
    print('Недостающие права базы:', json.dumps(comparison['missing_database_grants']))
    print('Лишние права базы:', json.dumps(comparison['extra_database_grants']))
    print('BOS_TRIAL_ACCESS_INVENTORY_OK', flush=True)
    print('BOS_TRIAL_ACCESS_MATCH' if comparison['all_match'] else 'BOS_TRIAL_ACCESS_DIFFERENCES', flush=True)
    print('Проверены перечисленные категории; работоспособность сервисов проверяется отдельно.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt):
        print('BOS_TRIAL_ACCESS_FAILED; журнал оставлен на сервере, не отправляйте его целиком.', flush=True)
        sys.exit(1)
