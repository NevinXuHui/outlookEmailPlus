from __future__ import annotations

import json
import secrets
import string
from datetime import datetime
from typing import Any

import requests

from outlook_web.repositories import settings as settings_repo
from outlook_web.services.temp_mail_provider_base import TempMailProviderBase, register_provider


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _error_code_by_status(status_code: int) -> str:
    if status_code in (401, 403):
        return "UNAUTHORIZED"
    if status_code == 404:
        return "TEMP_EMAIL_NOT_FOUND"
    if status_code == 409:
        return "TEMP_EMAIL_ALREADY_EXISTS"
    if status_code == 429:
        return "UPSTREAM_RATE_LIMITED"
    if status_code >= 500:
        return "UPSTREAM_SERVER_ERROR"
    return "UPSTREAM_BAD_PAYLOAD"


def _parse_domains_text(raw: str) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    # 兼容逗号/换行输入
    normalized = text.replace("\r", "").replace(",", "\n")
    seen: set[str] = set()
    domains: list[str] = []
    for item in normalized.split("\n"):
        domain = item.strip()
        if not domain or domain in seen:
            continue
        seen.add(domain)
        domains.append(domain)
    return domains


def _normalize_timestamp(raw_value: Any) -> int:
    """将时间戳或 ISO 时间转换为 Unix 秒级时间戳"""
    if raw_value is None:
        return 0

    if isinstance(raw_value, (int, float)):
        ts = int(raw_value)
        # 兼容毫秒时间戳
        return ts // 1000 if ts > 1_000_000_000_000 else ts

    text = str(raw_value).strip()
    if not text:
        return 0

    # 先尝试数字字符串
    try:
        as_int = int(float(text))
        return as_int // 1000 if as_int > 1_000_000_000_000 else as_int
    except ValueError:
        pass

    # 再尝试 ISO 时间（SkyMail 返回 "2099-12-30 23:59:59" UTC 格式）
    try:
        # 移除可能的时区标记
        clean = text.replace("Z", "").strip()
        # 解析 UTC 时间
        dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
        return int(dt.timestamp())
    except (ValueError, TypeError):
        pass

    # 尝试 ISO 格式
    try:
        clean = text.replace("Z", "+00:00")
        if "." in clean and "+" in clean:
            clean = clean[: clean.index(".")] + clean[clean.index("+") :]
        return int(datetime.fromisoformat(clean).timestamp())
    except (ValueError, TypeError):
        return 0


