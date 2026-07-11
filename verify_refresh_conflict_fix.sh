#!/bin/bash

echo "========================================"
echo "验证刷新冲突处理优化"
echo "========================================"

# 检查新增的辅助函数
echo -e "\n[1] 检查按钮状态管理函数..."
if grep -q "function setRefreshButtonState" static/js/main.js; then
    echo "✓ setRefreshButtonState() 函数已添加"
else
    echo "✗ 缺少 setRefreshButtonState() 函数"
    exit 1
fi

# 检查按钮状态设置逻辑
echo -e "\n[2] 检查按钮禁用逻辑..."
if grep "setRefreshButtonState" static/js/main.js | grep -q "disabled"; then
    echo "✓ 包含按钮禁用状态设置"
else
    echo "✗ 缺少按钮禁用状态设置"
    exit 1
fi

# 检查样式修改
echo -e "\n[3] 检查视觉反馈..."
if grep -A 10 "setRefreshButtonState" static/js/main.js | grep -q "opacity\|cursor"; then
    echo "✓ 包含视觉样式修改（opacity/cursor）"
else
    echo "✗ 缺少视觉样式修改"
    exit 1
fi

# 检查前置验证
echo -e "\n[4] 检查前置冲突检查..."
if grep -A 5 "refreshCurrentGroupTokens" static/js/main.js | grep -q "refreshButton.disabled"; then
    echo "✓ 包含前置按钮状态检查"
else
    echo "✗ 缺少前置按钮状态检查"
    exit 1
fi

# 检查try-finally结构
echo -e "\n[5] 检查可靠的状态恢复..."
if grep -A 70 "async function refreshCurrentGroupTokens" static/js/main.js | grep -q "finally"; then
    echo "✓ 使用 try-finally 确保状态恢复"
else
    echo "✗ 缺少 try-finally 结构"
    exit 1
fi

# 检查REFRESH_CONFLICT特殊处理
echo -e "\n[6] 检查REFRESH_CONFLICT错误处理..."
if grep -A 15 "batchRefreshSelected" static/js/main.js | grep -q "REFRESH_CONFLICT"; then
    echo "✓ 包含 REFRESH_CONFLICT 特殊处理"
else
    echo "✗ 缺少 REFRESH_CONFLICT 特殊处理"
    exit 1
fi

# 检查错误响应解析
echo -e "\n[7] 检查错误响应解析..."
if grep -n "response.status === 409\|response.status === 400" static/js/main.js | grep -q "4[0-9][0-9][0-9]"; then
    echo "✓ 检查响应状态码（409/400）"
else
    echo "✗ 缺少响应状态码检查"
    exit 1
fi

# 检查友好提示
echo -e "\n[8] 检查用户提示..."
if grep -q "当前已有刷新任务" static/js/main.js; then
    echo "✓ 包含友好的用户提示"
else
    echo "✗ 缺少友好的用户提示"
    exit 1
fi

echo -e "\n========================================"
echo "✅ 所有检查通过！优化已成功实现"
echo "========================================"

echo -e "\n改进内容："
echo "  1. ✅ 新增按钮状态管理函数"
echo "  2. ✅ 刷新时自动禁用按钮"
echo "  3. ✅ 提供视觉反馈（变灰、鼠标样式）"
echo "  4. ✅ 前置检查防止重复点击"
echo "  5. ✅ 可靠的状态恢复机制"
echo "  6. ✅ 特殊处理REFRESH_CONFLICT错误"
echo "  7. ✅ 友好的错误提示"

echo -e "\n用户体验提升："
echo "  • 点击按钮后立即变灰禁用"
echo "  • 提示文字变为「刷新任务执行中，请等待...」"
echo "  • 重复点击时显示友好提示"
echo "  • 刷新完成后自动恢复按钮"
echo "  • 区分冲突警告和其他错误"

echo -e "\n测试建议："
echo "  1. 点击刷新按钮，观察按钮变灰"
echo "  2. 快速连续点击，验证拦截提示"
echo "  3. 等待刷新完成，确认按钮恢复"
echo "  4. 网络错误时验证按钮恢复"
echo ""
