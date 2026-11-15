"""Real Windows filesystem regressions for portable bundle validation.

Run with installed or portable CPython on Windows, without Docker or user data:
    python -m unittest discover -s deploy/recovery -p test_drill_windows.py -v

Only metadata of synthetic temporary files is printed on an unexpected failure.
These tests deliberately do not equate path-stat and descriptor-stat structures:
Windows may represent their mode/identity fields differently for the same file.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import drill_files as d


REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')

FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size',
          'st_mtime_ns', 'st_ctime_ns', 'st_birthtime_ns', 'st_file_attributes')
CONTENT = b'Synthetic Windows recovery validation fixture.\x00\xff\n'


def metadata(value):
    return {field: getattr(value, field) for field in FIELDS
            if isinstance(getattr(value, field, None), int)}


@unittest.skipUnless(os.name == 'nt', 'Real Windows filesystem tests require Windows')
class WindowsBundleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='bos-windows-bundle-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def diagnostic(self, path):
        # The filename, directory, file contents and environment are excluded.
        before = path.lstat()
        with path.open('rb') as stream:
            opened = os.fstat(stream.fileno())
        print('WINDOWS_SYNTHETIC_STAT=' + json.dumps({
            'path_stat': metadata(before), 'descriptor_stat': metadata(opened),
            'path_stat_after': metadata(path.lstat()),
            'different_fields': {field: [getattr(before, field, None), getattr(opened, field, None)]
                                 for field in FIELDS
                                 if getattr(before, field, None) != getattr(opened, field, None)},
            'old_cross_signature_equal': d._signature(before) == d._signature(opened),
            'python': list(sys.version_info[:3]),
        }, sort_keys=True), flush=True)

    def assert_readable(self, path, expected=CONTENT):
        expected_hash = {'bytes': len(expected),
                         'sha256': hashlib.sha256(expected).hexdigest()}
        try:
            self.assertEqual(d._read(path), expected_hash)
            self.assertEqual(d._read(path, collect=True), (expected, expected_hash))
        except Exception:
            self.diagnostic(path)
            raise
        self.assertEqual(path.read_bytes(), expected)

    def test_untouched_json_and_executable_extension_have_correct_hashes(self):
        for name in ('manifest.json', 'file-looking-like.exe'):
            with self.subTest(extension=Path(name).suffix):
                path = self.root / name
                path.write_bytes(CONTENT)
                self.assert_readable(path)

    def test_readonly_file_remains_readonly_and_unchanged(self):
        path = self.root / 'readonly.json'
        path.write_bytes(CONTENT)
        path.chmod(stat.S_IREAD)
        try:
            before = path.lstat()
            self.assertTrue(before.st_file_attributes & stat.FILE_ATTRIBUTE_READONLY)
            self.assert_readable(path)
            self.assertTrue(path.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY)
        finally:
            path.chmod(stat.S_IREAD | stat.S_IWRITE)

    def test_rewritten_file_with_historical_mtime_is_unchanged_while_reading(self):
        path = self.root / 'rewritten.json'
        path.write_bytes(b'initial synthetic bytes')
        path.write_bytes(CONTENT)
        # Reading must not confuse creation/change time after real writes. The
        # deliberate historical mtime also prevents a newly-created-file test
        # from accidentally masking Windows stat/fstat timestamp differences.
        historical_ns = 946684800 * 1_000_000_000
        os.utime(path, ns=(historical_ns, historical_ns))
        self.diagnostic(path)
        self.assert_readable(path)

    def test_descriptor_change_time_drift_is_still_rejected(self):
        path = self.root / 'descriptor-drift.json'
        path.write_bytes(CONTENT)
        original_fstat = os.fstat
        calls = []

        def changing_fstat(fd):
            value = original_fstat(fd)
            calls.append(fd)
            if len(calls) == 2:
                fields = {name: getattr(value, name) for name in dir(value)
                          if name.startswith('st_')}
                fields['st_ctime_ns'] += 1
                return types.SimpleNamespace(**fields)
            return value

        with patch.object(d.os, 'fstat', side_effect=changing_fstat):
            with self.assertRaises(d.Stop) as raised:
                d._read(path)
        self.assertEqual(raised.exception.reason_code, 'BUNDLE_CHANGED')
        self.assertGreaterEqual(len(calls), 2)

    def test_in_place_change_between_open_and_check_is_detected_or_denied(self):
        path = self.root / 'changing.json'
        path.write_bytes(CONTENT)
        original_open = os.open
        state = {'attempted': False, 'changed': False, 'write_denied': False}

        def opening(value, flags, *args, **kwargs):
            fd = original_open(value, flags, *args, **kwargs)
            if Path(value) == path and not state['attempted']:
                state['attempted'] = True
                try:
                    # No timing race: mutate after the reader opens its handle
                    # but before its first fstat. A locked Windows handle may
                    # correctly refuse this competing write instead.
                    with path.open('ab') as output:
                        output.write(b'changed')
                    state['changed'] = True
                except PermissionError:
                    state['write_denied'] = True
            return fd

        with patch.object(d.os, 'open', side_effect=opening):
            try:
                result = d._read(path)
            except d.Stop as exc:
                self.assertEqual(exc.reason_code, 'BUNDLE_CHANGED')
                self.assertTrue(state['changed'])
            else:
                self.assertTrue(state['write_denied'])
                self.assertEqual(result['sha256'], hashlib.sha256(CONTENT).hexdigest())
        self.assertTrue(state['attempted'])

    def test_replaced_path_with_same_bytes_and_mtime_is_detected(self):
        path = self.root / 'replaced.json'
        replacement = self.root / 'replacement.json'
        previous = self.root / 'original.json'
        path.write_bytes(CONTENT)
        replacement.write_bytes(CONTENT)
        before = path.stat()
        os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
        original_open = os.open
        changed = []

        def opening(value, flags, *args, **kwargs):
            if Path(value) == path and not changed:
                # Keep the old inode alive, preventing immediate identity reuse.
                os.replace(path, previous)
                os.replace(replacement, path)
                changed.append(True)
            return original_open(value, flags, *args, **kwargs)

        with patch.object(d.os, 'open', side_effect=opening):
            with self.assertRaises(d.Stop) as raised:
                d._read(path)
        self.assertTrue(changed)
        self.assertEqual(raised.exception.reason_code, 'BUNDLE_CHANGED')
        self.assertEqual(path.read_bytes(), CONTENT)
        self.assertEqual(previous.read_bytes(), CONTENT)

    def test_complete_synthetic_bundle_validates_without_modification(self):
        # Reuse the existing offline fixture, not its mocked filesystem tests.
        from test_drill_files import PortableBundleTests
        fixture = PortableBundleTests('test_valid_bundle_is_read_only_and_does_not_claim_object_layout')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        before = {p.name: p.read_bytes() for p in fixture.bundle.iterdir()}
        try:
            result = d.validate_bundle(fixture.bundle)
        except Exception:
            self.diagnostic(fixture.bundle / 'manifest.json')
            raise
        self.assertEqual(result['file_count'], 1)
        self.assertEqual(result['storage_layout_status'],
                         'ARCHIVE_ROOT_VERIFIED_OBJECT_LAYOUT_UNVERIFIED')
        self.assertEqual({p.name: p.read_bytes() for p in fixture.bundle.iterdir()}, before)


if __name__ == '__main__':
    if REQUIRE and os.name != 'nt':
        raise RuntimeError('Windows tests were required but this host is not Windows')
    unittest.main(verbosity=2)
