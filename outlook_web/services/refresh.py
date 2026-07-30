from __future__ import annotations

import json
import math
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

from outlook_web.db import create_sqlite_connection
from outlook_web.errors import build_error_payload, generate_trace_id
from outlook_web.repositories.distributed_locks import (
    acquire_distributed_lock,
    release_distributed_lock,
)
from outlook_web.repositories.refresh_runs import create_refresh_run, finish_refresh_run
from outlook_web.security.crypto import decrypt_data, encrypt_data

REFRESH_LOCK_TTL_SECONDS = 60 * 60 * 2  # 2 小时，避免异常中断导致长时间卡死

# 刷新并发度：默认与批量拉取邮件保持一致；设上限以抑制 Microsoft 端 429 限流风险
REFRESH_DEFAULT_CONCURRENCY = 5
REFRESH_MAX_CONCURRENCY = 20


def build_refreshable_outlook_account_where(
    column: str = "account_type",
    provider_column: str = "provider",
) -> str:
    """构造 Outlook-only 刷新规则，兼容历史空 account_type 数据。
    排除 provider=cloudflare_temp_mail（CF pool 账号无 OAuth token，不应进入刷新链路）。"""
    return f"({column} = 'outlook' OR {column} IS NULL) AND ({provider_column} != 'cloudflare_temp_mail' OR {provider_column} IS NULL)"


REFRESHABLE_OUTLOOK_ACCOUNT_WHERE = build_refreshable_outlook_account_where()
REFRESHABLE_OUTLOOK_ACCOUNT_SELECT = f"""
    SELECT id, email, client_id, refresh_token, group_id
    FROM accounts
    WHERE status = 'active'
      AND {REFRESHABLE_OUTLOOK_ACCOUNT_WHERE}
"""


def is_refreshable_outlook_account(
    account_type: Optional[str],
    *,
    provider: Optional[str] = None,
) -> bool:
    """仅 Outlook（以及历史空 account_type）允许进入 OAuth token 刷新链路。
    排除 provider=cloudflare_temp_mail（CF pool 账号无 OAuth token）。"""
    # CF pool 账号永远不应进入刷新链路
    if provider and str(provider).strip() == "cloudflare_temp_mail":
        return False
    if account_type is None:
        return True
    return isinstance(account_type, str) and account_type.strip().lower() == "outlook"


INVALID_TOKEN_FAILED_LIST_LIMIT = 200
INVALID_TOKEN_ERROR_KEYWORDS = ("invalid_grant", "aadsts70000")


def _classify_refresh_failure(error_message: Optional[str]) -> Dict[str, Any]:
    """统一判定刷新失败是否属于失效 token（方案 C 首版口径）。"""
    normalized = str(error_message or "").strip().lower()
    is_invalid_token = any(keyword in normalized for keyword in INVALID_TOKEN_ERROR_KEYWORDS)
    if not is_invalid_token:
        return {
            "is_invalid_token": False,
            "reason_code": None,
            "reason_label": None,
        }

    return {
        "is_invalid_token": True,
        "reason_code": "INVALID_GRANT_OR_AADSTS70000",
        "reason_label": "refresh_token_invalid_or_expired",
    }


def _record_invalid_token_failure(
    *,
    invalid_token_failed_list: List[Dict[str, Any]],
    account_id: int,
    account_email: str,
    error_message: Optional[str],
) -> bool:
    classified = _classify_refresh_failure(error_message)
    if not classified.get("is_invalid_token"):
        return False

    if len(invalid_token_failed_list) < INVALID_TOKEN_FAILED_LIST_LIMIT:
        invalid_token_failed_list.append(
            {
                "id": account_id,
                "email": account_email,
                "error": error_message,
                "reason_code": classified.get("reason_code"),
                "reason_label": classified.get("reason_label"),
            }
        )
    return True


