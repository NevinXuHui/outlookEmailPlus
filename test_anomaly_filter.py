#!/usr/bin/env python3
"""测试异常邮箱筛选功能"""

import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from outlook_web.repositories.accounts import _build_account_list_where


def test_anomaly_filter():
    """测试异常筛选SQL构建"""

    print("=" * 60)
    print("测试异常邮箱筛选功能")
    print("=" * 60)

    # 测试1: 不带异常筛选
    print("\n[测试1] 不带异常筛选")
    where_sql, params = _build_account_list_where(
        group_id=1,
        search='',
        tag_ids=[],
        show_anomalies=False
    )
    assert 'inactive' not in where_sql.lower()
    assert 'disabled' not in where_sql.lower()
    print("✓ 通过：WHERE子句不包含异常筛选条件")

    # 测试2: 带异常筛选
    print("\n[测试2] 带异常筛选")
    where_sql, params = _build_account_list_where(
        group_id=1,
        search='',
        tag_ids=[],
        show_anomalies=True
    )
    assert 'inactive' in where_sql.lower()
    assert 'disabled' in where_sql.lower()
    assert 'account_refresh_logs' in where_sql.lower()
    assert 'invalid_grant' in where_sql.lower()
    print("✓ 通过：WHERE子句包含异常筛选条件")
    print(f"  - 状态异常: inactive/disabled")
    print(f"  - 刷新失败: 检查 account_refresh_logs")
    print(f"  - Token失效: invalid_grant/aadsts70000")

    # 测试3: 组合筛选（分组+搜索+异常）
    print("\n[测试3] 组合筛选（分组+搜索+异常）")
    where_sql, params = _build_account_list_where(
        group_id=2,
        search='test@example.com',
        tag_ids=[],
        show_anomalies=True
    )
    assert 'a.group_id = ?' in where_sql
    assert 'LOWER(COALESCE(a.email' in where_sql
    assert 'inactive' in where_sql.lower()
    assert params[0] == 2
    assert '%test@example.com%' in params
    print("✓ 通过：多条件组合筛选正确")
    print(f"  - 分组ID: {params[0]}")
    print(f"  - 搜索关键词: test@example.com")
    print(f"  - 异常筛选: 已启用")

    # 测试4: 标签+异常筛选
    print("\n[测试4] 标签+异常筛选")
    where_sql, params = _build_account_list_where(
        group_id=None,
        search='',
        tag_ids=[1, 2, 3],
        show_anomalies=True
    )
    assert 'tag_id IN' in where_sql
    assert 'inactive' in where_sql.lower()
    assert 1 in params and 2 in params and 3 in params
    print("✓ 通过：标签筛选与异常筛选组合正确")
    print(f"  - 标签IDs: {[p for p in params if isinstance(p, int)]}")
    print(f"  - 异常筛选: 已启用")

    print("\n" + "=" * 60)
    print("所有测试通过！✓")
    print("=" * 60)

    return True


if __name__ == '__main__':
    try:
        test_anomaly_filter()
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ 测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
