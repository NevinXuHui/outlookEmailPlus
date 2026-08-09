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
        self.assertIn("const ACCOUNT_SEARCH_SCOPE_GROUP = 'group';", groups_js)
        self.assertIn("const ACCOUNT_SEARCH_SCOPE_GLOBAL = 'global';", groups_js)
        self.assertIn("let currentAccountSearchScope = ACCOUNT_SEARCH_SCOPE_GLOBAL;", groups_js)
        self.assertIn("function setAccountSearchScope(scope", groups_js)
        self.assertIn("function updateAccountSearchScopeControls()", groups_js)
        self.assertIn("GLOBAL_ACCOUNT_LIST_KEY", groups_js)
        self.assertIn("全局邮箱搜索不带 group_id", groups_js)
        self.assertIn("全局邮箱搜索时不传 group_id", groups_js)
        self.assertIn("当前分组搜索/发件人筛选/浏览时使用指定分组", groups_js)
        self.assertIn("async function searchAccounts(query)", groups_js)
        self.assertIn("clearGlobalAccountListCache()", groups_js)
        self.assertIn("updateAccountListHeaderForSearch()", groups_js)
        self.assertIn("currentAccountSearchScope === ACCOUNT_SEARCH_SCOPE_GLOBAL", groups_js)
        self.assertIn("&& hasAccountSearchQuery()", groups_js)
        self.assertIn("&& !hasAccountSenderFilter();", groups_js)

        # 全局搜索模式有搜索词时不应强制要求已选分组
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
        self.assertIn('id="accountSearchScopeGroup"', index_html)
        self.assertIn('id="accountSearchScopeGlobal"', index_html)
        self.assertIn('id="compactAccountSearchScopeGroup"', index_html)
        self.assertIn('id="compactAccountSearchScopeGlobal"', index_html)
        self.assertIn("setAccountSearchScope('group')", index_html)
        self.assertIn("setAccountSearchScope('global')", index_html)
        self.assertIn("全局搜索邮箱…", index_html)
        self.assertIn("搜索当前分组邮箱…", groups_js)
        self.assertIn("'全局搜索邮箱…'", i18n_js)
        self.assertIn("'搜索当前分组邮箱…'", i18n_js)
        self.assertIn("'当前分组'", i18n_js)
        self.assertIn("'仅在当前分组搜索邮箱'", i18n_js)
        self.assertIn("'跨全部分组搜索邮箱'", i18n_js)
        self.assertIn("'全局搜索'", i18n_js)
        self.assertIn("'已选择搜索结果中所有 ${totalSelected} 个邮箱'", i18n_js)
        self.assertIn("function syncGlobalSearchInputs(value)", groups_js)
        self.assertIn("compactGlobalSearch", groups_js)

    def test_search_and_sender_filters_drive_group_id_and_cache_key(self):
        groups_js = self._read("static/js/features/groups.js")

        self.assertIn(
            "currentAccountSearchScope === ACCOUNT_SEARCH_SCOPE_GLOBAL",
            groups_js,
        )
        self.assertIn("&& hasAccountSearchQuery()", groups_js)
        self.assertIn("&& !hasAccountSenderFilter();", groups_js)
        self.assertIn(
            "return isGlobalAccountSearchActive() ? GLOBAL_ACCOUNT_LIST_KEY : groupId;",
            groups_js,
        )
        self.assertIn(
            "if (!isGlobalAccountSearchActive() && groupId !== null && groupId !== undefined) {\n                params.set('group_id', String(groupId));\n            }",
            groups_js,
        )
        self.assertIn(
            "if (!isGlobalAccountSearchActive() && currentGroupId !== null && currentGroupId !== undefined) {\n                params.set('group_id', String(currentGroupId));\n            }",
            groups_js,
        )
        self.assertIn(
            "if (!isGlobalAccountSearchActive() && (currentGroupId === null || currentGroupId === undefined)) {\n                showSelectGroupForAccountFilter();\n                return;\n            }",
            groups_js,
        )
        self.assertIn("button.disabled = senderFilterActive && scope === ACCOUNT_SEARCH_SCOPE_GLOBAL;", groups_js)

    def test_sender_filter_is_available_in_standard_and_compact_modes(self):
        groups_js = self._read("static/js/features/groups.js")
        index_html = self._read("templates/index.html")
        main_js = self._read("static/js/main.js")
        i18n_js = self._read("static/js/i18n.js")

        self.assertIn("let currentAccountSenderQuery = '';", groups_js)
        self.assertIn("let currentAccountSenderMatch = 'has';", groups_js)
        self.assertIn("let currentAccountSenderTop = 20;", groups_js)
        self.assertIn("function hasAccountSenderFilter()", groups_js)
        self.assertIn("function filterAccountsBySender(query)", groups_js)
        self.assertIn("function setAccountSenderMatch(value)", groups_js)
        self.assertIn("function setAccountSenderTop(value)", groups_js)
        self.assertIn("function normalizeAccountSenderTop(value)", groups_js)
        self.assertIn("top: normalizeAccountSenderTop(currentAccountSenderTop)", groups_js)
        self.assertIn("normalizeAccountSenderTop(task.top || currentAccountSenderTop)", groups_js)
        self.assertIn("params.set('sender', normalizedSender);", groups_js)
        self.assertIn("params.set('sender_match', currentAccountSenderMatch === 'not_has' ? 'not_has' : 'has');", groups_js)
        self.assertIn("发件人筛选仅查当前分组的完整分页结果", groups_js)
        self.assertIn("function startAccountSenderMatchTask()", groups_js)
        self.assertIn("function pollAccountSenderMatchTaskStatus()", groups_js)
        self.assertIn("function renderAccountSenderMatchProgress(task = {})", groups_js)
        self.assertIn("function renderAccountSenderMatchSnapshot(data", groups_js)
        self.assertIn("function controlAccountSenderMatchTask(action)", groups_js)
        self.assertIn("'/api/accounts/sender-match/start'", groups_js)
        self.assertIn("`/api/accounts/sender-match/status/${taskId}?page=${currentAccountPage || 1}&page_size=${ACCOUNT_PAGE_SIZE}`", groups_js)
        self.assertIn("`/api/accounts/sender-match/control/${accountSenderMatchTaskId}`", groups_js)
        self.assertIn("renderAccountSenderMatchSnapshot(data)", groups_js)
        self.assertIn("onclick=\"controlAccountSenderMatchTask('pause')\"", groups_js)
        self.assertIn("onclick=\"controlAccountSenderMatchTask('continue')\"", groups_js)
        self.assertIn("onclick=\"controlAccountSenderMatchTask('stop')\"", groups_js)
        self.assertIn("isAccountSenderMatchResultActive()", groups_js)
        self.assertIn("params.set('page', String(page || 1));", groups_js)
        self.assertIn("params.set('page_size', String(ACCOUNT_PAGE_SIZE));", groups_js)
        self.assertIn("return accountSenderMatchMatchedIds.slice();", groups_js)
        self.assertIn('id="accountSenderFilter"', index_html)
        self.assertIn('id="compactAccountSenderFilter"', index_html)
        self.assertIn('id="accountSenderMatchMode"', index_html)
        self.assertIn('id="compactAccountSenderMatchMode"', index_html)
        self.assertIn('id="accountSenderTop"', index_html)
        self.assertIn('id="compactAccountSenderTop"', index_html)
        self.assertIn('min="1" max="100" value="20"', index_html)
        self.assertIn("逐个拉取当前分组邮件并按发件人筛选", index_html)
        self.assertIn("'accountSenderFilter', 'compactAccountSenderFilter'", main_js)
        self.assertIn("'accountSenderMatchMode', 'compactAccountSenderMatchMode'", main_js)
        self.assertIn("'accountSenderTop', 'compactAccountSenderTop'", main_js)
        self.assertIn("setAccountSenderTop(e.target.value)", main_js)
        self.assertIn("'发件人筛选…'", i18n_js)
        self.assertIn("'发件人筛选固定当前分组'", i18n_js)
        self.assertIn("'每个文件夹拉取最新几封邮件'", i18n_js)
        self.assertIn("'最新'", i18n_js)
        self.assertIn("'封'", i18n_js)
        self.assertIn("'正在逐个拉取邮件匹配…'", i18n_js)
        self.assertIn("'已暂停，等待继续'", i18n_js)
        self.assertIn("'暂停'", i18n_js)
        self.assertIn("'停止'", i18n_js)
        self.assertIn("'继续'", i18n_js)
        self.assertIn("'有匹配'", i18n_js)

    def test_compact_mode_respects_global_search_cache_key(self):
        compact_js = self._read("static/js/features/mailbox_compact.js")
        index_html = self._read("templates/index.html")
        main_js = self._read("static/js/main.js")
        self.assertIn("resolveAccountListCacheKey", compact_js)
        self.assertIn("isGlobalAccountSearchActive", compact_js)
        self.assertIn("globalSearch", compact_js)
        self.assertIn("未找到匹配的邮箱", compact_js)
        self.assertIn("group_name", compact_js)
        # 简洁模式必须有独立搜索入口，并与标准模式共用绑定
        self.assertIn('id="compactGlobalSearch"', index_html)
        self.assertIn("compact-global-search", index_html)
        self.assertIn("compactAccountSearchScopeGroup", index_html)
        self.assertIn("updateAccountSearchScopeControls()", main_js)
        self.assertIn("'compactGlobalSearch'", main_js)


if __name__ == "__main__":
    unittest.main()
