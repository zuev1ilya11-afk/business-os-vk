import unittest
import drill_roles


class BootstrapInferenceTests(unittest.TestCase):
    def example(self, role='postgres'):
        return (f'CREATE ROLE {role};\nALTER ROLE {role} WITH SUPERUSER LOGIN;\n'
                f'CREATE ROLE team;\nCREATE ROLE member;\n'
                f'GRANT team TO member WITH INHERIT TRUE GRANTED BY {role};\n').encode()

    def test_preserves_original_bytes_and_returns_exact_create_span(self):
        raw = b'-- metadata\n\\restrict A12b\n' + self.example() + b'\\unrestrict A12b\n'
        result = drill_roles.source_bootstrap(raw)
        a, b = result['create_span']
        self.assertEqual('postgres', result['role'])
        self.assertEqual(b'CREATE ROLE postgres;', raw[a:b])
        self.assertIn(b'GRANTED BY postgres;', raw[:a] + raw[b:])

    def test_quoted_configuration_and_comments_cannot_forge_grantor(self):
        fake = (b"ALTER ROLE member SET application_name TO 'line\nCREATE ROLE intruder;\n"
                b"GRANT team TO member GRANTED BY intruder;\n';\n"
                b"COMMENT ON ROLE member IS E'backslash\\\' ; GRANT X TO Y;';\n"
                b'/* GRANT fake TO fake GRANTED BY fake; /* nested */ */\n')
        raw = self.example('supabase_admin') + fake
        result = drill_roles.source_bootstrap(raw)
        a, b = result['create_span']
        self.assertEqual('supabase_admin', result['role'])
        self.assertIn(fake, raw[:a] + raw[b:])

    def test_utf8_before_create_keeps_byte_offsets(self):
        raw = '-- Проверка\n'.encode() + self.example()
        a, b = drill_roles.source_bootstrap(raw)['create_span']
        self.assertEqual(b'CREATE ROLE postgres;', raw[a:b])

    def test_quoted_basic_bootstrap_and_all_membership_options(self):
        raw = (b'CREATE ROLE "postgres";\n'
               b'GRANT team TO member WITH ADMIN TRUE, INHERIT FALSE, SET TRUE GRANTED BY "postgres";\n')
        self.assertEqual('postgres', drill_roles.source_bootstrap(raw)['role'])

    def test_ambiguous_missing_and_unknown_grants_fail_closed(self):
        bad = [b'CREATE ROLE postgres;',
               self.example() + b'GRANT team TO member GRANTED BY another;\n',
               self.example() + b'GRANT ALL ON TABLESPACE other TO member;\n',
               self.example() + b'REVOKE team FROM member;\n',
               self.example() + b'CREATE ROLE postgres;\n',
               self.example().replace(b'GRANTED BY postgres', b'GRANTED BY unknown'),
               self.example() + b"COMMENT ON ROLE member IS 'unterminated;",
               self.example() + b'\\connect other\n']
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaises(drill_roles.Stop):
                drill_roles.source_bootstrap(raw)


if __name__ == '__main__':
    unittest.main()
