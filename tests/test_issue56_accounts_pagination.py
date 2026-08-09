from __future__ import annotations

import unittest
import time
import uuid
from unittest import mock

from tests._import_app import clear_login_attempts, import_web_app_module


class Issue56AccountsPaginationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = import_web_app_module()
        cls.app = cls.module.app

    def setUp(self):
        with self.app.app_context():
            clear_login_attempts()

    def _login(self, client):
        resp = client.post("/login", json={"password": "testpass123"})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

    def _db(self):
        return self.module.create_sqlite_connection()

    def _create_group(self, name: str | None = None) -> int:
        unique = uuid.uuid4().hex
        group_name = name or f"issue56_group_{unique}"
        conn = self._db()
        try:
            cur = conn.execute(
                """
                INSERT INTO groups (name, description, color, proxy_url, is_system)
                VALUES (?, ?, ?, ?, 0)
                """,
                (group_name, "issue56 pagination test group", "#2E6B8A", ""),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()

    def _create_account(
        self,
        *,
        group_id: int,
        email_addr: str,
        remark: str = "",
        last_refresh_at: str = "",
        latest_email_from: str = "",
    ) -> int:
        unique = uuid.uuid4().hex
        conn = self._db()
        try:
            cur = conn.execute(
                """
                INSERT INTO accounts (
                    email, password, client_id, refresh_token, group_id, remark, status, last_refresh_at,
                    latest_email_from
                )
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
                """,
                (
                    email_addr,
                    "",
                    f"cid_{unique}",
                    f"rt_{unique}",
                    group_id,
                    remark,
                    last_refresh_at,
                    latest_email_from,
                ),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()

    def _create_tag(self, name: str | None = None) -> int:
        unique = uuid.uuid4().hex
        tag_name = name or f"issue56_tag_{unique}"
        conn = self._db()
        try:
            cur = conn.execute("INSERT INTO tags (name, color) VALUES (?, ?)", (tag_name, "#B85C38"))
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()

    def _attach_tag(self, account_id: int, tag_id: int) -> None:
        conn = self._db()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (?, ?)",
                (account_id, tag_id),
            )
            conn.commit()
        finally:
            conn.close()

    def test_accounts_api_returns_pagination_metadata_and_page_slice(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group()
        for index in range(55):
            self._create_account(group_id=group_id, email_addr=f"issue56_page_{index:03d}@example.com")

        resp = client.get(f"/api/accounts?group_id={group_id}&page=2&page_size=20")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        pagination = data.get("pagination") or {}
        self.assertEqual(pagination.get("page"), 2)
        self.assertEqual(pagination.get("page_size"), 20)
        self.assertEqual(pagination.get("total_count"), 55)
        self.assertEqual(pagination.get("total_pages"), 3)
        self.assertEqual(len(data.get("accounts") or []), 20)

    def test_accounts_api_search_is_scoped_to_requested_group(self):
        client = self.app.test_client()
        self._login(client)
        group_a = self._create_group(name="issue56_scope_a")
        group_b = self._create_group(name="issue56_scope_b")

        target_email = f"scope_a_{uuid.uuid4().hex}@example.com"
        other_email = f"scope_b_{uuid.uuid4().hex}@example.com"
        self._create_account(group_id=group_a, email_addr=target_email, remark="shared-search-key")
        self._create_account(group_id=group_b, email_addr=other_email, remark="shared-search-key")

        resp = client.get(f"/api/accounts?group_id={group_a}&search=shared-search-key&page=1&page_size=50")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        accounts = data.get("accounts") or []
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0].get("email"), target_email)
        self.assertEqual(accounts[0].get("group_id"), group_a)
        self.assertEqual((data.get("pagination") or {}).get("total_count"), 1)

    def test_accounts_api_search_without_group_id_is_global(self):
        """不带 group_id 的 search 应跨全部分组返回匹配账号。"""
        client = self.app.test_client()
        self._login(client)
        group_a = self._create_group(name="issue56_global_a")
        group_b = self._create_group(name="issue56_global_b")

        marker = f"global-search-{uuid.uuid4().hex}"
        email_a = f"global_a_{uuid.uuid4().hex}@example.com"
        email_b = f"global_b_{uuid.uuid4().hex}@example.com"
        self._create_account(group_id=group_a, email_addr=email_a, remark=marker)
        self._create_account(group_id=group_b, email_addr=email_b, remark=marker)

        resp = client.get(f"/api/accounts?search={marker}&page=1&page_size=50")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        accounts = data.get("accounts") or []
        emails = {account.get("email") for account in accounts}
        self.assertIn(email_a, emails)
        self.assertIn(email_b, emails)
        self.assertGreaterEqual((data.get("pagination") or {}).get("total_count"), 2)

        group_ids = {account.get("group_id") for account in accounts if account.get("email") in {email_a, email_b}}
        self.assertEqual(group_ids, {group_a, group_b})

        # all-ids 在无 group_id 时同样应跨分组
        ids_resp = client.get(f"/api/accounts/all-ids?search={marker}")
        self.assertEqual(ids_resp.status_code, 200)
        ids_data = ids_resp.get_json() or {}
        self.assertEqual(ids_data.get("success"), True)
        self.assertGreaterEqual(int(ids_data.get("total_count") or 0), 2)

    def test_accounts_api_sender_filter_supports_has_and_not_has_with_group_scope(self):
        client = self.app.test_client()
        self._login(client)
        group_a = self._create_group(name="issue56_sender_a")
        group_b = self._create_group(name="issue56_sender_b")

        matched_email = f"sender_match_{uuid.uuid4().hex}@example.com"
        unmatched_email = f"sender_unmatched_{uuid.uuid4().hex}@example.com"
        other_group_email = f"sender_other_{uuid.uuid4().hex}@example.com"
        self._create_account(group_id=group_a, email_addr=matched_email, latest_email_from="alerts@example.com")
        self._create_account(group_id=group_a, email_addr=unmatched_email, latest_email_from="billing@example.com")
        self._create_account(group_id=group_b, email_addr=other_group_email, latest_email_from="alerts@example.com")

        resp = client.get(f"/api/accounts?group_id={group_a}&sender=alerts&page=1&page_size=50")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)
        accounts = data.get("accounts") or []
        self.assertEqual([account.get("email") for account in accounts], [matched_email])
        self.assertEqual((data.get("pagination") or {}).get("total_count"), 1)

        not_has_resp = client.get(
            f"/api/accounts?group_id={group_a}&sender=alerts&sender_match=not_has&page=1&page_size=50"
        )
        self.assertEqual(not_has_resp.status_code, 200)
        not_has_data = not_has_resp.get_json() or {}
        self.assertEqual(not_has_data.get("success"), True)
        not_has_accounts = not_has_data.get("accounts") or []
        self.assertEqual([account.get("email") for account in not_has_accounts], [unmatched_email])

        ids_resp = client.get(f"/api/accounts/all-ids?group_id={group_a}&sender=alerts")
        self.assertEqual(ids_resp.status_code, 200)
        ids_data = ids_resp.get_json() or {}
        self.assertEqual(ids_data.get("success"), True)
        self.assertEqual(int(ids_data.get("total_count") or 0), 1)

    def test_sender_match_task_fetches_group_accounts_and_reports_progress(self):
        client = self.app.test_client()
        self._login(client)
        group_a = self._create_group(name="issue56_sender_task_a")
        group_b = self._create_group(name="issue56_sender_task_b")

        matched_id = self._create_account(
            group_id=group_a,
            email_addr=f"sender_task_match_{uuid.uuid4().hex}@example.com",
            latest_email_from="alerts@example.com",
        )
        unmatched_id = self._create_account(
            group_id=group_a,
            email_addr=f"sender_task_unmatched_{uuid.uuid4().hex}@example.com",
            latest_email_from="billing@example.com",
        )
        other_group_id = self._create_account(
            group_id=group_b,
            email_addr=f"sender_task_other_{uuid.uuid4().hex}@example.com",
            latest_email_from="alerts@example.com",
        )

        from outlook_web.controllers import accounts as accounts_controller

        seen_tops = []

        def fake_fetch(account_id: int, *, top: int = 20):
            seen_tops.append(top)
            account = accounts_controller.accounts_repo.get_account_by_id(int(account_id)) or {}
            return {
                "account_id": int(account_id),
                "email": account.get("email") or "",
                "success": True,
                "folders": {"test": {"success": True, "emails": [{"from": account.get("latest_email_from") or ""}]}},
            }

        with mock.patch.object(accounts_controller, "_fetch_account_messages_for_sender_match", side_effect=fake_fetch):
            resp = client.post(
                "/api/accounts/sender-match/start",
                json={"group_id": group_a, "sender": "alerts", "sender_match": "has", "top": 3},
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json() or {}
            self.assertEqual(data.get("success"), True)
            self.assertEqual(data.get("total"), 2)
            self.assertEqual(data.get("top"), 3)
            task_id = data.get("task_id")
            self.assertTrue(task_id)

            final_data = data
            for _ in range(30):
                status_resp = client.get(f"/api/accounts/sender-match/status/{task_id}?page=1&page_size=50")
                self.assertEqual(status_resp.status_code, 200)
                final_data = status_resp.get_json() or {}
                if final_data.get("status") == "completed":
                    break
                time.sleep(0.05)

        self.assertEqual(final_data.get("status"), "completed")
        self.assertEqual(final_data.get("total"), 2)
        self.assertEqual(final_data.get("top"), 3)
        self.assertEqual(final_data.get("matched_count"), 1)
        self.assertEqual(final_data.get("failed_count"), 0)
        self.assertEqual(set(final_data.get("matched_account_ids") or []), {matched_id})
        self.assertNotIn(unmatched_id, final_data.get("matched_account_ids") or [])
        self.assertNotIn(other_group_id, final_data.get("matched_account_ids") or [])
        self.assertEqual(seen_tops, [3, 3])
        accounts = final_data.get("accounts") or []
        self.assertEqual([account.get("id") for account in accounts], [matched_id])
        self.assertEqual((final_data.get("pagination") or {}).get("total_count"), 1)

    def test_sender_match_task_can_stop_and_continue(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group(name="issue56_sender_task_control")
        matched_ids = [
            self._create_account(
                group_id=group_id,
                email_addr=f"sender_task_control_{index}_{uuid.uuid4().hex}@example.com",
                latest_email_from="alerts@example.com",
            )
            for index in range(5)
        ]

        from outlook_web.controllers import accounts as accounts_controller

        def slow_fetch(account_id: int, *, top: int = 20):
            time.sleep(0.05)
            account = accounts_controller.accounts_repo.get_account_by_id(int(account_id)) or {}
            return {
                "account_id": int(account_id),
                "email": account.get("email") or "",
                "success": True,
                "folders": {"test": {"success": True, "emails": [{"from": account.get("latest_email_from") or ""}]}},
            }

        with mock.patch.object(accounts_controller, "_fetch_account_messages_for_sender_match", side_effect=slow_fetch):
            resp = client.post(
                "/api/accounts/sender-match/start",
                json={"group_id": group_id, "sender": "alerts", "sender_match": "has"},
            )
            self.assertEqual(resp.status_code, 200)
            task_id = (resp.get_json() or {}).get("task_id")
            self.assertTrue(task_id)

            pause_resp = client.post(f"/api/accounts/sender-match/control/{task_id}", json={"action": "pause"})
            self.assertEqual(pause_resp.status_code, 200)
            pause_data = pause_resp.get_json() or {}
            self.assertEqual(pause_data.get("status"), "paused")

            time.sleep(0.12)
            paused_resp = client.get(f"/api/accounts/sender-match/status/{task_id}?page=1&page_size=50")
            self.assertEqual(paused_resp.status_code, 200)
            paused_data = paused_resp.get_json() or {}
            self.assertEqual(paused_data.get("status"), "paused")

            continue_resp = client.post(f"/api/accounts/sender-match/control/{task_id}", json={"action": "continue"})
            self.assertEqual(continue_resp.status_code, 200)
            continue_data = continue_resp.get_json() or {}
            self.assertEqual(continue_data.get("status"), "running")

            final_data = continue_data
            for _ in range(40):
                status_resp = client.get(f"/api/accounts/sender-match/status/{task_id}?page=1&page_size=50")
                self.assertEqual(status_resp.status_code, 200)
                final_data = status_resp.get_json() or {}
                if final_data.get("status") == "completed":
                    break
                time.sleep(0.05)

        self.assertEqual(final_data.get("status"), "completed")
        self.assertEqual(final_data.get("matched_count"), len(matched_ids))
        self.assertEqual(set(final_data.get("matched_account_ids") or []), set(matched_ids))

    def test_sender_match_task_stop_ends_task(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group(name="issue56_sender_task_stop")
        for index in range(3):
            self._create_account(
                group_id=group_id,
                email_addr=f"sender_task_stop_{index}_{uuid.uuid4().hex}@example.com",
                latest_email_from="alerts@example.com",
            )

        from outlook_web.controllers import accounts as accounts_controller

        def slow_fetch(account_id: int, *, top: int = 20):
            time.sleep(0.1)
            account = accounts_controller.accounts_repo.get_account_by_id(int(account_id)) or {}
            return {
                "account_id": int(account_id),
                "email": account.get("email") or "",
                "success": True,
                "folders": {"test": {"success": True, "emails": [{"from": account.get("latest_email_from") or ""}]}},
            }

        with mock.patch.object(accounts_controller, "_fetch_account_messages_for_sender_match", side_effect=slow_fetch):
            resp = client.post(
                "/api/accounts/sender-match/start",
                json={"group_id": group_id, "sender": "alerts", "sender_match": "has"},
            )
            self.assertEqual(resp.status_code, 200)
            task_id = (resp.get_json() or {}).get("task_id")
            self.assertTrue(task_id)

            stop_resp = client.post(f"/api/accounts/sender-match/control/{task_id}", json={"action": "stop"})
            self.assertEqual(stop_resp.status_code, 200)
            stop_data = stop_resp.get_json() or {}
            self.assertEqual(stop_data.get("status"), "stopped")

    def test_accounts_api_supports_tag_filter_and_email_sort(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group()
        tag_id = self._create_tag(name="issue56-filter")

        account_c = self._create_account(group_id=group_id, email_addr=f"c_{uuid.uuid4().hex}@example.com")
        account_b = self._create_account(group_id=group_id, email_addr=f"b_{uuid.uuid4().hex}@example.com")
        self._create_account(group_id=group_id, email_addr=f"a_{uuid.uuid4().hex}@example.com")
        self._attach_tag(account_c, tag_id)
        self._attach_tag(account_b, tag_id)

        resp = client.get(
            f"/api/accounts?group_id={group_id}&tag_id={tag_id}&sort_by=email&sort_order=desc&page=1&page_size=50"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        accounts = data.get("accounts") or []
        self.assertEqual(len(accounts), 2)
        emails = [account.get("email") for account in accounts]
        self.assertEqual(emails, sorted(emails, reverse=True))
        self.assertEqual((data.get("pagination") or {}).get("total_count"), 2)

    def test_accounts_api_clamps_page_to_last_available_page(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group()
        for index in range(21):
            self._create_account(group_id=group_id, email_addr=f"issue56_clamp_{index:03d}@example.com")

        resp = client.get(f"/api/accounts?group_id={group_id}&page=99&page_size=10")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        pagination = data.get("pagination") or {}
        self.assertEqual(pagination.get("page"), 3)
        self.assertEqual(pagination.get("total_pages"), 3)
        self.assertEqual(len(data.get("accounts") or []), 1)

    def test_accounts_api_falls_back_to_default_refresh_time_sort_for_invalid_sort_params(self):
        client = self.app.test_client()
        self._login(client)
        group_id = self._create_group()
        newest_email = f"issue56_sort_new_{uuid.uuid4().hex}@example.com"
        middle_email = f"issue56_sort_mid_{uuid.uuid4().hex}@example.com"
        oldest_email = f"issue56_sort_old_{uuid.uuid4().hex}@example.com"
        newest = self._create_account(
            group_id=group_id,
            email_addr=newest_email,
            last_refresh_at="2026-05-01 12:00:00",
        )
        middle = self._create_account(
            group_id=group_id,
            email_addr=middle_email,
            last_refresh_at="2026-05-01 11:00:00",
        )
        oldest = self._create_account(
            group_id=group_id,
            email_addr=oldest_email,
            last_refresh_at="2026-05-01 10:00:00",
        )

        self.assertTrue(all(account_id > 0 for account_id in [newest, middle, oldest]))

        resp = client.get(f"/api/accounts?group_id={group_id}&sort_by=unexpected&sort_order=unexpected&page=1&page_size=50")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json() or {}
        self.assertEqual(data.get("success"), True)

        emails = [account.get("email") for account in (data.get("accounts") or [])]
        self.assertGreaterEqual(len(emails), 3)
        self.assertEqual(
            emails[:3],
            [
                oldest_email,
                middle_email,
                newest_email,
            ],
        )
