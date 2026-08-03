from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GlobalAccountSearchFrontendContractTests(unittest.TestCase):
    def _read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_search_accounts_uses_global_scope_without_group_id(self):
        groups_js = self._read("static/js/features/groups.js")
        index_html = self._read("templates/index.html")
        i18n_js = self._read("static/js/i18n.js")

        self.assertIn("function isGlobalAccountSearchActive()", groups_js)
        self.assertIn("GLOBAL_ACCOUNT_LIST_KEY", groups_js)
        self.assertIn("全局搜索时不带 group_id", groups_js)
        self.assertIn("全局搜索时不传 group_id", groups_js)
        self.assertIn("async function searchAccounts(query)", groups_js)
        self.assertIn("clearGlobalAccountListCache()", groups_js)
        self.assertIn("updateAccountListHeaderForSearch()", groups_js)

        # 有搜索词时不应强制要求已选分组
        self.assertNotIn(
            "if (!currentGroupId) {\n                return;\n            }",
            groups_js.split("async function searchAccounts(query)")[1].split("async function updateGroupSelects")[0],
        )

        # 结果卡片在全局搜索时展示所属分组
        self.assertIn("所属分组", groups_js)
        self.assertIn("acc.group_name", groups_js)

        # 搜索框文案提示全局搜索（标准模式 + 简洁模式都有入口）
        self.assertIn('id="globalSearch"', index_html)
        self.assertIn('id="compactGlobalSearch"', index_html)
        self.assertIn("全局搜索邮箱…", index_html)
        self.assertIn("'全局搜索邮箱…'", i18n_js)
        self.assertIn("'全局搜索'", i18n_js)
        self.assertIn("'已选择搜索结果中所有 ${totalSelected} 个邮箱'", i18n_js)
        self.assertIn("function syncGlobalSearchInputs(value)", groups_js)
        self.assertIn("compactGlobalSearch", groups_js)

    def test_compact_mode_respects_global_search_cache_key(self):
        compact_js = self._read("static/js/features/mailbox_compact.js")
        index_html = self._read("templates/index.html")
        main_js = self._read("static/js/main.js")
        self.assertIn("resolveAccountListCacheKey", compact_js)
        self.assertIn("isGlobalAccountSearchActive", compact_js)
        self.assertIn("未找到匹配的邮箱", compact_js)
        self.assertIn("group_name", compact_js)
        # 简洁模式必须有独立搜索入口，并与标准模式共用绑定
        self.assertIn('id="compactGlobalSearch"', index_html)
        self.assertIn("compact-global-search", index_html)
        self.assertIn("'compactGlobalSearch'", main_js)


if __name__ == "__main__":
    unittest.main()
