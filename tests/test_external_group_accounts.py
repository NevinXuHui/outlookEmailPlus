import sqlite3
import unittest
from unittest.mock import patch
from flask import Flask
from outlook_web.controllers import account_groups as api


class ExternalGroupAccountsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE accounts(id INTEGER,email TEXT,group_id INTEGER,account_type TEXT,provider TEXT,status TEXT,client_id TEXT,refresh_token TEXT)')
        for row in [(1,'one@hotmail.com',183,'outlook','outlook','active','client-secret','token-secret'),
                    (2,'two@hotmail.com',183,'outlook','outlook','active','client-secret','token-secret'),
                    (3,'wrong@hotmail.com',1,'outlook','outlook','active','client-secret','token-secret'),
                    (4,'inactive@hotmail.com',183,'outlook','outlook','inactive','client-secret','token-secret'),
                    (5,'empty@hotmail.com',183,'outlook','outlook','active','client-secret',''),
                    (6,'temp@other.com',183,'outlook','skymail','active','client-secret','token-secret')]:
            self.db.execute('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)',row)
        self.app = Flask(__name__)
        self.app.add_url_rule('/group', view_func=api.api_external_group_accounts.__wrapped__.__wrapped__)
        self.client = self.app.test_client()
        for name, value in [('get_db',self.db), ('_check_pool_access',None), ('_check_pool_external_enabled',None),
                            ('get_external_api_consumer',{}), ('_audit',None)]:
            p=patch.object(api,name,return_value=value);p.start();self.addCleanup(p.stop)

    def test_reads_selected_group_without_upstream_probes_or_credentials(self):
        with patch.object(api.external_api_service,'probe_account_upstream',side_effect=AssertionError('upstream probe')):
            response=self.client.get('/group?group_id=183&limit=1')
        self.assertEqual(response.status_code,200)
        data=response.json['data']
        self.assertEqual(data['total'],2)
        self.assertEqual(data['next_cursor'],1)
        self.assertEqual([x['email'] for x in data['accounts']],['one@hotmail.com'])
        self.assertNotIn('secret',response.get_data(as_text=True))
        second=self.client.get('/group?group_id=183&limit=1&after_id=1').json['data']
        self.assertEqual([x['email'] for x in second['accounts']],['two@hotmail.com'])
        self.assertIsNone(second['next_cursor'])

    def test_allowed_email_scope_applies_to_items_and_count(self):
        with patch.object(api,'get_external_api_consumer',return_value={'allowed_emails':['TWO@hotmail.com']}):
            data=self.client.get('/group?group_id=183').json['data']
        self.assertEqual(data['total'],1)
        self.assertEqual([x['email'] for x in data['accounts']],['two@hotmail.com'])

    def test_empty_group_and_invalid_parameters(self):
        self.assertEqual(self.client.get('/group?group_id=999').json['data']['accounts'],[])
        for query in ['group_id=0','group_id=-1','group_id=oops','limit=501','limit=0','after_id=-1']:
            self.assertEqual(self.client.get('/group?'+query).status_code,400)

    def test_pool_access_rejection_is_preserved(self):
        with patch.object(api,'_check_pool_access',return_value=('denied',403)):
            self.assertEqual(self.client.get('/group?group_id=183').status_code,403)


if __name__=='__main__':unittest.main()
