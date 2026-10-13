"""Refresh the comparison inventory; keep older evidence explicitly labelled."""
from pathlib import Path
import csv, hashlib, json, subprocess

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
git = lambda *args: subprocess.check_output(['git', *args], cwd=root).decode().strip()
head = git('rev-parse', 'HEAD')
rows = json.loads((out / 'screen-comparison.json').read_text())
captures = []
for name in ['master', 'dispatcher', 'management', 'shared']:
    captures.extend(json.loads((out / name / 'capture-manifest.json').read_text()))
valid = [r for r in captures if r.get('synthetic') and r['state'] != 'capture-gap']
for row in rows:
    matches = [r for r in valid if r['role'] == row['role'] and r['screen'] == row['screen']
               and r['width'] == 390 and not r['state'].startswith(('synthetic-fixture-menu', 'synthetic-fixture-scrolled', 'synthetic-fixture-long', 'synthetic-fixture-secondary'))]
    if row['screen'] == 'push':
        matches = [r for r in matches if r['state'] == 'synthetic-fixture-default']
    if not matches:
        continue
    r = matches[-1]
    row.update(implementation=r['path'], captureCommit=r['commit'], runtimeBuild=r.get('observedBuild'), freshCapture=True,
               status='Свежий снимок; функциональная проверка текущего интерфейса')
    if row['screen'] == 'profile':
        row.update(difference='Удалены повторные рабочие переходы и дубли настроек; сохранены личные данные, справка и исходные обработчики.',
                   reason='Одна функция — один основной экран. Начисления мастера раскрываются через «Подробнее»; рабочие разделы доступны из основной навигации.')
(out / 'screen-comparison.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
with (out / 'screen-comparison.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
proof = json.loads((out / 'protected-proof.json').read_text())
proof['head'] = head
for check in proof['protectedChecks']:
    now = (root / check['file']).read_bytes()
    before = subprocess.check_output(['git', 'show', proof['base'] + ':' + check['file']], cwd=root)
    if check.get('scope'):
        now, before = [b.split(b'window.openMasterAccrualsV130=')[0] for b in (now, before)]
    check['unchanged'] = now == before
    check['sha256'] = hashlib.sha256(now).hexdigest()
proof['unexpectedChanges'] = [x['file'] for x in proof['protectedChecks'] if not x['unchanged']]
(out / 'protected-proof.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')
summary = dict(contractRows=len(rows), freshContractRows=sum(x['freshCapture'] for x in rows),
    captures=len(valid), uniqueCapturedScreens=len({(x['role'], x['screen']) for x in valid}),
    gaps=[x for x in captures if x['state']=='capture-gap'],
    consoleErrorCaptures=sum(bool(x.get('consoleErrors') or x.get('pageErrors')) for x in valid),
    overflowCaptures=sum(any(v > 1 for v in x.get('overflow', {}).values()) for x in valid),
    missingPairs=[x['role']+'/'+x['screen'] for x in rows if not Path(x['approved']).exists() or not Path(x['implementation']).exists()],
    protectedChecks=len(proof['protectedChecks']), unexpectedProtectedChanges=proof['unexpectedChanges'])
(out / 'evidence-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(summary, ensure_ascii=False))
