"""Cryptographic synthetic capability checks without any production material."""
import base64
import hashlib
import hmac
import json
from types import SimpleNamespace
import unittest
from urllib.parse import parse_qs, quote, urlencode, urlsplit

import app_signed_urls as s


OLD = 'synthetic-captured-key-never-log-0123456789'
LOCAL = 'synthetic-local-fresh-key-never-log-0123456789'
PRIVATE = 'PRIVATE_ATTACHMENT_MUST_NOT_APPEAR'
OBJECT = 'docs/folder/' + PRIVATE + '.pdf'
NOW = 2_000_000_000


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def token(claims=None, *, key=OLD, header=None, raw_header=None, raw_claims=None):
    header = {'alg': 'HS256', 'typ': 'JWT'} if header is None else header
    claims = {'url': OBJECT, 'iat': NOW - 60, 'exp': NOW + 600} if claims is None else claims
    encoded = b64(raw_header or json.dumps(header, separators=(',', ':')).encode()) + '.'
    encoded += b64(raw_claims or json.dumps(claims, separators=(',', ':')).encode())
    return encoded + '.' + b64(hmac.digest(key.encode(), encoded.encode(), hashlib.sha256))


def path(value, object_path=OBJECT):
    return '/storage/v1/object/sign/' + quote(object_path, safe='/') + '?token=' + value


class SignedCapabilityTests(unittest.TestCase):
    def setUp(self):
        obj = SimpleNamespace(bucket_id='docs', name='folder/' + PRIVATE + '.pdf', version='version-1')
        self.adapter = s.SignedUrlAdapter(source_secret=OLD, local_secret=LOCAL,
                                          verified_objects={OBJECT: obj})

    def rejected(self, value, *, object_path=OBJECT):
        with self.assertRaises(s.Stop) as raised:
            self.adapter.rewrite('GET', path(value, object_path), now=NOW)
        self.assertEqual(raised.exception.reason_code, 'APP_SIGNED_URL_REJECTED')
        for private in (OLD, LOCAL, PRIVATE, value):
            self.assertNotIn(private, str(raised.exception))

    def test_old_capability_re_signed_without_changing_any_claim_or_header_bytes(self):
        old = token()
        result = self.adapter.rewrite('GET', path(old), now=NOW)
        new = parse_qs(urlsplit(result).query)['token'][0]
        self.assertEqual(old.rsplit('.', 1)[0], new.rsplit('.', 1)[0])
        self.assertNotEqual(old, new)
        expected = b64(hmac.digest(LOCAL.encode(), new.rsplit('.', 1)[0].encode(), hashlib.sha256))
        self.assertEqual(new.rsplit('.', 1)[1], expected)
        self.assertEqual(urlsplit(result).path, urlsplit(path(old)).path)

    def test_modern_download_scope_and_matching_version(self):
        value = token({'url': OBJECT, 'iat': NOW - 1, 'exp': NOW + 1,
                       'scope': 'download', 'versionId': 'version-1'})
        self.assertNotEqual(self.adapter.rewrite('GET', path(value), now=NOW), path(value))

    def test_missing_typ_header_supported(self):
        value = token(header={'alg': 'HS256'})
        self.assertNotEqual(self.adapter.rewrite('GET', path(value), now=NOW), path(value))

    def test_fresh_local_signature_passes_unchanged_including_new_objects(self):
        value = token({'url': 'docs/newly-uploaded.pdf', 'iat': NOW, 'exp': NOW + 1}, key=LOCAL)
        original = path(value, 'docs/newly-uploaded.pdf')
        self.assertEqual(self.adapter.rewrite('GET', original, now=NOW), original)

    def test_storage_still_handles_fresh_local_semantics(self):
        value = token({'url': OBJECT, 'iat': NOW - 5, 'exp': NOW - 1}, key=LOCAL)
        self.assertEqual(self.adapter.rewrite('GET', path(value), now=NOW), path(value))

    def test_non_get_and_non_sign_routes_never_translate(self):
        original = path(token())
        for method in ('POST', 'PUT', 'DELETE', 'HEAD'):
            self.assertEqual(self.adapter.rewrite(method, original, now=NOW), original)
        for route in ['/storage/v1/object/upload/sign/docs/file?token=' + token(),
                      '/storage/v1/object/authenticated/docs/file', '/api/report-api']:
            self.assertEqual(self.adapter.rewrite('GET', route, now=NOW), route)

    def test_tampered_signature_rejected(self):
        self.rejected(token(key='different-key'))

    def test_unsigned_none_and_algorithm_confusion_rejected(self):
        for header in [{'alg': 'none'}, {'alg': 'HS512'}, {'alg': 'RS256'},
                       {'alg': 'HS256', 'kid': 'other'}, {'alg': 'HS256', 'typ': 'OTHER'},
                       {'alg': 'HS256', 'crit': ['b64'], 'b64': False}]:
            with self.subTest(header=header):
                self.rejected(token(header=header))

    def test_payload_path_binding_prevents_other_object_access(self):
        self.rejected(token({'url': 'docs/other.pdf', 'iat': NOW - 1, 'exp': NOW + 1}))
        self.rejected(token(), object_path='docs/other.pdf')

    def test_unverified_captured_object_never_translates(self):
        value = token({'url': 'docs/unverified.pdf', 'iat': NOW - 1, 'exp': NOW + 1})
        self.rejected(value, object_path='docs/unverified.pdf')

    def test_upload_role_and_unknown_claims_rejected(self):
        for addition in [{'scope': 'upload'}, {'scope': None}, {'upsert': False},
                         {'owner': None}, {'role': 'service_role'}, {'transformations': 'width:10'},
                         {'aud': 'authenticated'}, {'versionId': 'other-version'}]:
            claims = {'url': OBJECT, 'iat': NOW - 1, 'exp': NOW + 1, **addition}
            with self.subTest(addition=addition):
                self.rejected(token(claims))

    def test_expiry_and_time_bounds(self):
        for addition in [{'exp': NOW}, {'exp': NOW - 1}, {'exp': '2000000001'},
                         {'exp': True}, {'exp': NOW + .5}, {'iat': NOW + 1},
                         {'iat': -1}, {'iat': None}, {'iat': True},
                         {'nbf': NOW + 1}, {'nbf': None}, {'nbf': False},
                         {'exp': 2 ** 53}]:
            claims = {'url': OBJECT, 'iat': NOW - 1, 'exp': NOW + 10, **addition}
            with self.subTest(addition=addition):
                self.rejected(token(claims))

    def test_missing_iat_or_exp_rejected(self):
        for absent in ('iat', 'exp'):
            claims = {'url': OBJECT, 'iat': NOW - 1, 'exp': NOW + 1}
            del claims[absent]
            self.rejected(token(claims))

    def test_valid_not_before_preserved(self):
        value = token({'url': OBJECT, 'iat': NOW - 60, 'nbf': NOW, 'exp': NOW + 10})
        self.assertNotEqual(self.adapter.rewrite('GET', path(value), now=NOW), path(value))

    def test_duplicate_json_keys_and_non_utf8_json_rejected(self):
        self.rejected(token(raw_header=b'{"alg":"none","alg":"HS256"}'))
        self.rejected(token(raw_claims=(f'{{"url":"{OBJECT}","iat":{NOW-1},"exp":{NOW+1},"exp":{NOW+2}}}').encode()))
        self.rejected(token(raw_claims=json.dumps({'url': OBJECT, 'iat': NOW - 1, 'exp': NOW + 1}).encode('utf-16')))

    def test_noncanonical_base64_and_malformed_token_rejected(self):
        value = token()
        for broken in [value + '=', value + '.extra', value.split('.')[0],
                       '!.!.!', 'x' * 8193, '..', value[:-1]]:
            with self.subTest(length=len(broken)):
                self.rejected(broken)

    def test_duplicate_token_or_unknown_query_rejected(self):
        for query in ['&token=' + token(), '&extra=value', '&download=x&download=y', '&download=%0a']:
            with self.assertRaises(s.Stop):
                self.adapter.rewrite('GET', path(token()) + query, now=NOW)

    def test_download_query_is_preserved(self):
        original = path(token()) + '&' + urlencode({'download': 'name space.pdf'})
        result = self.adapter.rewrite('GET', original, now=NOW)
        self.assertEqual(parse_qs(urlsplit(result).query)['download'], ['name space.pdf'])

    def test_canonical_object_names_and_single_decode(self):
        object_path = 'docs/literal%2e%2e.pdf'
        adapter = s.SignedUrlAdapter(source_secret=OLD, local_secret=LOCAL,
            verified_objects={object_path: SimpleNamespace(bucket_id='docs', name='literal%2e%2e.pdf', version=None)})
        value = token({'url': object_path, 'iat': NOW - 1, 'exp': NOW + 1})
        result = adapter.rewrite('GET', path(value, object_path), now=NOW)
        self.assertIn('literal%252e%252e.pdf', result)

    def test_traversal_fragment_absolute_urls_and_bad_escapes_rejected(self):
        for original in [path(token(), 'docs/../bad'), path(token(), 'docs//bad'),
                         path(token()) + '#fragment', 'https://external' + path(token()),
                         '/storage/v1/object/sign/docs/bad%ZZ?token=' + token(),
                         '/storage/v1/object/sign/docs/bad%ff?token=' + token()]:
            with self.subTest(original=original[:30]), self.assertRaises(s.Stop):
                self.adapter.rewrite('GET', original, now=NOW)

    def test_adapter_repr_has_no_private_material(self):
        for value in (OLD, LOCAL, PRIVATE):
            self.assertNotIn(value, repr(self.adapter))