def utcnow() -> datetime:
    """返回 naive UTC 时间（等价于旧的 datetime.utcnow()）"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def compute_refresh_lock_ttl_seconds(total: int, delay_seconds: int, *, concurrency: int = 1) -> int:
    """按实际执行波数估算锁 TTL。

    并发执行时耗时取决于波数（ceil(total / concurrency)）而非账号总数，
    沿用串行公式会显著高估，导致进程异常退出后锁迟迟不过期。
    """
    try:
        total = int(total or 0)
    except Exception:
        total = 0
    try:
        delay_seconds = int(delay_seconds or 0)
    except Exception:
        delay_seconds = 0
    try:
        concurrency = max(1, int(concurrency or 1))
    except Exception:
        concurrency = 1

    waves = math.ceil(total / concurrency) if total > 0 else 0
    estimated = int(waves * (max(delay_seconds, 0) + 2) + 600)
    ttl = max(REFRESH_LOCK_TTL_SECONDS, estimated)
    return min(ttl, 60 * 60 * 24)  # 最大 24 小时


# ==================== 刷新执行公共核心 ====================
#
# 五条刷新链路（refresh-all / trigger-scheduled / refresh-selected / retry-failed
# / 定时任务）此前各自维护一份几乎逐字相同的循环体。此处抽取为统一核心：
#
#   build_refresh_tasks()  主线程：解密 token + 预解析 proxy_url，产出不可变快照
#   _refresh_one_account() worker 线程：仅做网络调用
#   run_refresh_batch()    主线程生成器：分波调度、写库、归约计数、产出事件
#
# 线程边界（关键约束）：db.py 的 create_sqlite_connection() 未传
# check_same_thread=False，连接只能被创建它的线程使用。因此 worker 线程
# 绝不允许触碰 conn，所有 DB 读写都留在主线程。


@dataclass(frozen=True)
class RefreshTask:
    """单账号刷新的输入快照。

    frozen 是刻意的：它标记本对象会被送入 worker 线程，只读且自包含。
    禁止在 worker 中依据它回查数据库（conn 非线程安全）。
    """

    account_id: int
    email: str
    client_id: str
    refresh_token: str
    proxy_url: str = ""
    # 非空表示解密阶段已失败，跳过网络调用直接判定为失败
    decrypt_error: Optional[str] = None


@dataclass
class RefreshOutcome:
    """单账号刷新的结果。"""

    task: RefreshTask
    success: bool
    error_msg: Optional[str] = None
    new_refresh_token: Optional[str] = None


@dataclass
class RefreshBatchStats:
    """批次归约结果。由主线程独占累加，无需加锁。"""

    total: int = 0
    success_count: int = 0
    failed_count: int = 0
    failed_list: List[Dict[str, Any]] = field(default_factory=list)
    invalid_token_failed_count: int = 0
    invalid_token_failed_list: List[Dict[str, Any]] = field(default_factory=list)

    def absorb(self, outcome: RefreshOutcome) -> None:
        if outcome.success:
            self.success_count += 1
            return

        self.failed_count += 1
        self.failed_list.append(
            {
                "id": outcome.task.account_id,
                "email": outcome.task.email,
                "error": outcome.error_msg,
            }
        )
        if _record_invalid_token_failure(
            invalid_token_failed_list=self.invalid_token_failed_list,
            account_id=outcome.task.account_id,
            account_email=outcome.task.email,
            error_message=outcome.error_msg,
        ):
            self.invalid_token_failed_count += 1


def load_group_proxy_map(conn, group_ids: Iterable[Any]) -> Dict[Any, str]:
    """一次性预加载 group_id -> proxy_url，避免循环内逐账号查询。"""
    ids = [gid for gid in {g for g in group_ids} if gid]
    if not ids:
        return {}

    placeholders = ",".join("?" * len(ids))
    try:
        rows = conn.execute(
            f"SELECT id, proxy_url FROM groups WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    except Exception:
        return {}

    return {row["id"]: (row["proxy_url"] or "") for row in rows}


def build_refresh_tasks(conn, accounts: Sequence[Any]) -> List[RefreshTask]:
    """主线程：把账号行转为 worker 可直接消费的任务快照。

    解密与 proxy 解析都在此完成，worker 拿到的是纯数据。
    """
    proxy_map = load_group_proxy_map(conn, (row["group_id"] for row in accounts))

    tasks: List[RefreshTask] = []
    for row in accounts:
        encrypted = row["refresh_token"]
        decrypt_error: Optional[str] = None
        try:
            refresh_token = decrypt_data(encrypted) if encrypted else encrypted
        except Exception as e:
            refresh_token = ""
            decrypt_error = f"解密 token 失败: {str(e)}"

        tasks.append(
            RefreshTask(
                account_id=row["id"],
                email=row["email"],
                client_id=row["client_id"],
                refresh_token=refresh_token or "",
                proxy_url=proxy_map.get(row["group_id"], ""),
                decrypt_error=decrypt_error,
            )
        )
    return tasks


def _refresh_one_account(
    task: RefreshTask,
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
) -> RefreshOutcome:
    """在 worker 线程执行。只做网络调用，禁止任何数据库操作。"""
    if task.decrypt_error:
        return RefreshOutcome(task=task, success=False, error_msg=task.decrypt_error)

    try:
        success, error_msg, new_refresh_token = test_refresh_token(
            task.client_id,
            task.refresh_token,
            task.proxy_url,
        )
    except Exception as e:
        return RefreshOutcome(task=task, success=False, error_msg=f"刷新异常: {str(e)}")

    return RefreshOutcome(
        task=task,
        success=bool(success),
        error_msg=error_msg,
        new_refresh_token=new_refresh_token,
    )


def _persist_outcome(
    conn,
    outcome: RefreshOutcome,
    *,
    refresh_type: str,
    run_id: Optional[str],
    read_back_last_refresh_at: bool,
) -> Optional[str]:
    """主线程：写刷新日志、轮换 token、更新刷新时间。返回最新 last_refresh_at。"""
    task = outcome.task
    last_refresh_at = None

    try:
        conn.execute(
            """
            INSERT INTO account_refresh_logs (account_id, account_email, refresh_type, status, error_message, run_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                task.account_id,
                task.email,
                refresh_type,
                "success" if outcome.success else "failed",
                outcome.error_msg,
                run_id,
            ),
        )

        if outcome.success:
            new_token = outcome.new_refresh_token
            if isinstance(new_token, str) and new_token.strip() and new_token != task.refresh_token:
                conn.execute(
                    """
                    UPDATE accounts
                    SET refresh_token = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (encrypt_data(new_token), task.account_id),
                )
            conn.execute(
                """
                UPDATE accounts
                SET last_refresh_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (task.account_id,),
            )
            if read_back_last_refresh_at:
                row = conn.execute(
                    "SELECT last_refresh_at FROM accounts WHERE id = ?",
                    (task.account_id,),
                ).fetchone()
                if row:
                    last_refresh_at = row["last_refresh_at"]

        conn.commit()
    except Exception:
        pass

    return last_refresh_at


