from __future__ import annotations

import sqlite3
import uuid
from typing import Any, Dict, Optional


def create_refresh_run(
    conn: sqlite3.Connection,
    trigger_source: str,
    trace_id: str,
    requested_by_ip: str = None,
    requested_by_user_agent: str = None,
    total: int = 0,
) -> str:
    run_id = uuid.uuid4().hex
    conn.execute(
        """
        INSERT INTO refresh_runs (
            id, trigger_source, status,
            requested_by_ip, requested_by_user_agent,
            total, success_count, failed_count,
            trace_id
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
        """,
        (
            run_id,
            trigger_source,
            "running",
            requested_by_ip,
            requested_by_user_agent,
            total,
            trace_id,
        ),
    )
    conn.commit()
    return run_id


def finish_refresh_run(
    conn: sqlite3.Connection,
    run_id: str,
    status: str,
    total: int,
    success_count: int,
    failed_count: int,
    message: str = None,
):
    conn.execute(
        """
        UPDATE refresh_runs
        SET status = ?, finished_at = CURRENT_TIMESTAMP,
            total = ?, success_count = ?, failed_count = ?, message = ?
        WHERE id = ?
        """,
        (status, total, success_count, failed_count, message, run_id),
    )
    conn.commit()


def update_refresh_run_progress(
    conn: sqlite3.Connection,
    run_id: str,
    *,
    total: int,
    success_count: int,
    failed_count: int,
) -> None:
    """中途更新运行进度，便于状态查询与前端进度条。"""
    if not run_id:
        return
    conn.execute(
        """
        UPDATE refresh_runs
        SET total = ?, success_count = ?, failed_count = ?
        WHERE id = ? AND status IN ('running', 'cancelling')
        """,
        (total, success_count, failed_count, run_id),
    )
    conn.commit()


def request_cancel_refresh_run(conn: sqlite3.Connection, run_id: Optional[str] = None) -> Optional[str]:
    """将 running 任务标记为 cancelling。

    若未指定 run_id，则取消最近一条 running 任务。
    返回被请求取消的 run_id；无可取消任务时返回 None。
    """
    target_id = run_id
    if not target_id:
        row = conn.execute(
            """
            SELECT id
            FROM refresh_runs
            WHERE status = 'running'
            ORDER BY started_at DESC
            LIMIT 1
            """
        ).fetchone()
        if not row:
            return None
        target_id = row["id"]

    cursor = conn.execute(
        """
        UPDATE refresh_runs
        SET status = 'cancelling',
            message = COALESCE(message, '用户请求取消')
        WHERE id = ? AND status = 'running'
        """,
        (target_id,),
    )
    conn.commit()
    if cursor.rowcount and cursor.rowcount > 0:
        return target_id

    # 已是 cancelling 也视为成功命中
    row = conn.execute(
        "SELECT id, status FROM refresh_runs WHERE id = ?",
        (target_id,),
    ).fetchone()
    if row and row["status"] == "cancelling":
        return target_id
    return None


def is_refresh_run_cancel_requested(conn: sqlite3.Connection, run_id: Optional[str]) -> bool:
    if not run_id:
        return False
    row = conn.execute(
        "SELECT status FROM refresh_runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    return bool(row and row["status"] == "cancelling")


def get_running_refresh_run(conn: sqlite3.Connection) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT id, trigger_source, status, started_at, finished_at,
               total, success_count, failed_count, message, trace_id,
               requested_by_ip
        FROM refresh_runs
        WHERE status IN ('running', 'cancelling')
        ORDER BY started_at DESC
        LIMIT 1
        """
    ).fetchone()
    return dict(row) if row else None


def get_refresh_run(conn: sqlite3.Connection, run_id: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT id, trigger_source, status, started_at, finished_at,
               total, success_count, failed_count, message, trace_id,
               requested_by_ip
        FROM refresh_runs
        WHERE id = ?
        """,
        (run_id,),
    ).fetchone()
    return dict(row) if row else None
