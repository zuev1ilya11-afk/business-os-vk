"""Operator entry point for the isolated application check; no downloads."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import uuid


class Stop(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def read_report(path):
    try:
        if path.is_symlink() or path.stat().st_size > 64 * 1024:
            raise Stop('APP_RESTORE_REPORT_INVALID')
        report = json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        raise Stop('APP_RESTORE_REPORT_INVALID') from None
    if (not isinstance(report, dict) or report.get('status') != 'DRILL_COMPLETED'
            or not re.fullmatch(r'[0-9a-f]{64}', str(report.get('source_manifest_sha256', '')))):
        raise Stop('APP_RESTORE_REPORT_INVALID')
    return report


def select_bundle(explicit, report, package_dir):
    """Prefer the operator's E: copy; select only the exact reported manifest."""
    candidates = [Path(explicit)] if explicit else [
        Path('E:/BOS-Backup'), package_dir / 'BOS-Backup',
        package_dir.parent / 'BOS-Backup', Path.home() / 'BOS-Backup',
    ]
    for candidate in candidates:
        manifest = candidate / 'manifest.json'
        try:
            if manifest.is_symlink() or manifest.stat().st_size > 1024 * 1024:
                continue
            digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
        except OSError:
            continue
        if digest == report['source_manifest_sha256']:
            return candidate.resolve()
    raise Stop('APP_MATCHING_BACKUP_NOT_FOUND')


def write_report(path, report):
    """Unique operator file; no overwrite of an earlier report or symlink."""
    encoded = json.dumps(report, ensure_ascii=False, indent=2).encode('utf-8') + b'\n'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(encoded)


def safe_code(error):
    code = getattr(error, 'reason_code', None)
    return code if isinstance(code, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{3,90}', code) else 'APP_LAUNCH_FAILED'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Local Business OS application check')
    parser.add_argument('--bundle')
    parser.add_argument('--report', required=True)
    parser.add_argument('--work-dir', required=True)
    args = parser.parse_args(argv)
    session = None
    report_path = None
    failure = None
    try:
        if os.name != 'nt':
            raise Stop('APP_WINDOWS_LAUNCHER_REQUIRED')
        work = Path(args.work_dir).resolve(strict=True)
        if not work.is_dir() or shutil.disk_usage(work).free < 512 * 1024 * 1024:
            raise Stop('APP_HOST_DISK_SPACE_LOW')
        system_drive = Path(os.environ.get('SystemDrive', 'C:') + '/')
        if shutil.disk_usage(system_drive).free < 1024 * 1024 * 1024:
            raise Stop('APP_SYSTEM_DISK_SPACE_LOW')
        successful = read_report(Path(args.report))
        bundle = select_bundle(args.bundle, successful, work)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        nonce = uuid.uuid4().hex[:8]
        profile = work / ('browser-' + stamp + '-' + nonce)
        report_path = work / ('BOS-App-' + stamp + '-' + nonce + '.json')
        from drill import DockerRunner
        from app import start_app
        print('APP_STAGE=VERIFYING_BASELINE', flush=True)
        session = start_app(bundle, successful, DockerRunner(), profile_dir=profile,
                            progress=lambda stage: print('APP_STAGE=' + stage, flush=True))
        report = dict(session.report)
        report.update({'operator_browser': 'NOT_STARTED', 'application': 'OPERATOR_CHECK_PENDING',
                       'disaster_recovery_ready': False})
        if not session.portal.open_browser():
            raise Stop('APP_ISOLATED_EDGE_UNAVAILABLE')
        report['operator_browser'] = 'ISOLATED_EDGE_OPENED'
        write_report(report_path, report)
        print(json.dumps({'status': 'LOCAL_APP_OPENED', 'url': session.origin,
                          'report': str(report_path), 'disaster_recovery_ready': False}), flush=True)
        print('Keep this window open. Press Ctrl+C here to stop.', flush=True)
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    except Exception as error:
        failure = {'status': 'STOPPED', 'reason': safe_code(error), 'disaster_recovery_ready': False}
        # Orchestrator reports contain only explicitly public-safe aggregates.
        safe_report = getattr(error, 'report', None)
        if type(safe_report) is dict:
            failure['launch'] = safe_report
        if report_path is not None and not report_path.exists():
            try:
                write_report(report_path, failure)
                failure['report'] = str(report_path)
            except OSError:
                pass
        # The file retains all safe per-service evidence. Keep the console
        # compact so the operator can see the stage and report path at once.
        displayed = {key: value for key, value in failure.items() if key != 'launch'}
        if isinstance(safe_report, dict):
            displayed.update({key: safe_report[key] for key in
                ('failed_stage', 'failed_service', 'diagnostics') if key in safe_report})
        print(json.dumps(displayed, ensure_ascii=True), flush=True)
    finally:
        if session is not None:
            try:
                session.stop()
                print('APP_STOPPED=OWN_CONTAINERS_REMOVED_COPY_RETAINED', flush=True)
            except Exception:
                print('APP_STOPPED=CLEANUP_INCOMPLETE', flush=True)
                failure = failure or {'reason': 'APP_CLEANUP_INCOMPLETE'}
    return 1 if failure else 0


if __name__ == '__main__':
    raise SystemExit(main())
