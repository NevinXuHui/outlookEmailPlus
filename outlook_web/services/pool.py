"""
邮箱池服务层（PRD-00009 MT-1）

职责：
- 输入校验（caller_id / task_id / lease_seconds / result / detail 长度）
- 读取 settings（在 Flask app_context 下用 get_db，或直接接受 conn）
- 调用 repositories/pool.py 的原子操作
- 将 repository 层的异常转换为业务错误码
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from flask import current_app, has_app_context

from outlook_web.db import create_sqlite_connection
from outlook_web.repositories import pool as pool_repo
from outlook_web.security.crypto import decrypt_data, encrypt_data
from outlook_web.services import graph as graph_service
from outlook_web.services.imap_generic import get_emails_imap_generic

logger = logging.getLogger(__name__)

CALLER_ID_MAX_LEN = 64
TASK_ID_MAX_LEN = 128
PROJECT_KEY_MAX_LEN = 128
EMAIL_DOMAIN_MAX_LEN = 128
GROUP_NAME_MAX_LEN = 128
REASON_MAX_LEN = 256
DETAIL_MAX_LEN = 512

VALID_RESULTS = set(pool_repo.RESULT_TO_POOL_STATUS.keys())

# CF 邮箱 complete 时需要删除远程邮箱的 result 值
CF_DELETE_ON_RESULTS = {"success", "credential_invalid"}

# 支持的 provider 白名单（空字符串视为 None，不做校验）
VALID_PROVIDERS = {"outlook", "imap", "custom", "gptmail", "cloudflare_temp_mail"}

# 这些 provider（含未指定）在 accounts 池无命中时，回退到 temp_emails 临时邮箱池领取。
# custom/gptmail 对应「通用 API (GPTMail)」临时邮箱；None 表示不限 provider。
_TEMP_ELIGIBLE_PROVIDERS = {None, "custom", "gptmail"}


@dataclass(frozen=True)
class PoolClaimHealthResult:
    ok: bool
    result: str = "network_error"
    detail: str = ""


def _validate_provider(provider: Optional[str]) -> Optional[str]:
    """
    校验 provider 参数。

    - 空字符串视为 None
    - 非空时校验是否在 VALID_PROVIDERS 中
    - 返回规范化后的 provider（None 或有效值）
    """
    if provider is None:
        return None
    p = provider.strip()
    if not p:
        return None
    if p not in VALID_PROVIDERS:
        raise PoolServiceError(
            f"provider 必须是 {sorted(VALID_PROVIDERS)} 之一，或留空",
            "invalid_provider",
        )
    return p


class PoolServiceError(Exception):
    """业务错误，包含 HTTP 状态码和错误码。"""

    def __init__(self, message: str, error_code: str, http_status: int = 400):
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status


def _validate_caller_id(caller_id: str) -> None:
    if not caller_id or not caller_id.strip():
        raise PoolServiceError("caller_id 不能为空", "caller_id_empty")
    if len(caller_id) > CALLER_ID_MAX_LEN:
        raise PoolServiceError(f"caller_id 超过最大长度 {CALLER_ID_MAX_LEN}", "caller_id_too_long")


def _validate_task_id(task_id: str) -> None:
    if not task_id or not task_id.strip():
        raise PoolServiceError("task_id 不能为空", "task_id_empty")
    if len(task_id) > TASK_ID_MAX_LEN:
        raise PoolServiceError(f"task_id 超过最大长度 {TASK_ID_MAX_LEN}", "task_id_too_long")


def _validate_lease_seconds(lease_seconds: int, max_lease: int = 3600) -> None:
    if lease_seconds <= 0:
        raise PoolServiceError("lease_seconds 必须大于 0", "lease_seconds_invalid")
    if lease_seconds > max_lease:
        raise PoolServiceError(f"lease_seconds 不能超过 {max_lease} 秒", "lease_seconds_too_large")


def _validate_project_key(project_key: Optional[str]) -> Optional[str]:
    if project_key is None:
        return None
    pk = project_key.strip()
    if not pk:
        return None
    if len(pk) > PROJECT_KEY_MAX_LEN:
        raise PoolServiceError(f"project_key 超过最大长度 {PROJECT_KEY_MAX_LEN}", "project_key_too_long")
    return pk


def _validate_email_domain(email_domain: Optional[str]) -> Optional[str]:
    if email_domain is None:
        return None
    d = email_domain.strip().lower()
    if not d:
        return None
    if len(d) > EMAIL_DOMAIN_MAX_LEN:
        raise PoolServiceError(f"email_domain 超过最大长度 {EMAIL_DOMAIN_MAX_LEN}", "email_domain_too_long")
    return d


def _normalize_group_id(group_id: Any) -> Optional[int]:
    """规范化 group_id；空值视为 None，非法值抛 invalid_group_id。"""
    if group_id is None:
        return None
    if isinstance(group_id, bool):
        raise PoolServiceError("group_id 必须是正整数", "invalid_group_id")
    if isinstance(group_id, int):
        if group_id <= 0:
            raise PoolServiceError("group_id 必须是正整数", "invalid_group_id")
        return group_id
    text = str(group_id).strip()
    if not text:
        return None
    if not text.isdigit():
        raise PoolServiceError("group_id 必须是正整数", "invalid_group_id")
    value = int(text)
    if value <= 0:
        raise PoolServiceError("group_id 必须是正整数", "invalid_group_id")
    return value


def _normalize_group_name(group_name: Optional[str]) -> Optional[str]:
    if group_name is None:
        return None
    name = str(group_name).strip()
    if not name:
        return None
    if len(name) > GROUP_NAME_MAX_LEN:
        raise PoolServiceError(
            f"group_name 超过最大长度 {GROUP_NAME_MAX_LEN}",
            "group_name_too_long",
        )
    return name


def _resolve_group_id(
    conn,
    *,
    group_id: Any = None,
    group_name: Optional[str] = None,
) -> Optional[int]:
    """
    将 group_id / group_name 解析为最终筛选用 group_id。

    - 两者都未提供：返回 None（不按分组筛选）
    - 仅 group_id：校验分组存在
    - 仅 group_name：按名称（不区分大小写）解析
    - 同时提供：必须指向同一分组，否则 group_mismatch
    """
    gid = _normalize_group_id(group_id)
    gname = _normalize_group_name(group_name)

    if gid is None and gname is None:
        return None

    if gid is not None and gname is not None:
        row = conn.execute(
            "SELECT id, name FROM groups WHERE id = ?",
            (gid,),
        ).fetchone()
        if row is None:
            raise PoolServiceError("指定分组不存在", "group_not_found")
        if str(row["name"] or "").strip().lower() != gname.lower():
            raise PoolServiceError("group_id 与 group_name 不匹配", "group_mismatch")
        return int(row["id"])

    if gid is not None:
        row = conn.execute("SELECT id FROM groups WHERE id = ?", (gid,)).fetchone()
        if row is None:
            raise PoolServiceError("指定分组不存在", "group_not_found")
        return int(row["id"])

    row = conn.execute(
        "SELECT id FROM groups WHERE LOWER(name) = LOWER(?) LIMIT 1",
        (gname,),
    ).fetchone()
    if row is None:
        raise PoolServiceError("指定分组不存在", "group_not_found")
    return int(row["id"])


def _read_settings_via_conn(conn) -> dict:
    """在独立连接场景下直接从 settings 表读取池相关配置。"""
    rows = conn.execute(
        "SELECT key, value FROM settings WHERE key IN (?, ?)",
        ("pool_cooldown_seconds", "pool_default_lease_seconds"),
    ).fetchall()
    result = {"pool_cooldown_seconds": 86400, "pool_default_lease_seconds": 600}
    for row in rows:
        try:
            result[row["key"]] = int(row["value"])
        except (TypeError, ValueError):
            pass
    return result


def _pool_claim_health_check_enabled() -> bool:
    """测试环境默认跳过真实上游验证；生产接口默认启用。"""
    if os.environ.get("POOL_CLAIM_HEALTH_CHECK_IN_TESTS") == "true":
        return True
    if "outlookEmail-tests-" in os.environ.get("DATABASE_PATH", ""):
        return False
    if has_app_context() and current_app.config.get("TESTING"):
        return bool(current_app.config.get("POOL_CLAIM_HEALTH_CHECK_ENABLED_IN_TESTS"))
    return True


def _decrypt_claimed_account_credentials(account: dict) -> tuple[dict, Optional[str]]:
    hydrated = dict(account or {})
    for field_name in ("password", "refresh_token", "imap_password"):
        value = hydrated.get(field_name)
        if not value:
            continue
        try:
            hydrated[field_name] = decrypt_data(str(value))
        except Exception as exc:
            return hydrated, f"{field_name} 解密失败: {exc}"
    return hydrated, None


def _get_claim_account_proxy_url(conn, account: dict) -> str:
    group_id = account.get("group_id")
    if not group_id:
        return ""
    try:
        row = conn.execute("SELECT proxy_url FROM groups WHERE id = ?", (int(group_id),)).fetchone()
        return str((row or {})["proxy_url"] or "") if row else ""
    except Exception:
        return ""


def _is_transient_health_error(message: str) -> bool:
    text = str(message or "").lower()
    transient_markers = (
        "timeout",
        "timed out",
        "connection",
        "proxy",
        "network",
        "429",
        "rate limit",
        "temporarily",
        "请求异常",
        "请求被限流",
        "代理",
        "连接",
        "超时",
        "网络",
    )
    return any(marker in text for marker in transient_markers)


def _failed_claim_health_result(message: str) -> PoolClaimHealthResult:
    result = "network_error" if _is_transient_health_error(message) else "credential_invalid"
    return PoolClaimHealthResult(False, result=result, detail=str(message or "邮箱健康验证失败")[:DETAIL_MAX_LEN])


def _persist_rotated_refresh_token(conn, account_id: int, refresh_token: str) -> None:
    conn.execute(
        "UPDATE accounts SET refresh_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (encrypt_data(refresh_token), int(account_id)),
    )
    conn.commit()


def _check_claimed_account_health(conn, account: dict) -> PoolClaimHealthResult:
    if not _pool_claim_health_check_enabled():
        return PoolClaimHealthResult(True)

    hydrated, decrypt_error = _decrypt_claimed_account_credentials(account)
    if decrypt_error:
        return PoolClaimHealthResult(False, result="credential_invalid", detail=decrypt_error[:DETAIL_MAX_LEN])

    account_type = str(hydrated.get("account_type") or "outlook").strip().lower()
    provider = str(hydrated.get("provider") or "").strip().lower()
    if account_type == "temp_mail" or provider == "cloudflare_temp_mail":
        return PoolClaimHealthResult(True)

    email_addr = str(hydrated.get("email") or "").strip()
    proxy_url = _get_claim_account_proxy_url(conn, hydrated)

    if account_type == "imap":
        if not str(hydrated.get("imap_host") or "").strip() or not str(hydrated.get("imap_password") or "").strip():
            return PoolClaimHealthResult(False, result="credential_invalid", detail="IMAP 配置不完整")
        result = get_emails_imap_generic(
            email_addr=email_addr,
            imap_password=hydrated.get("imap_password", "") or "",
            imap_host=hydrated.get("imap_host", "") or "",
            imap_port=hydrated.get("imap_port", 993) or 993,
            folder="inbox",
            provider=hydrated.get("provider", "_default") or "_default",
            skip=0,
            top=1,
        )
        if result.get("success"):
            return PoolClaimHealthResult(True)
        return _failed_claim_health_result(result.get("error") or "IMAP 读取失败")

    client_id = str(hydrated.get("client_id") or "").strip()
    refresh_token = str(hydrated.get("refresh_token") or "").strip()
    if not client_id or not refresh_token:
        return PoolClaimHealthResult(False, result="credential_invalid", detail="OAuth 凭据不完整")

    ok, error_msg, new_refresh_token = graph_service.test_refresh_token_with_rotation(
        client_id,
        refresh_token,
        proxy_url,
    )
    if not ok:
        return _failed_claim_health_result(error_msg or "Refresh token 验证失败")

    if new_refresh_token and new_refresh_token != refresh_token:
        _persist_rotated_refresh_token(conn, int(hydrated["id"]), new_refresh_token)

    return PoolClaimHealthResult(True)


def _complete_failed_claim_health_check(
    conn,
    account: dict,
    *,
    caller_id: str,
    task_id: str,
    health: PoolClaimHealthResult,
    project_key: Optional[str],
) -> None:
    detail = f"claim 前健康验证失败: {health.detail or health.result}"
    pool_repo.complete(
        conn,
        int(account["id"]),
        str(account["claim_token"]),
        caller_id,
        task_id,
        health.result if health.result in VALID_RESULTS else "network_error",
        detail[:DETAIL_MAX_LEN],
        claimed_project_key=project_key,
        enable_project_reuse=False,
    )


def _is_project_reuse_eligible_account(
    *,
    provider: Optional[str],
    account_type: Optional[str],
    claimed_project_key: Optional[str],
) -> bool:
    """判定账号是否适用项目维度成功复用路径 (FD §2.1)。

    三重门控缺一不可：
    1. claimed_project_key 非空 — 必须在 claim 时显式传入
    2. 非 cloudflare_temp_mail — CF 临时邮箱不在本期覆盖范围
    3. 非 temp_mail — 一次性临时邮箱不在本期覆盖范围
    """
    if not claimed_project_key:
        return False
    if (provider or "").strip() == "cloudflare_temp_mail":
        return False
    if (account_type or "").strip() == "temp_mail":
        return False
    return True


def claim_random(
    *,
    caller_id: str,
    task_id: str,
    provider: Optional[str] = None,
    project_key: Optional[str] = None,
    email_domain: Optional[str] = None,
    group_id: Any = None,
    group_name: Optional[str] = None,
) -> dict:
    _validate_caller_id(caller_id)
    _validate_task_id(task_id)
    provider = _validate_provider(provider)
    project_key = _validate_project_key(project_key)
    email_domain = _validate_email_domain(email_domain)
    # 先做参数形态校验，真正存在性解析放到拿到 conn 之后
    _normalize_group_id(group_id)
    _normalize_group_name(group_name)

    conn = create_sqlite_connection()
    try:
        resolved_group_id = _resolve_group_id(
            conn,
            group_id=group_id,
            group_name=group_name,
        )
        settings = _read_settings_via_conn(conn)
        default_lease = settings["pool_default_lease_seconds"]
        _validate_lease_seconds(default_lease)

        attempted_account_ids: list[int] = []
        last_health_error = ""
        while True:
            try:
                account = pool_repo.claim_atomic(
                    conn,
                    caller_id=caller_id,
                    task_id=task_id,
                    lease_seconds=default_lease,
                    provider=provider,
                    group_id=resolved_group_id,
                    project_key=project_key,
                    email_domain=email_domain,
                    exclude_account_ids=attempted_account_ids,
                )
            except pool_repo.PoolRepositoryError as e:
                # 将 Repository 层异常转换为 Service 层异常
                raise PoolServiceError(str(e), e.error_code, http_status=500) from e

            if account is None:
                break

            attempted_account_ids.append(int(account["id"]))
            health = _check_claimed_account_health(conn, account)
            if health.ok:
                return account

            last_health_error = health.detail or health.result
            logger.warning(
                "[pool] claim 前健康验证失败 account_id=%s email=%s result=%s detail=%s",
                account.get("id"),
                account.get("email"),
                health.result,
                last_health_error,
            )
            try:
                _complete_failed_claim_health_check(
                    conn,
                    account,
                    caller_id=caller_id,
                    task_id=task_id,
                    health=health,
                    project_key=project_key,
                )
            except pool_repo.PoolRepositoryError as e:
                raise PoolServiceError(str(e), e.error_code, http_status=500) from e

        # 指定分组时只从该分组 accounts 领取，不做 temp/CF 回退
        if resolved_group_id is None:
            # accounts 池无命中：对临时邮箱类 provider（custom/gptmail/未指定）回退到 temp_emails 池领取
            if provider in _TEMP_ELIGIBLE_PROVIDERS:
                try:
                    temp_account = pool_repo.claim_temp_mailbox_atomic(
                        conn,
                        caller_id=caller_id,
                        task_id=task_id,
                        lease_seconds=default_lease,
                        email_domain=email_domain,
                    )
                except pool_repo.PoolRepositoryError as e:
                    raise PoolServiceError(str(e), e.error_code, http_status=500) from e
                if temp_account is not None:
                    return temp_account

            # 池为空：仅当显式指定 provider=cloudflare_temp_mail 时，动态创建 CF 临时邮箱
            if provider == "cloudflare_temp_mail":
                created_email, created_meta = _create_cf_mailbox_for_pool(email_domain=email_domain)

                try:
                    inserted = pool_repo.insert_claimed_account(
                        conn,
                        email=created_email,
                        caller_id=caller_id,
                        task_id=task_id,
                        lease_seconds=default_lease,
                        provider="cloudflare_temp_mail",
                        account_type="temp_mail",
                        project_key=project_key,
                        temp_mail_meta=created_meta,
                        claim_log_detail="CF邮箱动态创建",
                    )
                    return inserted
                except pool_repo.PoolRepositoryError as e:
                    # DB 写入失败时，尽力删除已创建的远程邮箱，避免资源泄漏（非阻塞）
                    _delete_cf_mailbox_nonblocking(email=created_email, meta=created_meta)
                    raise PoolServiceError(str(e), e.error_code, http_status=500) from e
                except Exception as e:
                    _delete_cf_mailbox_nonblocking(email=created_email, meta=created_meta)
                    raise PoolServiceError("动态写入 CF 邮箱失败", "db_error", http_status=500) from e

        if attempted_account_ids:
            detail = f"最后一次失败原因: {last_health_error}" if last_health_error else ""
            raise PoolServiceError(
                f"池中没有通过健康验证的可用邮箱{('，' + detail) if detail else ''}",
                "no_available_account",
                http_status=200,
            )
        raise PoolServiceError("池中没有符合条件的可用邮箱", "no_available_account", http_status=200)
    finally:
        conn.close()


def _validate_claim_ownership(
    row: Optional[dict],
    *,
    action: str,
    claim_token: str,
    caller_id: str,
    task_id: str,
) -> None:
    """校验 release/complete 的领取归属（accounts 与 temp_emails 共用）。"""
    if row is None:
        raise PoolServiceError("账号不存在", "account_not_found", http_status=400)
    if row.get("pool_status") != "claimed":
        raise PoolServiceError(
            f"账号当前状态为 '{row.get('pool_status')}'，无法 {action}",
            "not_claimed",
            http_status=409,
        )
    if row.get("claim_token") != claim_token:
        raise PoolServiceError("claim_token 不匹配", "token_mismatch", http_status=403)
    if row.get("claimed_by") != f"{caller_id}:{task_id}":
        raise PoolServiceError(
            "caller_id 或 task_id 与领取记录不一致",
            "caller_mismatch",
            http_status=403,
        )


def release_claim(
    *,
    account_id: int,
    claim_token: str,
    caller_id: str,
    task_id: str,
    reason: Optional[str] = None,
) -> None:
    """释放已领取的邮箱账号（不计入成功/失败统计，直接回 available）。"""
    _validate_caller_id(caller_id)
    _validate_task_id(task_id)
    if not claim_token or not claim_token.strip():
        raise PoolServiceError("claim_token 不能为空", "claim_token_empty")
    if reason and len(reason) > REASON_MAX_LEN:
        raise PoolServiceError(f"reason 超过最大长度 {REASON_MAX_LEN}", "reason_too_long")

    conn = create_sqlite_connection()
    try:
        # 临时邮箱池账号：account_id 带偏移，路由到 temp_emails
        if pool_repo.is_temp_pool_account_id(account_id):
            temp_id = pool_repo.temp_id_from_account_id(account_id)
            temp_row = pool_repo.get_temp_mailbox_pool_row(conn, temp_id)
            _validate_claim_ownership(
                temp_row, action="release", claim_token=claim_token, caller_id=caller_id, task_id=task_id
            )
            pool_repo.release_temp_mailbox(conn, temp_id, claim_token, caller_id, task_id, reason)
            return

        row = conn.execute(
            "SELECT id, claim_token, claimed_by, pool_status FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        _validate_claim_ownership(
            dict(row) if row is not None else None,
            action="release",
            claim_token=claim_token,
            caller_id=caller_id,
            task_id=task_id,
        )

        pool_repo.release(conn, account_id, claim_token, caller_id, task_id, reason)
    finally:
        conn.close()


def complete_claim(
    *,
    account_id: int,
    claim_token: str,
    caller_id: str,
    task_id: str,
    result: str,
    detail: Optional[str] = None,
) -> str:
    """
    标记领取结果并驱动状态机流转。

    返回账号的新 pool_status。
    """
    _validate_caller_id(caller_id)
    _validate_task_id(task_id)
    if not claim_token or not claim_token.strip():
        raise PoolServiceError("claim_token 不能为空", "claim_token_empty")
    if result not in VALID_RESULTS:
        raise PoolServiceError(
            f"result 必须是 {sorted(VALID_RESULTS)} 之一",
            "invalid_result",
        )
    if detail and len(detail) > DETAIL_MAX_LEN:
        raise PoolServiceError(f"detail 超过最大长度 {DETAIL_MAX_LEN}", "detail_too_long")

    conn = create_sqlite_connection()
    try:
        # 临时邮箱池账号：account_id 带偏移，路由到 temp_emails（一次性资源，无项目复用/CF 删除）
        if pool_repo.is_temp_pool_account_id(account_id):
            temp_id = pool_repo.temp_id_from_account_id(account_id)
            temp_row = pool_repo.get_temp_mailbox_pool_row(conn, temp_id)
            _validate_claim_ownership(
                temp_row, action="complete", claim_token=claim_token, caller_id=caller_id, task_id=task_id
            )
            return pool_repo.complete_temp_mailbox(conn, temp_id, claim_token, caller_id, task_id, result, detail)

        row = conn.execute(
            """
            SELECT id, email, provider, account_type, temp_mail_meta,
                   claimed_project_key,
                   claim_token, claimed_by, pool_status
            FROM accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()
        _validate_claim_ownership(
            dict(row) if row is not None else None,
            action="complete",
            claim_token=claim_token,
            caller_id=caller_id,
            task_id=task_id,
        )

        # 从 claim 上下文读取 claimed_project_key，而非依赖 API 入参
        # 保证 claim-complete 即使未传 project_key 也能正确判定复用路径（TDD §4.1 N-03）
        claimed_project_key = str(row["claimed_project_key"] or "").strip() or None
        enable_project_reuse = _is_project_reuse_eligible_account(
            provider=row["provider"],
            account_type=row["account_type"],
            claimed_project_key=claimed_project_key,
        )

        # complete 先更新本地状态（事务内），再做 CF 删除（非阻塞）
        new_status = pool_repo.complete(
            conn,
            account_id,
            claim_token,
            caller_id,
            task_id,
            result,
            detail,
            claimed_project_key=claimed_project_key,
            enable_project_reuse=enable_project_reuse,
        )

        if (row["provider"] or "").strip() == "cloudflare_temp_mail" and result in CF_DELETE_ON_RESULTS:
            meta_str = row["temp_mail_meta"]
            meta_obj = {}
            if isinstance(meta_str, str) and meta_str.strip():
                try:
                    meta_obj = json.loads(meta_str)
                except Exception:
                    meta_obj = {}
            _delete_cf_mailbox_nonblocking(email=row["email"], meta=meta_obj)

        return new_status
    finally:
        conn.close()