def _iter_wave_outcomes(
    wave: Sequence[RefreshTask],
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
    concurrency: int,
) -> Iterator[RefreshOutcome]:
    """执行一波账号，按完成顺序产出结果。

    concurrency <= 1 时走串行分支，不创建任何线程——与并发化之前逐字等价，
    也是线上出问题时把设置项调回 1 即可回滚的依据。
    """
    if concurrency <= 1 or len(wave) <= 1:
        for task in wave:
            yield _refresh_one_account(task, test_refresh_token)
        return

    with ThreadPoolExecutor(max_workers=min(concurrency, len(wave))) as executor:
        future_map = {executor.submit(_refresh_one_account, task, test_refresh_token): task for task in wave}
        for future in as_completed(future_map):
            task = future_map[future]
            try:
                yield future.result()
            except Exception as e:
                yield RefreshOutcome(task=task, success=False, error_msg=f"刷新异常: {str(e)}")


def normalize_refresh_concurrency(raw: Any, *, default: int = 5) -> int:
    """并发度归一化：默认 5，夹紧到 1..REFRESH_MAX_CONCURRENCY。"""
    try:
        value = int(raw if raw is not None else default)
    except (TypeError, ValueError):
        value = default
    if value < 1:
        return 1
    return min(value, REFRESH_MAX_CONCURRENCY)


