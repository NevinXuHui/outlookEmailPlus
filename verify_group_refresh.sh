#!/bin/bash

echo "========================================"
echo "验证分组批量刷新Token功能集成"
echo "========================================"

# 检查前端UI
echo -e "\n[1] 检查前端UI..."
if grep -q "refreshCurrentGroupTokens" templates/index.html; then
    echo "✓ index.html - 刷新Token按钮已添加"
else
    echo "✗ index.html - 缺少刷新Token按钮"
    exit 1
fi

# 检查JavaScript函数
echo -e "\n[2] 检查JavaScript函数..."
if grep -q "async function refreshCurrentGroupTokens" static/js/main.js; then
    echo "✓ main.js - refreshCurrentGroupTokens() 函数已添加"
else
    echo "✗ main.js - 缺少 refreshCurrentGroupTokens() 函数"
    exit 1
fi

# 验证函数关键逻辑
echo -e "\n[3] 验证函数逻辑..."

# 检查分组验证
if grep -q "if (!currentGroupId)" static/js/main.js; then
    echo "✓ 包含分组验证逻辑"
else
    echo "✗ 缺少分组验证逻辑"
    exit 1
fi

# 检查临时邮箱分组处理
if grep -q "isTempMailboxGroup" static/js/main.js | grep -q "refreshCurrentGroupTokens" static/js/main.js; then
    echo "✓ 包含临时邮箱分组判断"
else
    echo "✗ 缺少临时邮箱分组判断"
    exit 1
fi

# 检查API调用
if grep -A 20 "refreshCurrentGroupTokens" static/js/main.js | grep -q "/api/accounts/all-ids"; then
    echo "✓ 调用正确的API端点获取账号ID"
else
    echo "✗ API端点调用不正确"
    exit 1
fi

# 检查确认对话框
if grep -A 40 "async function refreshCurrentGroupTokens" static/js/main.js | grep -q "confirm"; then
    echo "✓ 包含确认对话框"
else
    echo "✗ 缺少确认对话框"
    exit 1
fi

# 检查批量刷新调用
if grep -A 45 "async function refreshCurrentGroupTokens" static/js/main.js | grep -q "batchRefreshSelected"; then
    echo "✓ 正确调用 batchRefreshSelected() 执行刷新"
else
    echo "✗ 未正确调用批量刷新函数"
    exit 1
fi

# 检查后端API端点
echo -e "\n[4] 检查后端API端点..."
if grep -q "api_get_all_account_ids_in_group" outlook_web/controllers/accounts.py; then
    echo "✓ 后端API端点存在"
else
    echo "✗ 后端API端点不存在"
    exit 1
fi

# 检查按钮位置
echo -e "\n[5] 验证按钮布局..."
if grep -B 2 -A 2 "refreshCurrentGroupTokens" templates/index.html | grep -q "showAnomaliesCheckbox"; then
    echo "✓ 按钮位置正确（在异常筛选附近）"
else
    echo "✗ 按钮位置可能不正确"
    exit 1
fi

echo -e "\n========================================"
echo "✅ 所有检查通过！功能已成功集成"
echo "========================================"
echo -e "\n功能说明："
echo "  • 位置：账号列表工具栏，异常筛选和全选之间"
echo "  • 功能：一键刷新当前分组所有账号的Token"
echo "  • 特性："
echo "    - 自动验证分组类型"
echo "    - 显示确认对话框"
echo "    - SSE流式显示进度"
echo "    - 自动跳过IMAP账号"
echo "    - 刷新完成后自动更新列表"
echo -e "\n测试建议："
echo "  1. 启动应用并登录"
echo "  2. 选择一个包含Outlook账号的分组"
echo "  3. 点击工具栏的 🔄 刷新Token 按钮"
echo "  4. 确认对话框并观察进度Toast"
echo "  5. 验证刷新完成后列表自动更新"
echo ""