@register_provider
class SkymailTempMailProvider(TempMailProviderBase):
    provider_name = "skymail"
    provider_label = "SkyMail"
    provider_version = "1.0.0"
    provider_author = "OutlookMail Plus"
    config_schema = {
        "fields": [
            {
                "key": "base_url",
                "label": "SkyMail Base URL",
                "type": "url",
                "required": True,
                "placeholder": "https://api.skymail.ink",
                "default": "https://api.skymail.ink",
                "description": "SkyMail 服务地址（不含末尾斜杠）",
            },
            {
                "key": "admin_email",
                "label": "管理员邮箱",
                "type": "email",
                "required": True,
                "placeholder": "admin@example.com",
                "default": "",
                "description": "SkyMail 管理员邮箱账号",
            },
            {
                "key": "admin_password",
                "label": "管理员密码",
                "type": "password",
                "required": True,
                "placeholder": "请输入密码",
                "default": "",
                "description": "SkyMail 管理员密码",
            },
            {
                "key": "domains",
                "label": "可用域名",
                "type": "textarea",
                "required": False,
                "placeholder": "example.com\nmail.example.com",
                "default": "",
                "description": "可选：每行一个域名；留空时使用第一个创建的用户域名",
            },
            {
                "key": "default_domain",
                "label": "默认域名",
                "type": "text",
                "required": False,
                "placeholder": "example.com",
                "default": "",
                "description": "创建邮箱时的默认域名",
            },
            {
                "key": "default_password",
                "label": "默认用户密码",
                "type": "password",
                "required": False,
                "default": "",
                "placeholder": "留空则自动生成",
                "description": "创建临时邮箱账号时的默认密码，留空则自动生成随机密码",
            },
            {
                "key": "request_timeout",
                "label": "请求超时(秒)",
                "type": "number",
                "required": False,
                "default": 30,
            },
        ]
    }

    def __init__(self, *, provider_name: str | None = None):
        self.provider_name = provider_name or "skymail"
        prefix = f"plugin.{self.provider_name}"
        self._base_url = settings_repo.get_setting(f"{prefix}.base_url", "https://api.skymail.ink").strip().rstrip("/")
        self._admin_email = settings_repo.get_setting(f"{prefix}.admin_email", "").strip()
        self._admin_password = settings_repo.get_setting(f"{prefix}.admin_password", "").strip()
        self._domains_text = settings_repo.get_setting(f"{prefix}.domains", "")
        self._default_domain = settings_repo.get_setting(f"{prefix}.default_domain", "").strip()
        self._default_password = settings_repo.get_setting(f"{prefix}.default_password", "").strip()
        self._request_timeout = max(3, _safe_int(settings_repo.get_setting(f"{prefix}.request_timeout", "30"), 30))
        self._token_cache: str | None = None

    def _get_token(self) -> str:
        """获取或刷新 SkyMail API Token"""
        if self._token_cache:
            return self._token_cache

        if not self._admin_email or not self._admin_password:
            raise RuntimeError("SkyMail 管理员邮箱或密码未配置")

        try:
            resp = requests.post(
                f"{self._base_url}/api/public/genToken",
                json={"email": self._admin_email, "password": self._admin_password},
                timeout=self._request_timeout,
            )
        except requests.Timeout as exc:
            raise RuntimeError("SkyMail Token 获取超时") from exc
        except requests.RequestException as exc:
            raise RuntimeError(f"SkyMail Token 获取失败: {exc}") from exc

        if not resp.ok:
            raise RuntimeError(f"SkyMail Token 获取失败: {self._extract_error_message(resp)}")

        try:
            data = resp.json()
            if data.get("code") != 200:
                raise RuntimeError(f"SkyMail 返回错误: {data.get('message', 'Unknown error')}")
            token = data.get("data", {}).get("token")
            if not token:
                raise RuntimeError("SkyMail 未返回有效 Token")
            self._token_cache = str(token)
            return self._token_cache
        except (KeyError, AttributeError, json.JSONDecodeError) as exc:
            raise RuntimeError("SkyMail Token 响应格式异常") from exc

    def _headers(self) -> dict[str, str]:
        """生成请求头，包含 Authorization Token"""
        token = self._get_token()
        return {"Content-Type": "application/json", "Authorization": token}

    def _extract_error_message(self, resp: requests.Response) -> str:
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                message = str(payload.get("message") or payload.get("error") or "").strip()
                if message:
                    return message
        except Exception:
            pass
        return str(resp.text or "").strip() or f"HTTP {resp.status_code}"

    def _resolve_domain(self, requested_domain: str | None = None) -> str:
        """解析要使用的域名"""
        given = str(requested_domain or "").strip()
        if given:
            return given
        if self._default_domain:
            return self._default_domain

        options = self.get_options()
        domains = options.get("domains") or []
        for item in domains:
            if item.get("is_default") and item.get("enabled"):
                return str(item.get("name") or "").strip()
        for item in domains:
            if item.get("enabled"):
                return str(item.get("name") or "").strip()
        return ""

    def _extract_mailbox_id(self, mailbox: dict[str, Any] | str) -> str:
        """从 mailbox 对象中提取邮箱地址（SkyMail 使用邮箱地址作为标识）"""
        if isinstance(mailbox, str):
            return mailbox.strip()
        if isinstance(mailbox, dict):
            # 优先使用 email 字段
            email = str(mailbox.get("email") or "").strip()
            if email:
                return email
            # 尝试从 meta 中提取
            meta = mailbox.get("meta") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            return str((meta or {}).get("provider_mailbox_id") or "").strip()
        return ""

    def _to_raw_message_id(self, message_id: str) -> int | None:
        """将内部 message_id 转换为 SkyMail 的 emailId"""
        text = str(message_id or "").strip()
        if text.startswith("skymail_"):
            text = text[8:]
        try:
            return int(text)
        except (ValueError, TypeError):
            return None

    def _normalize_message(self, message: dict[str, Any]) -> dict[str, Any] | None:
        """将 SkyMail 邮件格式标准化"""
        raw_id = message.get("emailId")
        if raw_id is None:
            return None

        normalized_id = f"skymail_{raw_id}"
        # SkyMail 返回字段：content(HTML), text(纯文本), subject, sendEmail, sendName, createTime
        content = str(message.get("text") or "")
        html_content = str(message.get("content") or "")
        from_address = str(message.get("sendEmail") or "").strip()
        from_name = str(message.get("sendName") or "").strip()

        # 组合发件人信息
        if from_name:
            from_display = f"{from_name} <{from_address}>"
        else:
            from_display = from_address

        timestamp = _normalize_timestamp(message.get("createTime"))

        return {
            "id": normalized_id,
            "message_id": normalized_id,
            "from_address": from_display,
            "subject": str(message.get("subject") or ""),
            "content": content,
            "html_content": html_content,
            "has_html": bool(html_content),
            "timestamp": timestamp,
        }

    def get_options(self) -> dict[str, Any]:
        """获取 Provider 配置选项"""
        domains = _parse_domains_text(self._domains_text)
        if not domains:
            # 如果没有配置域名，返回一个默认提示
            domains = ["请在设置中配置可用域名"]

        default_domain = self._default_domain if self._default_domain in domains else (domains[0] if domains else "")
        return {
            "domain_strategy": "manual",
            "default_mode": "manual",
            "domains": [
                {
                    "name": domain,
                    "enabled": True,
                    "is_default": domain == default_domain,
                }
                for domain in domains
            ],
            "prefix_rules": {
                "min_length": 1,
                "max_length": 64,
                "pattern": r"^[a-z0-9][a-z0-9._-]*$",
            },
            "provider": self.provider_name,
            "provider_name": self.provider_name,
            "provider_label": self.provider_label,
        }

    def create_mailbox(self, *, prefix: str | None = None, domain: str | None = None) -> dict[str, Any]:
        """创建新的临时邮箱账号"""
        if not self._base_url:
            return {
                "success": False,
                "error": "SkyMail base_url 未配置",
                "error_code": "TEMP_MAIL_PROVIDER_NOT_CONFIGURED",
            }

        target_domain = self._resolve_domain(domain)
        if not target_domain or target_domain == "请在设置中配置可用域名":
            return {
                "success": False,
                "error": "SkyMail 无可用域名，请在插件设置中配置",
                "error_code": "TEMP_MAIL_PROVIDER_NOT_CONFIGURED",
            }

        # 生成本地名
        local_name = str(prefix or "").strip()
        if not local_name:
            alphabet = string.ascii_lowercase + string.digits
            local_name = "".join(secrets.choice(alphabet) for _ in range(8))

        email_address = f"{local_name}@{target_domain}"

        # 生成密码
        if self._default_password:
            password = self._default_password
        else:
            alphabet = string.ascii_letters + string.digits
            password = "".join(secrets.choice(alphabet) for _ in range(12))

        # 调用 SkyMail 添加用户接口
        payload = {"list": [{"email": email_address, "password": password}]}

        try:
            resp = requests.post(
                f"{self._base_url}/api/public/addUser",
                headers=self._headers(),
                json=payload,
                timeout=self._request_timeout,
            )
        except requests.Timeout:
            return {
                "success": False,
                "error": "SkyMail 创建邮箱超时",
                "error_code": "UPSTREAM_TIMEOUT",
            }
        except requests.RequestException as exc:
            # Token 可能过期，清空缓存后重试一次
            if "401" in str(exc) or "403" in str(exc):
                self._token_cache = None
                try:
                    resp = requests.post(
                        f"{self._base_url}/api/public/addUser",
                        headers=self._headers(),
                        json=payload,
                        timeout=self._request_timeout,
                    )
                except requests.RequestException as retry_exc:
                    return {
                        "success": False,
                        "error": f"SkyMail 创建邮箱失败: {retry_exc}",
                        "error_code": "UPSTREAM_SERVER_ERROR",
                    }
            else:
                return {
                    "success": False,
                    "error": f"SkyMail 创建邮箱失败: {exc}",
                    "error_code": "UPSTREAM_SERVER_ERROR",
                }

        if not resp.ok:
            return {
                "success": False,
                "error": self._extract_error_message(resp),
                "error_code": _error_code_by_status(resp.status_code),
            }

        try:
            data = resp.json()
            if data.get("code") != 200:
                return {
                    "success": False,
                    "error": data.get("message", "创建失败"),
                    "error_code": "UPSTREAM_BAD_PAYLOAD",
                }
        except Exception:
            return {
                "success": False,
                "error": "SkyMail 返回非 JSON",
                "error_code": "UPSTREAM_BAD_PAYLOAD",
            }

        return {
            "success": True,
            "email": email_address,
            "meta": {
                "provider_name": self.provider_name,
                "provider_mailbox_id": email_address,
                "password": password,  # 保存密码供后续可能的登录使用
                "provider_capabilities": {
                    "delete_mailbox": False,  # SkyMail API 文档中未提供删除用户接口
                    "delete_message": False,  # API 中未提供删除单条邮件接口
                    "clear_messages": False,  # API 中未提供清空邮件接口
                },
            },
        }

    def delete_mailbox(self, mailbox: dict[str, Any]) -> bool:
        """删除邮箱（SkyMail API 未提供此功能）"""
        # SkyMail API 文档中未提供删除用户接口
        return False

    def list_messages(self, mailbox: dict[str, Any]) -> list[dict[str, Any]] | None:
        """获取邮箱的邮件列表"""
        email_address = self._extract_mailbox_id(mailbox)
        if not email_address:
            return []

        try:
            # 使用 emailList 接口，按收件人邮箱查询
            payload = {
                "toEmail": email_address,
                "type": 0,  # 0 = 收件
                "isDel": 0,  # 0 = 正常（未删除）
                "timeSort": "desc",  # 最新的在前
                "num": 1,
                "size": 100,  # 一次最多获取 100 封
            }
            resp = requests.post(
                f"{self._base_url}/api/public/emailList",
                headers=self._headers(),
                json=payload,
                timeout=self._request_timeout,
            )
        except requests.Timeout as exc:
            raise RuntimeError("SkyMail 拉取邮件列表超时") from exc
        except requests.RequestException as exc:
            # Token 可能过期，清空缓存
            if "401" in str(exc) or "403" in str(exc):
                self._token_cache = None
            raise RuntimeError(f"SkyMail 拉取邮件列表失败: {exc}") from exc

        if not resp.ok:
            if resp.status_code in (401, 403):
                self._token_cache = None
            raise RuntimeError(f"SkyMail 拉取邮件列表失败: {self._extract_error_message(resp)}")

        try:
            result = resp.json()
            if result.get("code") != 200:
                raise RuntimeError(f"SkyMail 返回错误: {result.get('message', 'Unknown error')}")
            raw_messages = result.get("data") or []
        except Exception as exc:
            raise RuntimeError("SkyMail 邮件列表返回非 JSON") from exc

        if not isinstance(raw_messages, list):
            raise RuntimeError("SkyMail 邮件列表返回结构异常")

        normalized: list[dict[str, Any]] = []
        for item in raw_messages:
            if not isinstance(item, dict):
                continue
            row = self._normalize_message(item)
            if row is not None:
                normalized.append(row)
        return normalized

    def get_message_detail(self, mailbox: dict[str, Any], message_id: str) -> dict[str, Any] | None:
        """获取邮件详情（SkyMail 通过 list 接口返回完整内容，直接过滤）"""
        # SkyMail 的 emailList 已经返回完整邮件内容，不需要单独的 detail 接口
        messages = self.list_messages(mailbox) or []
        for item in messages:
            if item.get("id") == message_id or item.get("message_id") == message_id:
                return item
        return None

    def delete_message(self, mailbox: dict[str, Any], message_id: str) -> bool:
        """删除单条邮件（SkyMail API 未提供此功能）"""
        # SkyMail API 文档中未提供删除单条邮件的接口
        return False

    def clear_messages(self, mailbox: dict[str, Any]) -> bool:
        """清空邮箱所有邮件（SkyMail API 未提供此功能）"""
        # SkyMail API 文档中未提供批量删除邮件的接口
        return False