def read_refresh_concurrency(conn) -> int:
    """从 settings 读取刷新并发度。"""
    try:
        row = conn.execute("SELECT value FROM settings WHERE key = 'refresh_concurrency'").fetchone()
    except Exception:
        return REFRESH_DEFAULT_CONCURRENCY
    return normalize_refresh_concurrency(row["value"] if row else None)


def run_refresh_batch(
    conn,
    tasks: Sequence[RefreshTask],
    *,
    refresh_type: str,
    run_id: Optional[str],
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
    stats: RefreshBatchStats,
    concurrency: int = 1,
    delay_seconds: int = 0,
    read_back_last_refresh_at: bool = False,
) -> Iterator[Dict[str, Any]]:
    """分波并发执行刷新，产出 progress / delay 事件。

    调用方传入 stats，生成器耗尽后从中读取汇总结果——这样流式（SSE）与
    非流式（聚合）两类调用方可以共用同一核心。

    DB 写入与计数归约都在本生成器所在线程完成，因此计数器无需加锁。
    """
    total = len(tasks)
    stats.total = total
    completed = 0

    wave_size = max(1, concurrency)
    waves = [tasks[i : i + wave_size] for i in range(0, total, wave_size)]

    for wave_index, wave in enumerate(waves):
        for outcome in _iter_wave_outcomes(wave, test_refresh_token, concurrency):
            last_refresh_at = _persist_outcome(
                conn,
                outcome,
                refresh_type=refresh_type,
                run_id=run_id,
                read_back_last_refresh_at=read_back_last_refresh_at,
            )
            stats.absorb(outcome)
            completed += 1

            yield {
                "type": "progress",
                "current": completed,
                "total": total,
                "email": outcome.task.email,
                "account_id": outcome.task.account_id,
                "result": "success" if outcome.success else "failed",
                "error_message": None if outcome.success else outcome.error_msg,
                "last_refresh_at": last_refresh_at,
                "success_count": stats.success_count,
                "failed_count": stats.failed_count,
            }

        is_last_wave = wave_index == len(waves) - 1
        if not is_last_wave and delay_seconds > 0:
            jitter = random.uniform(0, 2)
            wait_seconds = delay_seconds + jitter
            yield {"type": "delay", "seconds": wait_seconds}
            time.sleep(wait_seconds)