def _create_cf_mailbox_for_pool(*, email_domain: Optional[str]) -> tuple[str, dict]:
    """调用 CF Worker 创建邮箱（Service 层），返回 (email, meta_dict)。"""
    try:
        from outlook_web.services.temp_mail_provider_cf import (
            CloudflareTempMailProvider,
        )

        provider = CloudflareTempMailProvider()
        result = provider.create_mailbox(prefix=None, domain=email_domain)
    except Exception as e:
        # 上游异常：统一映射为 UPSTREAM_SERVER_ERROR
        logger.warning("[pool] CF create_mailbox exception: %s", e)
        raise PoolServiceError("CF Worker 创建邮箱异常", "UPSTREAM_SERVER_ERROR", http_status=500) from e

    if not isinstance(result, dict):
        raise PoolServiceError("CF Worker 返回格式错误", "UPSTREAM_BAD_PAYLOAD", http_status=500)

    if not result.get("success"):
        error_code = str(result.get("error_code") or "UPSTREAM_SERVER_ERROR")
        error_msg = str(result.get("error") or "CF Worker 创建邮箱失败")
        raise PoolServiceError(error_msg, error_code, http_status=500)

    email = str(result.get("email") or "").strip()
    if not email:
        raise PoolServiceError("CF Worker 未返回邮箱地址", "UPSTREAM_BAD_PAYLOAD", http_status=500)

    meta = result.get("meta") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}

    if not isinstance(meta, dict):
        meta = {}

    return email, meta


