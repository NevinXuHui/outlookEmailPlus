import unittest
from tests import test_external_pool


class ProjectAvailabilityTests(unittest.TestCase):
    setUpClass = classmethod(test_external_pool.ExternalPoolApiTests.setUpClass.__func__)
    _auth_headers = staticmethod(test_external_pool.ExternalPoolApiTests._auth_headers)
    _set_external_api_key = test_external_pool.ExternalPoolApiTests._set_external_api_key
    _create_external_api_key = test_external_pool.ExternalPoolApiTests._create_external_api_key
    _make_group = test_external_pool.ExternalPoolApiTests._make_group
    _insert_pool_account = test_external_pool.ExternalPoolApiTests._insert_pool_account

    def clear_test_usage(self):
        with self.app.app_context():
            from outlook_web.db import get_db
            db = get_db()
            db.execute("DELETE FROM account_project_usage WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@extpool.test')")
            db.commit()

    def setUp(self):
        self.clear_test_usage()
        test_external_pool.ExternalPoolApiTests.setUp(self)

    def tearDown(self):
        self.clear_test_usage()
        super().tearDown()

    def enable_pool(self):
        self._set_external_api_key('abc123')
        with self.app.app_context():
            from outlook_web.repositories import settings
            settings.set_setting('pool_external_enabled', 'true')

    def add_usage(self, account_id, project, success, consumer='worker'):
        with self.app.app_context():
            from outlook_web.db import get_db
            db = get_db()
            db.execute('''INSERT INTO account_project_usage
                (account_id, consumer_key, project_key, first_claimed_at, last_claimed_at, success_count)
                VALUES (?, ?, ?, '2026-01-01', '2026-01-01', ?)''',
                (account_id, consumer, project, success))
            db.commit()

    def test_counts_match_project_provider_status_and_success_exclusion(self):
        self.enable_pool()
        group, _ = self._make_group(name_prefix='ProjectRemaining')
        self._insert_pool_account(group_id=group)
        duck = self._insert_pool_account(group_id=group)
        kiro = self._insert_pool_account(group_id=group)
        failed = self._insert_pool_account(group_id=group)
        repeated = self._insert_pool_account(group_id=group)
        self._insert_pool_account(group_id=group, provider='other-provider')
        self._insert_pool_account(group_id=group, pool_status='claimed')
        disabled = self._insert_pool_account(group_id=group)
        with self.app.app_context():
            from outlook_web.db import get_db
            db = get_db()
            db.execute("UPDATE accounts SET status='disabled' WHERE id=?", (disabled,))
            db.commit()
        self.add_usage(duck, 'duckmail', 1)
        self.add_usage(kiro, 'kiro', 1)
        self.add_usage(failed, 'duckmail', 0)
        self.add_usage(repeated, 'duckmail', 1)
        self.add_usage(repeated, 'duckmail', 1, consumer='another-worker')
        for project, expected in [('duckmail', 3), ('kiro', 4), ("unknown' OR 1=1 --", 5)]:
            response = self.app.test_client().get('/api/external/pool/availability',
                query_string={'provider': 'outlook', 'project_key': project}, headers=self._auth_headers())
            self.assertEqual(response.status_code, 200)
            data = response.get_json()['data']
            self.assertEqual(data['project_key'], project)
            selected = next(row for row in data['groups'] if row['id'] == group)
            self.assertEqual(selected['claimable_count'], expected)
            self.assertEqual(set(selected), {'id', 'name', 'claimable_count'})

    def test_requires_auth_and_pool_access_and_a_valid_scope(self):
        self.enable_pool()
        client = self.app.test_client()
        path = '/api/external/pool/availability'
        self.assertEqual(client.get(path).status_code, 401)
        for query in ({}, {'provider': 'outlook'}, {'provider': 'outlook', 'project_key': 'x' * 129}):
            self.assertEqual(client.get(path, query_string=query, headers=self._auth_headers()).status_code, 400)
        self._create_external_api_key('availability-no-pool', 'no-pool', pool_access=False)
        self.assertEqual(client.get(path, query_string={'provider': 'outlook', 'project_key': 'duckmail'},
            headers=self._auth_headers('no-pool')).status_code, 403)
        with self.app.app_context():
            from outlook_web.repositories import settings
            settings.set_setting('pool_external_enabled', 'false')
        self.assertEqual(client.get(path, query_string={'provider': 'outlook', 'project_key': 'duckmail'},
            headers=self._auth_headers()).status_code, 403)
