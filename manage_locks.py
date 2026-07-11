#!/usr/bin/env python3
"""分布式锁管理工具 - 查看和清理过期的刷新任务锁"""

import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from outlook_web.config import get_database_path


def format_timestamp(ts):
    """格式化时间戳"""
    if not ts:
        return "N/A"
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def list_locks(show_all=False):
    """列出所有锁"""
    db_path = get_database_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    now = time.time()

    if show_all:
        query = "SELECT * FROM distributed_locks ORDER BY acquired_at DESC"
    else:
        query = "SELECT * FROM distributed_locks WHERE expires_at >= ? ORDER BY acquired_at DESC"

    cursor = conn.execute(query, () if show_all else (now,))
    locks = cursor.fetchall()

    if not locks:
        print("✓ 没有活跃的锁")
        return []

    print(f"\n{'状态':<10} {'锁名称':<30} {'持有者ID':<40}")
    print("=" * 80)

    lock_list = []
    for lock in locks:
        is_expired = lock['expires_at'] < now
        status = "❌ 已过期" if is_expired else "✓ 活跃"

        print(f"{status:<10} {lock['name']:<30} {lock['owner_id']:<40}")
        print(f"  获取时间: {format_timestamp(lock['acquired_at'])}")
        print(f"  过期时间: {format_timestamp(lock['expires_at'])}")

        if is_expired:
            time_ago = int(now - lock['expires_at'])
            print(f"  已过期: {time_ago // 60} 分钟前")
        else:
            time_left = int(lock['expires_at'] - now)
            print(f"  剩余时间: {time_left // 60} 分钟")
        print()

        lock_list.append(dict(lock))

    conn.close()
    return lock_list


def clean_expired_locks():
    """清理过期的锁"""
    db_path = get_database_path()
    conn = sqlite3.connect(db_path)

    now = time.time()

    # 查询过期的锁
    cursor = conn.execute(
        "SELECT name, owner_id FROM distributed_locks WHERE expires_at < ?",
        (now,)
    )
    expired = cursor.fetchall()

    if not expired:
        print("✓ 没有需要清理的过期锁")
        conn.close()
        return 0

    # 删除过期的锁
    result = conn.execute(
        "DELETE FROM distributed_locks WHERE expires_at < ?",
        (now,)
    )
    count = result.rowcount
    conn.commit()
    conn.close()

    print(f"✓ 已清理 {count} 个过期的锁:")
    for name, owner_id in expired:
        print(f"  - {name} (持有者: {owner_id[:8]}...)")

    return count


def force_release_lock(lock_name):
    """强制释放指定的锁"""
    db_path = get_database_path()
    conn = sqlite3.connect(db_path)

    # 检查锁是否存在
    cursor = conn.execute(
        "SELECT owner_id, expires_at FROM distributed_locks WHERE name = ?",
        (lock_name,)
    )
    lock = cursor.fetchone()

    if not lock:
        print(f"✗ 锁 '{lock_name}' 不存在")
        conn.close()
        return False

    # 删除锁
    conn.execute("DELETE FROM distributed_locks WHERE name = ?", (lock_name,))
    conn.commit()
    conn.close()

    now = time.time()
    owner_id, expires_at = lock
    is_expired = expires_at < now

    print(f"✓ 已强制释放锁: {lock_name}")
    print(f"  持有者: {owner_id}")
    print(f"  状态: {'已过期' if is_expired else '活跃'}")
    print(f"  过期时间: {format_timestamp(expires_at)}")

    return True


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(
        description="分布式锁管理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s list              # 列出活跃的锁
  %(prog)s list --all        # 列出所有锁（包括过期的）
  %(prog)s clean             # 清理过期的锁
  %(prog)s release <锁名称>  # 强制释放指定的锁
  %(prog)s release refresh_all_tokens  # 释放刷新锁
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='命令')

    # list 命令
    list_parser = subparsers.add_parser('list', help='列出锁')
    list_parser.add_argument('--all', action='store_true', help='显示所有锁（包括过期的）')

    # clean 命令
    subparsers.add_parser('clean', help='清理过期的锁')

    # release 命令
    release_parser = subparsers.add_parser('release', help='强制释放指定的锁')
    release_parser.add_argument('lock_name', help='锁的名称')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 0

    print("=" * 80)
    print("分布式锁管理工具")
    print("=" * 80)

    try:
        if args.command == 'list':
            list_locks(show_all=args.all)
        elif args.command == 'clean':
            clean_expired_locks()
        elif args.command == 'release':
            force_release_lock(args.lock_name)

        return 0

    except Exception as e:
        print(f"\n✗ 错误: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
