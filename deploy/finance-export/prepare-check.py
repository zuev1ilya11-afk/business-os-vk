#!/usr/bin/env python3
"""Refresh the standalone check's baseline from the reviewed finance commit."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APPLICATION = '54f9b0b32e675b3305cde9aa36221dd6841f88b7'
ORIGINS = ('https://obsropbslfwtanyspjbi.supabase.co',
           'https://139.100.237.167', 'https://homemaster.qd.je')


def git_file(revision, filename):
    return subprocess.check_output(['git', 'show', revision + ':' + filename], cwd=ROOT)


def digest(data):
    for origin in ORIGINS:
        data = data.replace(origin.encode(), b'@BOS_ORIGIN@')
    return hashlib.sha256(data.rstrip()).hexdigest()


def main():
    filenames = ['finance-page.js', 'finance-data.js', 'finance-expenses.js', 'order-payroll.js',
                 'salary-periods.js', 'order-work-items.js', 'service-catalog.js', 'report-deduction.js',
                 'pwa-register.js', 'network-direct-v86.js', 'approved-operations-ui.css']
    baseline = {'revision': APPLICATION + '^', 'web': {n: digest(git_file(APPLICATION + '^', n)) for n in filenames},
                'api': digest(git_file(APPLICATION + '^', 'supabase/functions/mini-app-api/index.ts'))}
    api = git_file(APPLICATION, 'supabase/functions/_shared/finance-export.ts').decode()
    expected = {table: re.search("const " + constant + "='([^']+)'", api)[1].split(',') for table, constant in
                [('orders', 'EXPORT_ORDER_COLUMNS'), ('business_staff', 'EXPORT_STAFF_COLUMNS'),
                 ('finance_expenses', 'EXPORT_EXPENSE_COLUMNS')]}
    expected['order_claims'] = re.search(r"db\.from\('order_claims'\)\.select\('([^']+)'\)", api)[1].split(',')
    path = Path(__file__).with_name('check.py')
    text = path.read_text()
    text, b = re.subn(r'^BASELINE = .*$', 'BASELINE = ' + repr(baseline), text, flags=re.M)
    text, c = re.subn(r'^EXPECTED_COLUMNS = .*$', 'EXPECTED_COLUMNS = ' + repr(expected), text, flags=re.M)
    assert b == c == 1
    ast.parse(text)
    path.write_text(text)
    print(json.dumps({'baseline': APPLICATION + '^', 'web_files': len(filenames),
                      'columns': sum(map(len, expected.values()))}))


if __name__ == '__main__':
    main()
