#!/bin/bash

echo "================================"
echo "验证异常邮箱筛选功能集成"
echo "================================"

# 检查后端文件
echo -e "\n[1] 检查后端文件..."
if grep -q "show_anomalies" outlook_web/repositories/accounts.py; then
    echo "✓ accounts.py - show_anomalies 参数已添加"
else
    echo "✗ accounts.py - 缺少 show_anomalies 参数"
    exit 1
fi

if grep -q "show_anomalies" outlook_web/controllers/accounts.py; then
    echo "✓ accounts.py controller - API已支持异常筛选"
else
    echo "✗ accounts.py controller - API未支持异常筛选"
    exit 1
fi

# 检查前端文件
echo -e "\n[2] 检查前端文件..."
if grep -q "showAnomaliesCheckbox" templates/index.html; then
    echo "✓ index.html - 异常筛选复选框已添加"
else
    echo "✗ index.html - 缺少复选框"
    exit 1
fi

if grep -q "toggleShowAnomalies" static/js/features/groups.js; then
    echo "✓ groups.js - 切换函数已添加"
else
    echo "✗ groups.js - 缺少切换函数"
    exit 1
fi

if grep -q "showAnomaliesOnly" static/js/features/groups.js; then
    echo "✓ groups.js - 状态变量已添加"
else
    echo "✗ groups.js - 缺少状态变量"
    exit 1
fi

# 运行单元测试
echo -e "\n[3] 运行单元测试..."
if python3 test_anomaly_filter.py > /dev/null 2>&1; then
    echo "✓ 单元测试全部通过"
else
    echo "✗ 单元测试失败"
    exit 1
fi

echo -e "\n================================"
echo "✅ 所有检查通过！功能已成功集成"
echo "================================"
echo -e "\n功能说明："
echo "  1. 后端支持 show_anomalies 参数筛选异常邮箱"
echo "  2. 前端添加了 ⚠️ 异常 复选框"
echo "  3. 筛选包括：刷新失败、Token失效、状态异常"
echo -e "\n使用方法："
echo "  在账号管理页面选择分组后，勾选 ⚠️ 异常 即可筛选"
echo ""
