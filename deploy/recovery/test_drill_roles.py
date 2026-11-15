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

    def test_supabase_parameter_acl_is_preserved_and_not_a_membership(self):
        parameter_acl = (b'GRANT SET ON PARAMETER log_min_messages '
                         b'TO supabase_realtime_admin;\n')
        memberships = (b'GRANT anon TO postgres WITH ADMIN OPTION, INHERIT TRUE '
                       b'GRANTED BY supabase_admin;\n')
        raw = self.example('supabase_admin') + memberships + parameter_acl
        original = raw
        result = drill_roles.source_bootstrap(raw)
        a, b = result['create_span']
        self.assertEqual('supabase_admin', result['role'])
        self.assertEqual(b'CREATE ROLE supabase_admin;', raw[a:b])
        self.assertEqual(original, raw)
        self.assertIn(parameter_acl, raw[:a] + raw[b:])
        self.assertIn(memberships, raw[:a] + raw[b:])

    def test_canonical_parameter_acl_options_and_quoted_identifiers(self):
        acls = [
            b'REVOKE ALL ON PARAMETER log_min_messages FROM PUBLIC;',
            b'GRANT SET, ALTER SYSTEM ON PARAMETER log_min_messages TO member;',
            b'GRANT ALTER SYSTEM, SET ON PARAMETER log_min_messages TO member;',
            b'GRANT ALL PRIVILEGES ON PARAMETER log_min_messages TO member WITH GRANT OPTION;',
            b'REVOKE GRANT OPTION FOR ALTER SYSTEM ON PARAMETER log_min_messages FROM member;',
            b'GRANT SET ON PARAMETER "app.test" TO "member ";',
            b'GRANT SET ON PARAMETER "GRANT x TO y GRANTED BY fake;" TO member;',
        ]
        for acl in acls:
            with self.subTest(acl=acl):
                raw = self.example() + acl
                result = drill_roles.source_bootstrap(raw)
                a, b = result['create_span']
                self.assertEqual('postgres', result['role'])
                self.assertIn(acl, raw[:a] + raw[b:])

    def test_parameter_acls_do_not_supply_missing_or_ambiguous_bootstrap(self):
        acl = b'GRANT SET ON PARAMETER log_min_messages TO member;\n'
        bad = [b'CREATE ROLE postgres;\n' + acl,
               self.example() + acl + b'GRANT team TO member GRANTED BY another;\n']
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaises(drill_roles.Stop):
                drill_roles.source_bootstrap(raw)

    def test_unknown_or_malformed_parameter_acls_still_fail_closed(self):
        bad = [
            b'GRANT EXECUTE ON PARAMETER log_min_messages TO member;',
            b'GRANT SET ON PARAMETER TO member;',
            b'GRANT SET ON PARAMETER log_min_messages TO;',
            b'GRANT SET ON PARAMETER log_min_messages TO member WITH ADMIN OPTION;',
            b'GRANT SET ON PARAMETER log_min_messages TO member trailing;',
            b'GRANT SET, SET ON PARAMETER log_min_messages TO member;',
            b'REVOKE SET ON PARAMETER log_min_messages TO member;',
            b'REVOKE SET ON PARAMETER log_min_messages FROM;',
            b'REVOKE ADMIN OPTION FOR SET ON PARAMETER log_min_messages FROM member;',
            b'GRANT SET ON PARAMETERS log_min_messages TO member;',
        ]
        for acl in bad:
            with self.subTest(acl=acl), self.assertRaises(drill_roles.Stop):
                drill_roles.source_bootstrap(self.example() + acl)

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