def _delete_cf_mailbox_nonblocking(*, email: str, meta: dict) -> None:
    """非阻塞删除远程 CF 邮箱（仅记录日志，不抛异常）。"""
    try:
        from outlook_web.services.temp_mail_provider_cf import (
            CloudflareTempMailProvider,
        )

        provider = CloudflareTempMailProvider()
        success = provider.delete_mailbox({"email": email, "meta": meta})
        if success:
            logger.info("[pool] 已删除 CF 远程邮箱: %s", email)
        else:
            logger.warning("[pool] 删除 CF 远程邮箱失败(返回 False): %s", email)
    except Exception as e:
        logger.warning("[pool] 删除 CF 远程邮箱异常: %s, error=%s", email, e)


def get_claim_context(*, claim_token: str) -> Optional[dict]:
    """
    根据 claim_token 查询领取上下文（email / claimed_at / email_domain 等）。
    返回 dict 或 None（token 不存在时）。
    """
    if not claim_token or not claim_token.strip():
        return None
    conn = create_sqlite_connection()
    try:
        return pool_repo.get_claim_context(conn, claim_token.strip())
    finally:
        conn.close()


def append_claim_read_context(
    *,
    account_id: int,
    claim_token: str,
    caller_id: str,
    task_id: str,
    detail: Optional[str] = None,
) -> None:
    """
    追加一条读取上下文日志（claim 邮箱被用于邮件读取时记录）。
    """
    if not claim_token or not claim_token.strip():
        return
    # 临时邮箱池账号不写 account_claim_logs（该表 account_id 对 accounts 有外键约束）
    if pool_repo.is_temp_pool_account_id(account_id):
        return
    conn = create_sqlite_connection()
    try:
        pool_repo.append_claim_read_context(conn, account_id, claim_token, caller_id, task_id, detail)
    finally:
        conn.close()


def get_pool_stats() -> dict:
    """返回池状态统计（不修改任何数据）。"""
    conn = create_sqlite_connection()
    try:
        return pool_repo.get_stats(conn)
    finally:
        conn.close()
