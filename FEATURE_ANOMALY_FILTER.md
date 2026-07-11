# 异常邮箱筛选功能

## 功能概述

在账号管理页面的分组列表上方添加了"⚠️ 异常"筛选按钮，可以快速筛选出分组内的异常邮箱。

## 异常类型

筛选包含以下三种异常类型：

1. **最近刷新失败** - 最后一次 Token 刷新状态为 `failed`
2. **Token 已失效** - 错误信息包含 `invalid_grant` 或 `AADSTS70000`
3. **状态异常** - 账号状态为 `inactive` 或 `disabled`

## 使用方法

### 1. 启用异常筛选

1. 进入"账号管理"页面
2. 选择一个分组
3. 在账号列表上方的工具栏中找到"⚠️ 异常"复选框
4. 勾选该复选框即可只显示异常邮箱

### 2. 取消筛选

- 取消勾选"⚠️ 异常"复选框，恢复显示所有邮箱
- 切换到其他分组时，筛选状态会自动重置

## UI 位置

```
┌─────────────────────────────────────────────────┐
│ 排序: [🕐 刷新时间] [📧 邮箱名] │ ☑️ ⚠️ 异常 │ □ 全选 │
├─────────────────────────────────────────────────┤
│ 账号列表...                                      │
└─────────────────────────────────────────────────┘
```

## 技术实现

### 后端

**文件**: `outlook_web/repositories/accounts.py`

- `_build_account_list_where()` - 添加 `show_anomalies` 参数
- `load_accounts_page()` - 支持异常筛选参数传递

**SQL 筛选条件**:
```sql
WHERE (
    -- 状态异常
    a.status IN ('inactive', 'disabled')
    OR EXISTS (
        -- 最近一次刷新失败
        SELECT 1
        FROM account_refresh_logs l
        WHERE l.account_id = a.id
          AND l.status = 'failed'
          AND (
              -- Token 失效判断
              LOWER(l.error_message) LIKE '%invalid_grant%'
              OR LOWER(l.error_message) LIKE '%aadsts70000%'
              OR 1=1  -- 任何刷新失败
          )
    )
)
```

**文件**: `outlook_web/controllers/accounts.py`

- `api_get_accounts()` - 接收并解析 `show_anomalies` 请求参数

### 前端

**文件**: `templates/index.html`

- 在账号列表工具栏添加"⚠️ 异常"复选框

**文件**: `static/js/features/groups.js`

- `showAnomaliesOnly` - 全局状态变量
- `toggleShowAnomalies()` - 切换筛选状态并重新加载列表
- `buildAccountListQueryKey()` - 在请求参数中添加 `show_anomalies`
- `selectGroup()` - 切换分组时重置筛选状态

## 与其他筛选的组合

异常筛选可以与以下筛选条件组合使用：

- ✅ **分组筛选** - 只在当前选中的分组内筛选
- ✅ **搜索筛选** - 可以搜索异常邮箱的邮箱地址或备注
- ✅ **标签筛选** - 可以筛选带特定标签的异常邮箱
- ✅ **排序** - 筛选结果支持按刷新时间或邮箱名排序

## 测试

运行测试脚本验证功能：

```bash
python3 test_anomaly_filter.py
```

测试覆盖：
- ✅ 不带异常筛选的正常查询
- ✅ 带异常筛选的查询
- ✅ 分组+搜索+异常的组合筛选
- ✅ 标签+异常的组合筛选

## 用户体验优化

1. **自动重置** - 切换分组时自动取消异常筛选，避免混淆
2. **提示信息** - 鼠标悬停显示完整的筛选条件说明
3. **视觉标识** - 使用 ⚠️ 图标清晰标识异常筛选功能
4. **页面重置** - 启用筛选时自动跳转到第1页

## 后续优化建议

1. 在分组卡片上显示异常邮箱数量徽章
2. 添加异常类型的细分筛选（只看Token失效、只看状态异常等）
3. 支持导出异常邮箱列表
4. 添加"批量修复"功能（例如批量刷新失败的邮箱）

## 相关文件

- `outlook_web/repositories/accounts.py` - 数据层筛选逻辑
- `outlook_web/controllers/accounts.py` - API控制器
- `static/js/features/groups.js` - 前端状态管理
- `templates/index.html` - UI界面
- `test_anomaly_filter.py` - 功能测试
