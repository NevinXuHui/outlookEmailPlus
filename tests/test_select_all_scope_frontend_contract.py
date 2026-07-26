"""前端契约：分组全选支持「当前页 / 全部」范围选择。"""

from __future__ import annotations

import re
import unittest

from tests._import_app import clear_login_attempts, import_web_app_module


class SelectAllScopeFrontendContractTests(unittest.TestCase):
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
        self.assertTrue(resp.get_json().get("success"))

    def _get_text(self, client, path: str) -> str:
        resp = client.get(path)
        try:
            return resp.data.decode("utf-8")
        finally:
            resp.close()

    def test_index_html_has_select_all_scope_menu_in_standard_and_compact(self):
        client = self.app.test_client()
        self._login(client)
        html = self._get_text(client, "/")

        self.assertIn('id="selectAllCheckbox"', html)
        self.assertIn('id="selectAllMenu"', html)
        self.assertIn('id="compactSelectAllCheckbox"', html)
        self.assertIn('id="compactSelectAllMenu"', html)
        self.assertIn("selectAllAccountsOnPage()", html)
        self.assertIn("selectAllAccountsInGroup()", html)
        self.assertRegex(html, re.compile(r">\s*当前页\s*<"))
        self.assertRegex(html, re.compile(r'onclick="toggleSelectAll\(event\)"'))

    def test_groups_js_exposes_page_and_all_select_functions(self):
        client = self.app.test_client()
        js = self._get_text(client, "/static/js/features/groups.js")

        self.assertIn("function selectAllAccountsOnPage()", js)
        self.assertIn("async function selectAllAccountsInGroup()", js)
        self.assertIn("function toggleSelectAll(event)", js)
        self.assertIn("openSelectAllMenu()", js)
        self.assertIn("selectedAccountIds.clear()", js)
        self.assertIn("已选择当前页 ${pageSelected} 个邮箱", js)

    def test_i18n_contains_select_all_scope_keys(self):
        client = self.app.test_client()
        js = self._get_text(client, "/static/js/i18n.js")
        for key in [
            "'当前页': 'This page'",
            "'全部': 'All'",
            "'选择范围：当前页或全部': 'Selection scope: this page or all'",
            "'已选择当前页 ${pageSelected} 个邮箱': 'Selected ${pageSelected} accounts on this page'",
            "'当前页暂无可选邮箱': 'No selectable accounts on this page'",
        ]:
            self.assertIn(key, js)


if __name__ == "__main__":
    unittest.main()
