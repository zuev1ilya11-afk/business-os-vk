"""Finish a fully written private partial without recapturing live services."""
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import unittest
from unittest import mock

import test_backup as fixture

b = fixture.b


class FinishTests(unittest.TestCase):
    setUp = fixture.CaptureTests.setUp

    def staged(self, suffix='000000000001', timestamp='20261115T090419Z'):
        completed = b.capture(self.layout, self.output, self.runner)
        partial = self.output / ('.capture-' + timestamp + '-' + suffix + '.partial')
        completed.rename(partial)
        final = self.output / partial.name[1:-len('.partial')]
        return partial, final

    def test_finish_existing_bundle_without_any_live_call_preserves_capture_interval(self):
        partial, final = self.staged()
        before = {p.name: p.read_bytes() for p in partial.iterdir()}
        with mock.patch.object(b, 'LocalDocker', side_effect=AssertionError('No Docker allowed')), \
                mock.patch.object(b.discovery, 'discover', side_effect=AssertionError('No discovery allowed')):
            result = b.finish_latest(self.output)
        self.assertEqual(result, final)
        self.assertFalse(partial.exists())
        self.assertEqual({p.name: p.read_bytes() for p in final.iterdir()}, before)
        verified = b.verify(final)
        self.assertEqual(verified['integrity'], 'VERIFIED')
        self.assertEqual(verified['restore'], 'NOT_RUN')
        self.assertFalse(verified['disaster_recovery_ready'])
        self.assertEqual(stat.S_IMODE(final.stat().st_mode), 0o700)

    def test_latest_incomplete_partial_does_not_fall_back_to_older_valid_copy(self):
        older, older_final = self.staged()
        latest = self.output / '.capture-20261115T100000Z-000000000002.partial'
        latest.mkdir(mode=0o700)
        with self.assertRaises((b.Stop, OSError)):
            b.finish_latest(self.output)
        self.assertTrue(older.is_dir())
        self.assertTrue(latest.is_dir())
        self.assertFalse(older_final.exists())

    def test_latest_corrupt_payload_is_not_promoted(self):
        partial, final = self.staged()
        (partial / 'database.dump').write_bytes(b'PGDMP corrupted bytes')
        with self.assertRaises(b.Stop):
            b.finish_latest(self.output)
        self.assertTrue(partial.is_dir())
        self.assertFalse(final.exists())

    def test_missing_manifest_is_not_reconstructed(self):
        partial, final = self.staged()
        (partial / 'manifest.json').unlink()
        with self.assertRaises((b.Stop, OSError)):
            b.finish_latest(self.output)
        self.assertFalse((partial / 'manifest.json').exists())
        self.assertFalse(final.exists())

    def test_final_collision_never_overwrites_existing_copy(self):
        partial, final = self.staged()
        final.mkdir(mode=0o700)
        (final / 'sentinel').write_bytes(b'existing copy')
        with self.assertRaises(b.Stop):
            b.finish_latest(self.output)
        self.assertTrue(partial.is_dir())
        self.assertEqual((final / 'sentinel').read_bytes(), b'existing copy')

    def test_no_partial_leaves_existing_completed_copy_untouched(self):
        final = b.capture(self.layout, self.output, self.runner)
        before = {p.name: p.read_bytes() for p in final.iterdir()}
        with self.assertRaises(b.Stop):
            b.finish_latest(self.output)
        self.assertEqual({p.name: p.read_bytes() for p in final.iterdir()}, before)

    def test_nonprivate_partial_is_not_promoted(self):
        partial, final = self.staged()
        partial.chmod(0o755)
        with self.assertRaisesRegex(b.Stop, 'PRIVATE_DIRECTORY_REQUIRED'):
            b.finish_latest(self.output)
        self.assertTrue(partial.is_dir())
        self.assertFalse(final.exists())

    def test_unrecognized_partial_name_is_ignored(self):
        partial, final = self.staged()
        renamed = self.output / '.capture-not-a-package.partial'
        partial.rename(renamed)
        with self.assertRaisesRegex(b.Stop, 'PARTIAL_NOT_FOUND'):
            b.finish_latest(self.output)
        self.assertTrue(renamed.is_dir())
        self.assertFalse(final.exists())

    def test_latest_symlink_never_promotes_target_or_older_partial(self):
        older, older_final = self.staged()
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        (outside / 'sentinel').write_bytes(b'outside')
        link = self.output / '.capture-20261115T100000Z-000000000002.partial'
        link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(b.Stop):
            b.finish_latest(self.output)
        self.assertTrue(link.is_symlink())
        self.assertTrue(older.exists())
        self.assertFalse(older_final.exists())
        self.assertEqual((outside / 'sentinel').read_bytes(), b'outside')

    def test_parent_fsync_failure_returns_to_partial_without_claiming_success(self):
        partial, final = self.staged()
        real_fsync = os.fsync
        failed = False

        def fail_after_rename(fd):
            nonlocal failed
            if final.exists() and not partial.exists() and not failed:
                failed = True
                raise OSError('synthetic durability failure')
            return real_fsync(fd)

        with mock.patch.object(b.os, 'fsync', side_effect=fail_after_rename):
            with self.assertRaisesRegex(b.Stop, 'FINALIZE_DURABILITY_UNCONFIRMED'):
                b.finish_latest(self.output)
        self.assertTrue(failed)
        self.assertTrue(partial.is_dir())
        self.assertFalse(final.exists())
        with self.assertRaisesRegex(b.Stop, 'PARTIAL_BUNDLE'):
            b.verify(partial)

    def test_cli_reports_verified_archive_with_original_readiness_limits(self):
        _, final = self.staged()
        stream = io.StringIO()
        previous = os.umask(0o077)
        try:
            with mock.patch.object(b, 'LocalDocker', side_effect=AssertionError('No Docker allowed')), \
                    contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
                code = b.main(['finish-latest', '--output', str(self.output)])
        finally:
            os.umask(previous)
        self.assertNotIn(fixture.SECRET, stream.getvalue())
        result = json.loads(stream.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(result['capture'], 'COMPLETE')
        self.assertEqual(result['bundle'], str(final))
        self.assertEqual(result['integrity'], 'VERIFIED')
        self.assertEqual(result['independent_copy'], 'NOT_VERIFIED')
        self.assertEqual(result['restore'], 'NOT_RUN')
        self.assertFalse(result['disaster_recovery_ready'])


if __name__ == '__main__':
    unittest.main()
