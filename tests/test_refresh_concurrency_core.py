"""刷新公共核心：并发分波、计数归约、锁 TTL、设置项。"""

from __future__ import annotations

import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Tuple
from unittest.mock import MagicMock, patch

from outlook_web.services import refresh as refresh_service


class RefreshConcurrencyCoreTests(unittest.TestCase):
    def test_normalize_refresh_concurrency_clamps_bounds(self):
        self.assertEqual(refresh_service.normalize_refresh_concurrency(None), 5)
        self.assertEqual(refresh_service.normalize_refresh_concurrency("abc"), 5)
        self.assertEqual(refresh_service.normalize_refresh_concurrency(0), 1)
        self.assertEqual(refresh_service.normalize_refresh_concurrency(-3), 1)
        self.assertEqual(refresh_service.normalize_refresh_concurrency(3), 3)
        self.assertEqual(refresh_service.normalize_refresh_concurrency(99), refresh_service.REFRESH_MAX_CONCURRENCY)

    def test_compute_refresh_lock_ttl_uses_wave_count(self):
        # 小批量两者都低于 2h 下限，钳到相同值
        small = refresh_service.compute_refresh_lock_ttl_seconds(100, 5, concurrency=5)
        self.assertEqual(small, refresh_service.REFRESH_LOCK_TTL_SECONDS)

        # 大批量：串行估算显著高于并发估算，且两者都超过下限
        # 5000 账号 / 并发 1：5000*(5+2)+600 = 35600
        # 5000 账号 / 并发 5：1000*(5+2)+600 = 7600
        serial = refresh_service.compute_refresh_lock_ttl_seconds(5000, 5, concurrency=1)
        concurrent = refresh_service.compute_refresh_lock_ttl_seconds(5000, 5, concurrency=5)
        self.assertGreater(serial, concurrent)
        self.assertGreater(serial, refresh_service.REFRESH_LOCK_TTL_SECONDS)
        self.assertGreaterEqual(concurrent, refresh_service.REFRESH_LOCK_TTL_SECONDS)
        self.assertLessEqual(serial, 60 * 60 * 24)

    def test_refresh_one_account_is_network_only(self):
        task = refresh_service.RefreshTask(
            account_id=1,
            email="a@example.com",
            client_id="cid",
            refresh_token="rt",
            proxy_url="http://proxy",
        )

        def fake_refresh(client_id, refresh_token, proxy_url):
            self.assertEqual(client_id, "cid")
            self.assertEqual(refresh_token, "rt")
            self.assertEqual(proxy_url, "http://proxy")
            return True, None, "new-rt"

        outcome = refresh_service._refresh_one_account(task, fake_refresh)
        self.assertTrue(outcome.success)
        self.assertEqual(outcome.new_refresh_token, "new-rt")

    def test_refresh_one_account_handles_decrypt_error_without_network(self):
        task = refresh_service.RefreshTask(
            account_id=2,
            email="b@example.com",
            client_id="cid",
            refresh_token="",
            decrypt_error="解密 token 失败: boom",
        )
        called = []

        def fake_refresh(*_args):
            called.append(True)
            return True, None, None

        outcome = refresh_service._refresh_one_account(task, fake_refresh)
        self.assertFalse(outcome.success)
        self.assertIn("解密", outcome.error_msg or "")
        self.assertEqual(called, [])

    def test_run_refresh_batch_serial_when_concurrency_one(self):
        """concurrency=1 不创建线程，调用顺序与输入顺序一致。"""
        tasks = [
            refresh_service.RefreshTask(i, f"u{i}@ex.com", "cid", f"rt{i}")
            for i in range(1, 4)
        ]
        call_order: List[int] = []

        def fake_refresh(client_id, refresh_token, proxy_url):
            account_id = int(refresh_token.replace("rt", ""))
            call_order.append(account_id)
            return True, None, None

        conn = MagicMock()
        stats = refresh_service.RefreshBatchStats()

        with patch.object(refresh_service, "ThreadPoolExecutor") as mocked_pool:
            events = list(
                refresh_service.run_refresh_batch(
                    conn,
                    tasks,
                    refresh_type="manual_selected",
                    run_id="run-1",
                    test_refresh_token=fake_refresh,
                    stats=stats,
                    concurrency=1,
                    delay_seconds=0,
                )
            )

        mocked_pool.assert_not_called()
        self.assertEqual(call_order, [1, 2, 3])
        self.assertEqual(stats.success_count, 3)
        self.assertEqual(stats.failed_count, 0)
        progress = [e for e in events if e["type"] == "progress"]
        self.assertEqual([e["current"] for e in progress], [1, 2, 3])
        self.assertTrue(all(e["current"] <= e["total"] for e in progress))

    def test_run_refresh_batch_concurrent_reduces_counts_correctly(self):
        """并发乱序完成时，计数归约与 progress.current 仍单调正确。"""
        tasks = [
            refresh_service.RefreshTask(i, f"u{i}@ex.com", "cid", f"rt{i}")
            for i in range(1, 6)
        ]

        def fake_refresh(client_id, refresh_token, proxy_url):
            account_id = int(refresh_token.replace("rt", ""))
            # 让较大 id 先完成，制造乱序
            time.sleep(0.03 * (6 - account_id))
            if account_id % 2 == 0:
                return False, f"fail-{account_id}", None
            return True, None, f"new-{account_id}"

        conn = MagicMock()
        stats = refresh_service.RefreshBatchStats()
        events = list(
            refresh_service.run_refresh_batch(
                conn,
                tasks,
                refresh_type="manual_all",
                run_id="run-2",
                test_refresh_token=fake_refresh,
                stats=stats,
                concurrency=3,
                delay_seconds=0,
            )
        )

        self.assertEqual(stats.success_count, 3)  # 1,3,5
        self.assertEqual(stats.failed_count, 2)  # 2,4
        progress = [e for e in events if e["type"] == "progress"]
        currents = [e["current"] for e in progress]
        self.assertEqual(currents, sorted(currents))
        self.assertEqual(currents[-1], 5)
        self.assertEqual(len(progress), 5)
        # 每个账号都有 result
        self.assertTrue(all(e.get("result") in {"success", "failed"} for e in progress))
        self.assertTrue(all(e.get("result") != "processing" for e in progress))

    def test_run_refresh_batch_emits_delay_between_waves(self):
        tasks = [
            refresh_service.RefreshTask(i, f"u{i}@ex.com", "cid", f"rt{i}")
            for i in range(1, 5)
        ]

        def fake_refresh(*_args):
            return True, None, None

        conn = MagicMock()
        stats = refresh_service.RefreshBatchStats()

        with patch.object(refresh_service.time, "sleep") as mocked_sleep:
            events = list(
                refresh_service.run_refresh_batch(
                    conn,
                    tasks,
                    refresh_type="manual_all",
                    run_id="run-3",
                    test_refresh_token=fake_refresh,
                    stats=stats,
                    concurrency=2,
                    delay_seconds=5,
                )
            )

        delay_events = [e for e in events if e["type"] == "delay"]
        # 4 账号 / 并发 2 = 2 波，波间 1 次 delay
        self.assertEqual(len(delay_events), 1)
        self.assertGreaterEqual(delay_events[0]["seconds"], 5)
        self.assertLessEqual(delay_events[0]["seconds"], 7)
        # delay 会分段 sleep（0.5s 步长）以便快速响应取消
        self.assertGreaterEqual(mocked_sleep.call_count, 1)
        slept = sum(float(call.args[0]) for call in mocked_sleep.call_args_list)
        self.assertAlmostEqual(slept, delay_events[0]["seconds"], places=5)

    def test_batch_stats_records_invalid_token_failures(self):
        stats = refresh_service.RefreshBatchStats()
        task = refresh_service.RefreshTask(9, "bad@ex.com", "cid", "rt")
        outcome = refresh_service.RefreshOutcome(
            task=task,
            success=False,
            error_msg="AADSTS70000: invalid_grant",
        )
        stats.absorb(outcome)
        self.assertEqual(stats.failed_count, 1)
        self.assertEqual(stats.invalid_token_failed_count, 1)
        self.assertEqual(stats.invalid_token_failed_list[0]["id"], 9)


if __name__ == "__main__":
    unittest.main()
