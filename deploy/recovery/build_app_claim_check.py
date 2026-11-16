"""Reproducible read-only diagnostic for the already-running Windows clone."""
import hashlib
from pathlib import Path
import re
import zipfile

import build_app_flow_check as flow_build
import build_app_login_diagnostic as login_build

ROOT = Path(__file__).resolve().parent
FILES = ('bos-claim-check.pyz', 'check-claim.ps1', 'check-claim.cmd', 'CLAIM-CHECK-README.txt')
DELIVERY = 'BOS-Claim-Check-20261116.zip'


def build():
    items = {name: (ROOT/name).read_bytes() for name in login_build.MODULES}
    for name in ('app_flow_check.py', 'app_plan.py', 'app_claim_check.py'):
        items[name] = (ROOT/name).read_bytes()
    items['__main__.py'] = b'import app_claim_check\nraise SystemExit(app_claim_check.main())\n'
    package = ROOT/FILES[0]
    flow_build.write_zip(package, items)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    template = (ROOT/'check-flow.ps1').read_text()
    template, count = re.subn(r"(?m)^\$PackageSha256 = '[^']*'", "$PackageSha256 = '"+digest+"'", template)
    assert count == 1
    template = template.replace('bos-flow-check.pyz', FILES[0]).replace(" '--resume-latest'", '').replace('FLOW_', 'CLAIM_')
    (ROOT/'check-claim.ps1').write_text(template, encoding='utf-8', newline='\n')
    flow_build.write_zip(ROOT/DELIVERY, {name: (ROOT/name).read_bytes() for name in FILES}, zipfile.ZIP_DEFLATED)
    return digest


if __name__ == '__main__':
    print(build())
