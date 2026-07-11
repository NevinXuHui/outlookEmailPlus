# 刷新冲突处理优化

## 问题描述

用户在快速连续点击"🔄 刷新Token"按钮时，会收到`REFRESH_CONFLICT`错误：

```
当前已有刷新任务执行中，请等待当前任务完成后再重试
[Code] REFRESH_CONFLICT
```

这个错误虽然是正确的保护机制，但用户体验不佳。

## 优化方案

### 1. 按钮状态管理

**新增辅助函数**：
```javascript
function setRefreshButtonState(disabled) {
    const refreshButton = document.querySelector('[onclick="refreshCurrentGroupTokens()"]');
    if (!refreshButton) return;

    refreshButton.disabled = disabled;
    if (disabled) {
        refreshButton.style.opacity = '0.5';
        refreshButton.style.cursor = 'not-allowed';
        refreshButton.title = '刷新任务执行中，请等待...';
    } else {
        refreshButton.style.opacity = '1';
        refreshButton.style.cursor = 'pointer';
        refreshButton.title = '批量刷新当前分组所有账号的Token';
    }
}
```

**功能**：
- 刷新开始时禁用按钮
- 刷新完成时恢复按钮
- 修改按钮样式提供视觉反馈

### 2. 前置检查

在`refreshCurrentGroupTokens()`开始时检查按钮状态：

```javascript
// 检查是否已有刷新任务在执行
const refreshButton = document.querySelector('[onclick="refreshCurrentGroupTokens()"]');
if (refreshButton && refreshButton.disabled) {
    showToast('当前已有刷新任务执行中，请等待完成', 'warning');
    return;
}
```

**优势**：
- 在发送请求前就阻止重复操作
- 减少不必要的网络请求
- 提供即时反馈

### 3. 完整错误处理

优化`batchRefreshSelected()`函数的错误处理：

```javascript
if (!response.ok) {
    clearTimers();
    dismissPersistentToast(toastId);

    // 特殊处理刷新冲突错误
    if (response.status === 409 || response.status === 400) {
        try {
            const errorData = await response.json();
            if (errorData.code === 'REFRESH_CONFLICT') {
                showToast('当前已有刷新任务执行中，请等待完成后再试', 'warning');
                return;
            }
        } catch (e) {
            // JSON解析失败，使用默认错误消息
        }
    }

    showToast('刷新请求失败，请稍后重试', 'error');
    return;
}
```

**改进**：
- 识别`REFRESH_CONFLICT`错误码
- 显示友好的警告提示（warning而非error）
- 区分不同类型的错误

### 4. 可靠的状态恢复

使用`try-finally`确保按钮状态必然恢复：

```javascript
try {
    // 禁用刷新按钮
    setRefreshButtonState(true);

    try {
        // 执行批量刷新
        await batchRefreshSelected(accountIds);
    } finally {
        // 无论成功失败都恢复按钮状态
        setRefreshButtonState(false);
    }
} catch (error) {
    // 外层错误处理
    setRefreshButtonState(false);
    showToast('获取分组账号失败，请重试', 'error');
}
```

## 用户体验改进

### 改进前
1. 用户点击"🔄 刷新Token"
2. 请求发送到后端
3. 用户可以再次点击按钮
4. 后端返回`REFRESH_CONFLICT`错误
5. 显示错误提示

**问题**：
- ❌ 可以重复点击
- ❌ 浪费网络请求
- ❌ 错误消息不够友好
- ❌ 按钮状态无变化

### 改进后
1. 用户点击"🔄 刷新Token"
2. **按钮立即变灰并禁用**
3. **按钮提示变为"刷新任务执行中，请等待..."**
4. 请求发送到后端
5. 如果后端返回冲突，显示友好的警告提示
6. **刷新完成后按钮自动恢复**

**优势**：
- ✅ 视觉反馈明确
- ✅ 防止重复点击
- ✅ 前置拦截减少请求
- ✅ 友好的错误提示
- ✅ 自动状态恢复

## 场景测试

### 场景1：正常刷新
1. 点击"🔄 刷新Token"
2. **预期**：按钮变灰，提示"刷新任务执行中，请等待..."
3. 刷新完成
4. **预期**：按钮恢复正常，可以再次点击

### 场景2：快速连续点击
1. 点击"🔄 刷新Token"（第一次）
2. **预期**：按钮变灰禁用
3. 尝试再次点击（第二次）
4. **预期**：显示提示"当前已有刷新任务执行中，请等待完成"
5. 等待第一次刷新完成
6. **预期**：按钮恢复，可以点击

### 场景3：网络错误
1. 点击"🔄 刷新Token"
2. **预期**：按钮变灰
3. 网络请求失败
4. **预期**：显示错误提示，按钮自动恢复

### 场景4：用户取消
1. 点击"🔄 刷新Token"
2. 确认对话框点击"取消"
3. **预期**：按钮保持可用状态（未禁用）

## 技术实现

### 修改的文件
- `static/js/main.js`

### 新增函数
- `setRefreshButtonState(disabled)` - 统一管理按钮状态

### 修改的函数
- `refreshCurrentGroupTokens()` - 添加前置检查和状态管理
- `batchRefreshSelected()` - 优化错误处理

## 关键代码改进点

### 1. 状态管理集中化
```javascript
// 改进前：分散的按钮操作
refreshButton.disabled = true;
refreshButton.style.opacity = '0.5';
// ...

// 改进后：统一管理
setRefreshButtonState(true);
```

### 2. 可靠的清理机制
```javascript
// 改进前：需要在每个错误分支恢复状态
if (error) {
    refreshButton.disabled = false;
    refreshButton.style.opacity = '1';
}

// 改进后：使用finally确保执行
try {
    await batchRefreshSelected(accountIds);
} finally {
    setRefreshButtonState(false);
}
```

### 3. 前置验证
```javascript
// 新增：在发送请求前检查
if (refreshButton && refreshButton.disabled) {
    showToast('当前已有刷新任务执行中，请等待完成', 'warning');
    return;
}
```

## 兼容性

### 浏览器支持
- ✅ Chrome/Edge
- ✅ Firefox
- ✅ Safari

### 现有功能影响
- ✅ 不影响批量操作栏的刷新功能
- ✅ 不影响单个账号刷新
- ✅ 不影响其他刷新入口

## 后续优化建议

### 短期
1. 添加刷新进度百分比显示
2. 提供"取消刷新"功能
3. 刷新完成后显示成功/失败统计

### 长期
1. 实现队列机制，允许多个刷新任务排队
2. 添加刷新任务历史记录
3. 支持后台刷新（不阻塞UI）

## 总结

本次优化通过以下手段显著改善了用户体验：

1. **预防性措施** - 按钮禁用防止重复点击
2. **友好提示** - 区分冲突错误和其他错误
3. **可靠清理** - 确保按钮状态正确恢复
4. **即时反馈** - 视觉状态变化让用户清楚当前状态

用户不再需要看到技术性的错误消息，系统会智能地阻止问题操作。

---

**优化日期**：2026-07-08
**影响范围**：分组批量刷新Token功能
**状态**：✅ 已完成
