"""Exercise diagnostic parsing and comparisons without network or Docker."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('bundle_diff', Path(__file__).with_name('bundle-diff.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


def uint(value):
    return struct.pack('>I', value)


def string(value):
    data = value.encode()
    return uint(len(data)) + data


def fixture(*, magic=b'ESZIP2.2', reverse=False, code=b'function reviewReport(){}',
            map_text=b'{"version":3}', root='file:///bos-src/', version='2.57.4', checksum=1):
    if magic in (b'ESZIP_V2', b'ESZIP2.1'):
        checksum = 1
    digest = lambda body: hashlib.sha256(body).digest() if checksum == 1 else b''
    section = lambda body: uint(len(body)) + body + digest(body)
    items = [(root + 'order-lifecycle-api/index.ts', code, map_text, 0),
             (root + 'order-payroll.js', b'const payroll=1;', b'', 0),
             (root + 'empty.json', b'', b'', 1)]
    if reverse:
        items.reverse()
    header, sources, maps = b'', b'', b''
    for name, body, source_map, kind in items:
        offset = len(sources) if body else 0
        map_offset = len(maps) if source_map else 0
        header += string(name) + b'\0' + uint(offset) + uint(len(body)) + uint(map_offset) + uint(len(source_map)) + bytes([kind])
        if body:
            sources += body + digest(body)
        if source_map:
            maps += source_map + digest(source_map)
    header += string(root + 'redirect.ts') + b'\1' + string(root + 'order-lifecycle-api/index.ts')
    npm = b''
    if magic != b'ESZIP_V2':
        header += string('@supabase/supabase-js@2') + b'\2' + uint(0)
        npm = section(string('@supabase/supabase-js@' + version) + uint(0))
    options = section(bytes([0, checksum])) if magic in (b'ESZIP2.2', b'ESZIP2.3') else b''
    return magic + options + section(header) + npm + uint(len(sources)) + sources + uint(len(maps)) + maps


class BundleDiffTests(unittest.TestCase):
    def test_all_documented_versions_parse_empty_modules_redirects_and_npm(self):
        for magic in d.MAGICS:
            with self.subTest(magic=magic):
                parsed = d.parse(fixture(magic=magic))
                self.assertEqual(len(parsed['modules']), 3)
                self.assertEqual(len(parsed['redirects']), 1)
                self.assertTrue(parsed['checksums_verified'])
                self.assertEqual(parsed['trailer'], b'')
                self.assertEqual(bool(parsed['npm']), magic != b'ESZIP_V2')

    def test_different_serialization_order_has_identical_code_and_graph(self):
        a, b = fixture(), fixture(reverse=True)
        self.assertNotEqual(a, b)
        report = d.comparison(d.parse(a), d.parse(b))
        self.assertTrue(report['all_module_content_equal'])
        self.assertTrue(report['specifier_sets_equal'])
        self.assertTrue(report['npm_graph_equal'])
        self.assertTrue(report['entrypoint_code_equal'])
        self.assertEqual(report['changed_modules'], [])

    def test_source_code_change_is_distinguished_from_metadata(self):
        report = d.comparison(d.parse(fixture()), d.parse(fixture(code=b'function reviewReport(){throw Error()}')))
        self.assertFalse(report['all_module_content_equal'])
        self.assertFalse(report['entrypoint_code_equal'])
        self.assertEqual(report['changed_modules'], ['order-lifecycle-api/index.ts'])

    def test_build_path_difference_is_separate_from_equal_code(self):
        report = d.comparison(d.parse(fixture()), d.parse(fixture(root='file:///original-build/')))
        self.assertTrue(report['all_module_content_equal'])
        self.assertFalse(report['specifier_sets_equal'])
        self.assertFalse(report['entrypoint_path_equal'])
        self.assertTrue(report['entrypoint_code_equal'])

    def test_dependency_version_change_is_reported(self):
        report = d.comparison(d.parse(fixture()), d.parse(fixture(version='2.58.0')))
        self.assertFalse(report['npm_graph_equal'])
        self.assertEqual(report['packages_removed'], ['@supabase/supabase-js@2.57.4'])
        self.assertEqual(report['packages_added'], ['@supabase/supabase-js@2.58.0'])

    def test_source_map_change_does_not_masquerade_as_code_change(self):
        report = d.comparison(d.parse(fixture()), d.parse(fixture(map_text=b'{"version":3,"file":"different"}')))
        self.assertTrue(report['all_module_content_equal'])
        self.assertFalse(report['source_maps_equal'])

    def test_corrupt_source_checksum_fails(self):
        broken = fixture().replace(b'const payroll=1;', b'const payroll=2;')
        with self.assertRaises(d.InvalidBundle):
            d.parse(broken)

    def test_truncation_is_rejected(self):
        data = fixture()
        for length in (0, 7, 10, 100, len(data) - 1):
            with self.subTest(length=length), self.assertRaises(d.InvalidBundle):
                d.parse(data[:length])

    def test_no_checksum_is_not_claimed_verified(self):
        self.assertFalse(d.parse(fixture(checksum=0))['checksums_verified'])

    def test_unknown_trailer_is_reported_and_not_discarded(self):
        report = d.comparison(d.parse(fixture()), d.parse(fixture() + b'unknown runtime data'))
        self.assertFalse(report['trailer_equal'])
        self.assertGreater(report['trailer_sizes'][1], 0)

    def test_url_only_frontend_changes_preserve_distinction_from_other_code(self):
        old = b"fetch('https://old.example/api/proxy/report-api')"
        new = b"fetch('https://new.example/functions/v1/report-api')"
        self.assertEqual(d.frontend_kind(old, new), 'URL_ONLY')
        self.assertEqual(d.frontend_kind(old, new + b';doMore()'), 'CODE_DIFFERS')
        self.assertEqual(d.frontend_kind(old, old + b'\n'), 'EXACT')

    def test_unknown_names_are_not_exposed_in_diagnostic(self):
        secret = 'https://user:credential@example.test/?token=secret'
        self.assertNotIn('credential', d.module_label(secret))
        self.assertNotIn('secret', d.package_label(secret))


if __name__ == '__main__':
    unittest.main()
