"""刷新任务状态查询与取消。"""

from __future__ import annotations

import time
import unittest
import uuid
from unittest.mock import MagicMock

from outlook_web.repositories import distributed_locks as lock_repo
from outlook_web.repositories import refresh_runs as run_repo
from outlook_web.services import refresh as refresh_service


class _FakeConn:
    """最小 sqlite 替身：用内存表模拟锁/运行记录所需 SQL。"""

    def __init__(self):
        import sqlite3

        self._conn = sqlite3.connect(":memory:")
        self._conn.row_factory = sqlite3.Row
        self._conn.execute(
            """
            CREATE TABLE distributed_locks (
                name TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                acquired_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE refresh_runs (
                id TEXT PRIMARY KEY,
                trigger_source TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_by_ip TEXT,
                requested_by_user_agent TEXT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP,
                total INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                message TEXT,
                trace_id TEXT
            )
            """
        )
        self._conn.commit()

    def execute(self, *args, **kwargs):
        return self._conn.execute(*args, **kwargs)

    def commit(self):
        return self._conn.commit()

    def close(self):
        return self._conn.close()


class RefreshTaskStatusCancelTests(unittest.TestCase):
    def setUp(self):
        self.conn = _FakeConn()

    def tearDown(self):
        self.conn.close()

    def test_status_idle_when_no_lock_or_run(self):
        status = refresh_service.get_refresh_task_status(db=self.conn, lock_name="refresh_all_tokens")
        self.assertFalse(status["active"])
        self.assertEqual(status["status"], "idle")
        self.assertFalse(status["locked"])
        self.assertIsNone(status["run_id"])

    def test_status_running_with_lock_and_run(self):
        run_id = run_repo.create_refresh_run(
            self.conn,
            trigger_source="manual_selected",
            trace_id="t1",
            total=10,
        )
        run_repo.update_refresh_run_progress(
            self.conn,
            run_id,
            total=10,
            success_count=3,
            failed_count=1,
        )
        ok, _ = lock_repo.acquire_distributed_lock(
            self.conn, "refresh_all_tokens", "owner-1", ttl_seconds=60
        )
        self.assertTrue(ok)

        status = refresh_service.get_refresh_task_status(db=self.conn, lock_name="refresh_all_tokens")
        self.assertTrue(status["active"])
        self.assertEqual(status["status"], "running")
        self.assertTrue(status["locked"])
        self.assertEqual(status["run_id"], run_id)
        self.assertEqual(status["processed"], 4)
        self.assertEqual(status["success_count"], 3)
        self.assertEqual(status["failed_count"], 1)
        self.assertTrue(status["cancelable"])

    def test_cancel_marks_run_and_releases_lock(self):
        run_id = run_repo.create_refresh_run(
            self.conn,
            trigger_source="manual_all",
            trace_id="t2",
            total=5,
        )
        lock_repo.acquire_distributed_lock(self.conn, "refresh_all_tokens", "owner-x", ttl_seconds=120)

        result = refresh_service.cancel_refresh_task(
            db=self.conn,
            lock_name="refresh_all_tokens",
            force_unlock=True,
        )
        self.assertTrue(result["cancelled"])
        self.assertEqual(result["run_id"], run_id)
        self.assertTrue(result["lock_released"])

        row = self.conn.execute("SELECT status FROM refresh_runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual(row["status"], "cancelling")
        self.assertIsNone(lock_repo.get_distributed_lock(self.conn, "refresh_all_tokens"))

        status = refresh_service.get_refresh_task_status(db=self.conn, lock_name="refresh_all_tokens")
        self.assertEqual(status["status"], "cancelling")
        self.assertTrue(status["active"])  # cancelling 仍算活跃，直到 finish

    def test_cancel_without_active_task(self):
        result = refresh_service.cancel_refresh_task(
            db=self.conn,
            lock_name="refresh_all_tokens",
            force_unlock=True,
        )
        self.assertFalse(result["cancelled"])

    def test_is_cancel_requested(self):
        run_id = run_repo.create_refresh_run(
            self.conn,
            trigger_source="manual_selected",
            trace_id="t3",
            total=2,
        )
        self.assertFalse(run_repo.is_refresh_run_cancel_requested(self.conn, run_id))
        run_repo.request_cancel_refresh_run(self.conn, run_id)
        self.assertTrue(run_repo.is_refresh_run_cancel_requested(self.conn, run_id))

    def test_run_refresh_batch_raises_on_cancel(self):
        run_id = run_repo.create_refresh_run(
            self.conn,
            trigger_source="manual_selected",
            trace_id="t4",
            total=2,
        )

        tasks = [
            refresh_service.RefreshTask(
                account_id=1,
                email="a@example.com",
                client_id="cid",
                refresh_token="rt",
                proxy_url="",
            ),
            refresh_service.RefreshTask(
                account_id=2,
                email="b@example.com",
                client_id="cid",
                refresh_token="rt",
                proxy_url="",
            ),
        ]

        def fake_refresh(client_id, refresh_token, proxy_url=None):
            # 第一波完成后请求取消
            run_repo.request_cancel_refresh_run(self.conn, run_id)
            return True, None, refresh_token

        stats = refresh_service.RefreshBatchStats()
        gen = refresh_service.run_refresh_batch(
            self.conn,
            tasks,
            refresh_type="manual_selected",
            run_id=run_id,
            test_refresh_token=fake_refresh,
            stats=stats,
            concurrency=1,
            delay_seconds=0,
        )
        # 第一个 progress 会出来
        first = next(gen)
        self.assertEqual(first["type"], "progress")
        with self.assertRaises(refresh_service.RefreshCancelled):
            # 下一个账号开始前应检测到 cancelling
            list(gen)


if __name__ == "__main__":
    unittest.main()
