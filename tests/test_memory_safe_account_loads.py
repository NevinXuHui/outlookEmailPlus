"""百万账号场景：禁止全表 hydrate 的关键路径回归。"""

from __future__ import annotations

import unittest
import uuid
from unittest.mock import patch

from tests.test_external_api import ExternalApiBaseTest


class MemorySafeAccountLoadTests(ExternalApiBaseTest):
    def test_oauth_account_summaries_skip_decrypt(self):
        email_addr = self._insert_outlook_account()
        with self.app.app_context():
            from outlook_web.repositories import accounts as accounts_repo
            from outlook_web.security import crypto

            with patch.object(crypto, "decrypt_data", side_effect=AssertionError("must not decrypt")):
                rows = accounts_repo.load_oauth_account_summaries()

        self.assertTrue(any(r.get("email") == email_addr for r in rows))
        sample = next(r for r in rows if r.get("email") == email_addr)
        self.assertEqual(set(sample.keys()), {"id", "email", "status", "account_type"})

    def test_notification_sources_only_load_participants(self):
        enabled_email = self._insert_outlook_account()
        disabled_email = self._insert_outlook_account()
        with self.app.app_context():
            from outlook_web.db import get_db
            from outlook_web.repositories import accounts as accounts_repo
            from outlook_web.services import notification_dispatch as nd

            db = get_db()
            db.execute(
                "UPDATE accounts SET telegram_push_enabled = 1 WHERE email = ?",
                (enabled_email,),
            )
            db.execute(
                "UPDATE accounts SET telegram_push_enabled = 0 WHERE email = ?",
                (disabled_email,),
            )
            db.commit()

            with patch.object(
                accounts_repo,
                "load_accounts",
                side_effect=AssertionError("load_accounts must not be used"),
            ):
                sources = nd.list_email_notification_sources()

        emails = {s.get("email") for s in sources if s.get("source_type") == "account"}
        self.assertIn(enabled_email, emails)
        self.assertNotIn(disabled_email, emails)

    def test_export_batches_do_not_call_load_accounts(self):
        email_addr = self._insert_outlook_account()
        with self.app.app_context():
            from outlook_web.controllers import accounts as accounts_ctrl
            from outlook_web.repositories import accounts as accounts_repo

            with patch.object(
                accounts_repo,
                "load_accounts",
                side_effect=AssertionError("load_accounts must not be used for export"),
            ):
                rows = accounts_ctrl._collect_export_accounts_batched()

        self.assertTrue(any(r.get("email") == email_addr for r in rows))

    def tearDownClass(cls):
    # clean test DB
    with cls.app.app_context():
        from outlook_web.db import get_db
        db = get_db()
        db.execute("DELETE FROM accounts WHERE email LIKE '%@extapi.test' OR email LIKE '%@outlook.com'")
        db.commit()



if __name__ == "__main__":
    unittest.main()