class SourceConfigTests(unittest.TestCase):
    def context(self, env):
        return {'containers_by_role': {'storage': {'Config': {'Env': env}}}}

    def test_captured_source_alias_and_explicit_algorithm(self):
        for env in [['AUTH_JWT_SECRET=' + OLD], ['PGRST_JWT_SECRET=' + OLD],
                    ['AUTH_JWT_SECRET=' + OLD, 'PGRST_JWT_SECRET=' + OLD,
                     'AUTH_JWT_ALGORITHM=HS256']]:
            self.assertEqual(s.source_secret(self.context(env)), OLD)

    def test_unknown_ambiguous_and_unsupported_source_configuration_rejected(self):
        for env in [[], ['AUTH_JWT_SECRET=' + OLD, 'PGRST_JWT_SECRET=' + LOCAL],
                    ['AUTH_JWT_SECRET=' + OLD, 'AUTH_JWT_SECRET=' + OLD],
                    ['AUTH_JWT_SECRET=' + OLD, 'AUTH_JWT_ALGORITHM=RS256']]:
            with self.assertRaises(s.Stop) as raised:
                s.source_secret(self.context(env))
            self.assertNotIn(OLD, str(raised.exception))

    def test_no_unrotated_key_or_invalid_index(self):
        for source, local, objects in [(OLD, OLD, {}), (OLD, LOCAL, {'docs/x': object()})]:
            with self.assertRaises(s.Stop):
                s.SignedUrlAdapter(source_secret=source, local_secret=local, verified_objects=objects)


if __name__ == '__main__':
    unittest.main()