def _sse(payload: Dict[str, Any]) -> str:
    """统一的 SSE 编码。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _build_refresh_conflict_event(
    *,
    lock_info: Any,
    trace_id: Optional[str],
) -> Dict[str, Any]:
    """刷新锁冲突的统一错误载荷。"""
    return build_error_payload(
        code="REFRESH_CONFLICT",
        message="当前已有刷新任务执行中，请等待当前任务完成后再重试",
        err_type="ConflictError",
        status=409,
        details=lock_info or "",
        trace_id=trace_id,
        message_en="Another refresh task is already running. Wait for it to finish and retry.",
    )


def stream_refresh_all_accounts(
    *,
    trace_id: Optional[str],
    requested_by_ip: str,
    requested_by_user_agent: str,
    lock_name: str,
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
) -> Iterator[str]:
    """刷新所有账号 token（SSE 流式输出）"""
    conn = create_sqlite_connection()
    lock_owner_id = uuid.uuid4().hex
    lock_acquired = False
    run_id = None

    try:
        delay_row = conn.execute("SELECT value FROM settings WHERE key = 'refresh_delay_seconds'").fetchone()
        delay_seconds = int(delay_row["value"]) if delay_row else 5
        concurrency = read_refresh_concurrency(conn)

        try:
            conn.execute("DELETE FROM account_refresh_logs WHERE created_at < datetime('now', '-6 months')")
            conn.execute("DELETE FROM refresh_runs WHERE started_at < datetime('now', '-6 months')")
            conn.execute("DELETE FROM distributed_locks WHERE expires_at < ?", (time.time(),))
            conn.commit()
        except Exception:
            pass

        accounts = conn.execute(REFRESHABLE_OUTLOOK_ACCOUNT_SELECT).fetchall()
        total = len(accounts)

        run_id = create_refresh_run(
            conn,
            trigger_source="manual_all",
            trace_id=trace_id or generate_trace_id(),
            requested_by_ip=requested_by_ip,
            requested_by_user_agent=requested_by_user_agent,
            total=total,
        )

        ttl_seconds = compute_refresh_lock_ttl_seconds(total, delay_seconds, concurrency=concurrency)
        ok, lock_info = acquire_distributed_lock(conn, lock_name, lock_owner_id, ttl_seconds)
        if not ok:
            finish_refresh_run(conn, run_id, "skipped", total, 0, 0, "刷新任务冲突：已有刷新在执行")
            error_payload = _build_refresh_conflict_event(lock_info=lock_info, trace_id=trace_id)
            yield _sse({"type": "error", "error": error_payload})
            return
        lock_acquired = True

        stats = RefreshBatchStats()

        yield _sse(
            {
                "type": "start",
                "total": total,
                "delay_seconds": delay_seconds,
                "run_id": run_id,
                "trace_id": trace_id,
                "refresh_type": "manual_all",
            }
        )

        tasks = build_refresh_tasks(conn, accounts)
        for event in run_refresh_batch(
            conn,
            tasks,
            refresh_type="manual_all",
            run_id=run_id,
            test_refresh_token=test_refresh_token,
            stats=stats,
            concurrency=concurrency,
            delay_seconds=delay_seconds,
        ):
            yield _sse(event)

        finish_refresh_run(
            conn,
            run_id,
            "completed",
            total,
            stats.success_count,
            stats.failed_count,
            f"完成：成功 {stats.success_count}，失败 {stats.failed_count}",
        )

        yield _sse(
            {
                "type": "complete",
                "total": total,
                "success_count": stats.success_count,
                "failed_count": stats.failed_count,
                "failed_list": stats.failed_list,
                "invalid_token_failed_count": stats.invalid_token_failed_count,
                "invalid_token_failed_list": stats.invalid_token_failed_list,
                "run_id": run_id,
            }
        )
    except Exception as e:
        try:
            if run_id:
                finish_refresh_run(conn, run_id, "failed", 0, 0, 0, str(e))
        except Exception:
            pass
        error_payload = build_error_payload(
            code="REFRESH_SELECTED_STREAM_FAILED",
            message="批量刷新执行失败，请查看错误详情并按步骤重试",
            err_type="RefreshError",
            status=500,
            details={
                "cause": str(e),
                "hint": "检查所选账号状态与网络/代理设置后重试；若重复失败请使用 Trace ID 排查后端日志",
            },
            trace_id=trace_id,
            message_en="Selected account refresh failed. Check error details and retry with the suggested steps.",
        )
        yield f"data: {json.dumps({'type': 'error', 'error': error_payload}, ensure_ascii=False)}\n\n"
    finally:
        if lock_acquired:
            release_distributed_lock(conn, lock_name, lock_owner_id)
        try:
            conn.close()
        except Exception:
            pass


def stream_trigger_scheduled_refresh(
    *,
    force: bool,
    refresh_interval_days: int,
    use_cron: bool,
    trace_id: Optional[str],
    requested_by_ip: str,
    requested_by_user_agent: str,
    lock_name: str,
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
) -> Iterator[str]:
    """手动触发定时刷新（SSE 流式输出）"""
    conn = create_sqlite_connection()
    lock_owner_id = uuid.uuid4().hex
    lock_acquired = False
    run_id = None
    total = 0
    success_count = 0
    failed_count = 0

    try:
        delay_row = conn.execute("SELECT value FROM settings WHERE key = 'refresh_delay_seconds'").fetchone()
        delay_seconds = int(delay_row["value"]) if delay_row else 5
        concurrency = read_refresh_concurrency(conn)

        try:
            conn.execute("DELETE FROM account_refresh_logs WHERE created_at < datetime('now', '-6 months')")
            conn.commit()
        except Exception:
            pass

        accounts = conn.execute(REFRESHABLE_OUTLOOK_ACCOUNT_SELECT).fetchall()

        total = len(accounts)
        run_id = create_refresh_run(
            conn,
            trigger_source="scheduled_manual",
            trace_id=trace_id or generate_trace_id(),
            requested_by_ip=requested_by_ip,
            requested_by_user_agent=requested_by_user_agent,
            total=total,
        )

        if (not force) and (not use_cron):
            row = conn.execute("""
                SELECT finished_at
                FROM refresh_runs
                WHERE trigger_source IN ('scheduled', 'scheduled_manual')
                  AND status IN ('completed', 'failed')
                  AND finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1
            """).fetchone()

            if row and row["finished_at"]:
                try:
                    last_time = datetime.fromisoformat(row["finished_at"])
                except Exception:
                    last_time = None

                if last_time:
                    next_due = last_time + timedelta(days=refresh_interval_days)
                    if utcnow() < next_due:
                        finish_refresh_run(
                            conn,
                            run_id,
                            "skipped",
                            0,
                            0,
                            0,
                            f"距离上次刷新未满 {refresh_interval_days} 天，下次最早：{next_due.strftime('%Y-%m-%d %H:%M:%S')}",
                        )
                        yield (
                            "data: "
                            + json.dumps(
                                {
                                    "type": "skipped",
                                    "message": "未到刷新周期",
                                    "next_due": next_due.isoformat(),
                                    "run_id": run_id,
                                },
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                        return

        ttl_seconds = compute_refresh_lock_ttl_seconds(total, delay_seconds, concurrency=concurrency)
        ok, lock_info = acquire_distributed_lock(conn, lock_name, lock_owner_id, ttl_seconds)
        if not ok:
            finish_refresh_run(conn, run_id, "skipped", total, 0, 0, "刷新任务冲突：已有刷新在执行")
            error_payload = _build_refresh_conflict_event(lock_info=lock_info, trace_id=trace_id)
            yield _sse({"type": "error", "error": error_payload})
            return
        lock_acquired = True

        stats = RefreshBatchStats()

        yield _sse(
            {
                "type": "start",
                "total": total,
                "delay_seconds": delay_seconds,
                "refresh_type": "scheduled",
                "run_id": run_id,
                "trace_id": trace_id,
            }
        )

        tasks = build_refresh_tasks(conn, accounts)
        for event in run_refresh_batch(
            conn,
            tasks,
            refresh_type="scheduled",
            run_id=run_id,
            test_refresh_token=test_refresh_token,
            stats=stats,
            concurrency=concurrency,
            delay_seconds=delay_seconds,
        ):
            yield _sse(event)

        success_count = stats.success_count
        failed_count = stats.failed_count

        finish_refresh_run(
            conn,
            run_id,
            "completed",
            total,
            success_count,
            failed_count,
            f"完成：成功 {success_count}，失败 {failed_count}",
        )

        yield _sse(
            {
                "type": "complete",
                "total": total,
                "success_count": success_count,
                "failed_count": failed_count,
                "failed_list": stats.failed_list,
                "invalid_token_failed_count": stats.invalid_token_failed_count,
                "invalid_token_failed_list": stats.invalid_token_failed_list,
                "run_id": run_id,
            }
        )
    except Exception as e:
        try:
            if run_id:
                finish_refresh_run(conn, run_id, "failed", total, success_count, failed_count, str(e))
        except Exception:
            pass
        error_payload = build_error_payload(
            code="REFRESH_FAILED",
            message="刷新执行失败",
            err_type="RefreshError",
            status=500,
            details=str(e),
            trace_id=trace_id,
        )
        yield f"data: {json.dumps({'type': 'error', 'error': error_payload}, ensure_ascii=False)}\n\n"
    finally:
        if lock_acquired:
            release_distributed_lock(conn, lock_name, lock_owner_id)
        try:
            conn.close()
        except Exception:
            pass


def stream_refresh_selected_accounts(
    *,
    account_ids: List[int],
    trace_id: Optional[str],
    requested_by_ip: str,
    requested_by_user_agent: str,
    lock_name: str,
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
) -> Iterator[str]:
    """刷新指定账号列表的 token（SSE 流式输出）"""
    conn = create_sqlite_connection()
    lock_owner_id = uuid.uuid4().hex
    lock_acquired = False
    run_id = None

    try:
        delay_row = conn.execute("SELECT value FROM settings WHERE key = 'refresh_delay_seconds'").fetchone()
        delay_seconds = int(delay_row["value"]) if delay_row else 5
        concurrency = read_refresh_concurrency(conn)

        try:
            conn.execute("DELETE FROM account_refresh_logs WHERE created_at < datetime('now', '-6 months')")
            conn.execute("DELETE FROM refresh_runs WHERE started_at < datetime('now', '-6 months')")
            conn.execute("DELETE FROM distributed_locks WHERE expires_at < ?", (time.time(),))
            conn.commit()
        except Exception:
            pass

        # 查询指定 ID 的账号，过滤出 Outlook 类型（IMAP 账号跳过）
        placeholders = ",".join("?" * len(account_ids))
        all_rows = conn.execute(
            f"""
            SELECT id, email, client_id, refresh_token, group_id, account_type, provider
            FROM accounts
            WHERE id IN ({placeholders})
              AND status = 'active'
            """,
            account_ids,
        ).fetchall()

        accounts = [row for row in all_rows if is_refreshable_outlook_account(row["account_type"], provider=row["provider"])]
        skipped_count = len(all_rows) - len(accounts)
        total = len(accounts)

        run_id = create_refresh_run(
            conn,
            trigger_source="manual_selected",
            trace_id=trace_id or generate_trace_id(),
            requested_by_ip=requested_by_ip,
            requested_by_user_agent=requested_by_user_agent,
            total=total,
        )

        ttl_seconds = compute_refresh_lock_ttl_seconds(total, delay_seconds, concurrency=concurrency)
        ok, lock_info = acquire_distributed_lock(conn, lock_name, lock_owner_id, ttl_seconds)
        if not ok:
            finish_refresh_run(conn, run_id, "skipped", total, 0, 0, "刷新任务冲突：已有刷新在执行")
            error_payload = _build_refresh_conflict_event(lock_info=lock_info, trace_id=trace_id)
            yield _sse({"type": "error", "error": error_payload})
            return
        lock_acquired = True

        stats = RefreshBatchStats()

        yield _sse(
            {
                "type": "start",
                "total": total,
                "skipped_count": skipped_count,
                "delay_seconds": delay_seconds,
                "run_id": run_id,
                "trace_id": trace_id,
                "refresh_type": "manual_selected",
            }
        )

        tasks = build_refresh_tasks(conn, accounts)
        for event in run_refresh_batch(
            conn,
            tasks,
            refresh_type="manual_selected",
            run_id=run_id,
            test_refresh_token=test_refresh_token,
            stats=stats,
            concurrency=concurrency,
            delay_seconds=delay_seconds,
            read_back_last_refresh_at=True,
        ):
            yield _sse(event)

        finish_refresh_run(
            conn,
            run_id,
            "completed",
            total,
            stats.success_count,
            stats.failed_count,
            f"完成：成功 {stats.success_count}，失败 {stats.failed_count}",
        )

        yield _sse(
            {
                "type": "complete",
                "total": total,
                "success_count": stats.success_count,
                "failed_count": stats.failed_count,
                "failed_list": stats.failed_list,
                "invalid_token_failed_count": stats.invalid_token_failed_count,
                "invalid_token_failed_list": stats.invalid_token_failed_list,
                "run_id": run_id,
            }
        )
    except Exception as e:
        try:
            if run_id:
                finish_refresh_run(conn, run_id, "failed", 0, 0, 0, str(e))
        except Exception:
            pass
        error_payload = build_error_payload(
            code="REFRESH_FAILED",
            message="刷新执行失败",
            err_type="RefreshError",
            status=500,
            details=str(e),
            trace_id=trace_id,
        )
        yield f"data: {json.dumps({'type': 'error', 'error': error_payload}, ensure_ascii=False)}\n\n"
    finally:
        if lock_acquired:
            release_distributed_lock(conn, lock_name, lock_owner_id)
        try:
            conn.close()
        except Exception:
            pass


def refresh_failed_accounts(
    *,
    db,
    trace_id: Optional[str],
    requested_by_ip: str,
    requested_by_user_agent: str,
    lock_name: str,
    test_refresh_token: Callable[[str, str, Optional[str]], Tuple[bool, Optional[str], Optional[str]]],
) -> Tuple[Dict[str, Any], int]:
    """重试所有失败的账号（非流式）"""
    lock_owner_id = uuid.uuid4().hex

    cursor = db.execute(f"""
        SELECT DISTINCT a.id, a.email, a.client_id, a.refresh_token, a.group_id
        FROM accounts a
        INNER JOIN (
            SELECT account_id, MAX(created_at) as last_refresh
            FROM account_refresh_logs
            GROUP BY account_id
        ) latest ON a.id = latest.account_id
        INNER JOIN account_refresh_logs l ON a.id = l.account_id AND l.created_at = latest.last_refresh
        WHERE l.status = 'failed'
          AND a.status = 'active'
          AND {build_refreshable_outlook_account_where("a.account_type", "a.provider")}
    """)
    accounts = cursor.fetchall()

    total = len(accounts)
    run_id = create_refresh_run(
        db,
        trigger_source="retry_failed",
        trace_id=trace_id or generate_trace_id(),
        requested_by_ip=requested_by_ip,
        requested_by_user_agent=requested_by_user_agent,
        total=total,
    )

    concurrency = read_refresh_concurrency(db)
    ttl_seconds = compute_refresh_lock_ttl_seconds(total, 0, concurrency=concurrency)
    ok, lock_info = acquire_distributed_lock(db, lock_name, lock_owner_id, ttl_seconds)
    if not ok:
        finish_refresh_run(db, run_id, "skipped", total, 0, 0, "刷新任务冲突：已有刷新在执行")
        error_payload = _build_refresh_conflict_event(lock_info=lock_info, trace_id=trace_id)
        return {"success": False, "error": error_payload}, 409

    stats = RefreshBatchStats()

    try:
        tasks = build_refresh_tasks(db, accounts)
        # 非流式调用：耗尽生成器即可，汇总结果从 stats 读取
        for _event in run_refresh_batch(
            db,
            tasks,
            refresh_type="retry",
            run_id=run_id,
            test_refresh_token=test_refresh_token,
            stats=stats,
            concurrency=concurrency,
            delay_seconds=0,
        ):
            pass
    finally:
        release_distributed_lock(db, lock_name, lock_owner_id)

    finish_refresh_run(
        db,
        run_id,
        "completed",
        total,
        stats.success_count,
        stats.failed_count,
        f"完成：成功 {stats.success_count}，失败 {stats.failed_count}",
    )

    return (
        {
            "success": True,
            "run_id": run_id,
            "total": total,
            "success_count": stats.success_count,
            "failed_count": stats.failed_count,
            "failed_list": stats.failed_list,
            "invalid_token_failed_count": stats.invalid_token_failed_count,
            "invalid_token_failed_list": stats.invalid_token_failed_list,
        },
        200,
    )
