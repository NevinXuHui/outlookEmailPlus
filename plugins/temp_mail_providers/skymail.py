"""
SkyMail 临时邮箱 Provider 插件
API 文档: https://doc.skymail.ink/api/api-doc.html
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Any

import requests
from requests import RequestException, Timeout

from outlook_web.repositories import settings as settings_repo
from outlook_web.services.temp_mail_provider_base import TempMailProviderBase, register_provider

logger = logging.getLogger(__name__)


class SkymailProviderError(Exception):
    """SkyMail Provider 专用异常"""
    def __init__(self, code: str, message: str, *, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@register_provider
class SkymailTempMailProvider(TempMailProviderBase):
    """SkyMail 临时邮箱服务 Provider"""

    provider_name = "skymail"
    provider_label = "SkyMail"
    provider_version = "1.0.0"
    provider_author = "OutlookMail Plus"

    config_schema = {
        "fields": [
            {
                "key": "base_url",
                "label": "Base URL",
                "type": "text",
                "required": True,
                "default": "https://api.skymail.ink",
                "placeholder": "https://api.skymail.ink",
                "help": "SkyMail API 地址",
            },
            {
                "key": "admin_email",
                "label": "管理员邮箱",
                "type": "text",
                "required": True,
                "placeholder": "admin@example.com",
                "help": "SkyMail 管理员账号",
            },
            {
                "key": "admin_password",
                "label": "管理员密码",
                "type": "password",
                "required": True,
                "help": "用于获取 Token",
            },
            {
                "key": "domains",
                "label": "可用域名",
                "type": "textarea",
                "required": False,
                "placeholder": "example.com\nmail.example.com",
                "help": "每行一个域名，用于创建临时邮箱",
            },
            {
                "key": "default_domain",
                "label": "默认域名",
                "type": "text",
                "required": False,
                "placeholder": "example.com",
                "help": "优先使用的域名（留空则使用第一个可用域名）",
            },
            {
                "key": "default_password",
                "label": "默认用户密码",
                "type": "password",
                "required": False,
                "help": "创建账号时的默认密码（留空则自动生成随机密码）",
            },
            {
                "key": "request_timeout",
                "label": "请求超时（秒）",
                "type": "number",
                "required": False,
                "default": "30",
                "help": "API 请求超时时间",
            },
        ]
    }

    def __init__(self, *, provider_name: str | None = None):
        self.provider_name = provider_name or "skymail"
        self._token_cache: str | None = None

    def _get_config(self, key: str, default: Any = None) -> Any:
        """获取插件配置"""
        return settings_repo.get_setting(f"plugin.{self.provider_name}.{key}", default)

    def _safe_int(self, value: Any, default: int = 30) -> int:
        """安全转换为整数"""
        try:
            return int(value) if value else default
        except (ValueError, TypeError):
            return default

    def _get_token(self) -> str:
        """获取或刷新管理员 Token"""
        if self._token_cache:
            return self._token_cache

        base_url = str(self._get_config("base_url", "https://api.skymail.ink")).rstrip("/")
        admin_email = str(self._get_config("admin_email", ""))
        admin_password = str(self._get_config("admin_password", ""))

        if not admin_email or not admin_password:
            raise SkymailProviderError("CONFIG_MISSING", "管理员邮箱或密码未配置")

        timeout = self._safe_int(self._get_config("request_timeout", 30))

        try:
            resp = requests.post(
                f"{base_url}/api/public/genToken",
                json={"email": admin_email, "password": admin_password},
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get("code") != 200:
                raise SkymailProviderError(
                    "AUTH_FAILED",
                    f"Token 获取失败: {data.get('msg', '未知错误')}",
                )

            token = data.get("data", {}).get("token")
            if not token:
                raise SkymailProviderError("AUTH_FAILED", "Token 获取失败: 响应中无 token 字段")

            self._token_cache = str(token)
            return self._token_cache

        except Timeout:
            raise SkymailProviderError("UPSTREAM_TIMEOUT", f"SkyMail API 请求超时（{timeout}秒）")
        except RequestException as exc:
            raise SkymailProviderError("UPSTREAM_ERROR", f"SkyMail API 请求失败: {exc}")

    def _refresh_token_on_error(self):
        """清空 Token 缓存，强制下次重新获取"""
        self._token_cache = None

    def _call_api(
        self,
        endpoint: str,
        *,
        method: str = "POST",
        params: dict[str, Any] | None = None,
        auto_retry: bool = True,
    ) -> dict[str, Any]:
        """调用 SkyMail API"""
        base_url = str(self._get_config("base_url", "https://api.skymail.ink")).rstrip("/")
        timeout = self._safe_int(self._get_config("request_timeout", 30))
        token = self._get_token()

        url = f"{base_url}{endpoint}"
        payload = dict(params or {})
        headers = {"Authorization": token}

        try:
            resp = requests.request(method, url, json=payload, headers=headers, timeout=timeout)

            # Token 失效时自动重试一次
            if resp.status_code in (401, 403) and auto_retry:
                logger.info("[skymail] Token 失效，重新获取")
                self._refresh_token_on_error()
                token = self._get_token()
                headers["Authorization"] = token
                resp = requests.request(method, url, json=payload, headers=headers, timeout=timeout)

            resp.raise_for_status()
            data = resp.json()

            if data.get("code") != 200:
                error_msg = data.get("msg", "未知错误")
                raise SkymailProviderError("API_ERROR", f"SkyMail API 错误: {error_msg}")

            return data.get("data", {})

        except Timeout:
            raise SkymailProviderError("UPSTREAM_TIMEOUT", f"SkyMail API 请求超时（{timeout}秒）")
        except RequestException as exc:
            if hasattr(exc, "response") and exc.response is not None:
                status = exc.response.status_code
                raise SkymailProviderError("UPSTREAM_ERROR", f"SkyMail API 错误 (HTTP {status})")
            raise SkymailProviderError("UPSTREAM_ERROR", f"SkyMail API 请求失败: {exc}")

    def _normalize_timestamp(self, value: Any) -> int | None:
        """标准化时间戳为 Unix 秒"""
        if value is None:
            return None

        # Unix 时间戳（秒或毫秒）
        if isinstance(value, (int, float)):
            ts = int(value)
            # 毫秒转秒
            if ts > 10**12:
                return ts // 1000
            return ts

        # 时间字符串
        if isinstance(value, str):
            try:
                # 尝试解析 ISO 格式
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return int(dt.timestamp())
            except ValueError:
                pass

            # 尝试解析 SkyMail UTC 格式: "2024-01-15 10:30:45"
            try:
                dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
                return int(dt.timestamp())
            except ValueError:
                pass

        return None

    def _get_domains_from_server(self) -> list[str]:
        """从服务器获取域名列表（/api/setting/websiteConfig）
        
        该接口在 cloud-mail 中是公开的，但如果服务器开启了 loginDomain 隐私开关，
        未认证请求会返回空列表。因此先尝试不带 token，空则带 token 重试。
        
        参考：https://github.com/maillab/cloud-mail
        """
        base_url = str(self._get_config("base_url", "")).strip()
        if not base_url:
            return []
        
        url = f"{base_url.rstrip('/')}/api/setting/websiteConfig"
        timeout = self._safe_int(self._get_config("request_timeout", 30))
        
        def fetch_domains(with_token: bool = False) -> list[str]:
            headers = {}
            if with_token:
                try:
                    token = self._get_token()
                    headers["Authorization"] = token
                except Exception:
                    return []
            
            try:
                response = requests.get(url, headers=headers, timeout=timeout)
                if response.status_code != 200:
                    return []
                
                data = response.json()
                if data.get("code") != 200:
                    return []
                
                domain_list = data.get("data", {}).get("domainList", [])
                # 清理域名：去掉 @ 前缀和空白
                result = [d.lstrip("@").strip() for d in domain_list if d and d.strip()]
                if result:
                    logger.info("[skymail] 从服务器获取到 %d 个域名: %s", len(result), ", ".join(result))
                return result
            except Exception as e:
                logger.debug("[skymail] 获取域名列表失败: %s", e)
                return []
        
        # 先尝试不带 token（公开访问）
        domains = fetch_domains(with_token=False)
        if domains:
            return domains
        
        # 如果返回空，尝试带 token 重试（可能开启了 loginDomain 隐私开关）
        logger.debug("[skymail] 公开接口返回空域名列表，尝试带 token 重试...")
        domains = fetch_domains(with_token=True)
        
        return domains

    def get_options(self) -> dict[str, Any]:
        """获取 Provider 选项（域名列表）
        
        优先级：
        1. 用户配置的 domains
        2. 从服务器 /api/setting/websiteConfig 自动获取
        3. 从 admin_email 自动提取
        """
        domains_text = str(self._get_config("domains", "")).strip()
        domains = [
            line.strip()
            for line in domains_text.splitlines()
            if line.strip()
        ]

        # 如果未配置域名，尝试从服务器自动获取
        if not domains:
            logger.debug("[skymail] 配置中无域名，尝试从服务器自动获取...")
            domains = self._get_domains_from_server()
        
        # 如果服务器也返回空，尝试从管理员邮箱自动提取
        if not domains:
            admin_email = str(self._get_config("admin_email", "")).strip()
            if admin_email and "@" in admin_email:
                auto_domain = admin_email.split("@")[1].strip()
                if auto_domain:
                    logger.info("[skymail] 自动从管理员邮箱提取域名: %s", auto_domain)
                    domains = [auto_domain]
            
            if not domains:
                logger.warning("[skymail] 未配置可用域名")

        # 前端期望 domains 是对象数组，每个对象有 name 属性
        domain_objects = [{"name": d, "enabled": True} for d in domains]

        return {
            "domains": domain_objects,
            "domain_strategy": "fixed" if domains else "none",
            "provider": self.provider_name,
            "provider_name": self.provider_name,
            "provider_label": "SkyMail",
        }

    def create_mailbox(
        self,
        *,
        prefix: str | None = None,
        domain: str | None = None,
    ) -> dict[str, Any]:
        """创建临时邮箱"""
        # 1. 确定域名
        if not domain:
            default_domain = str(self._get_config("default_domain", "")).strip()
            if default_domain:
                domain = default_domain
            else:
                options = self.get_options()
                domains = options.get("domains", [])
                if not domains:
                    raise SkymailProviderError("CONFIG_MISSING", "未配置可用域名")
                domain = domains[0]

        # 2. 生成前缀
        if not prefix:
            prefix = secrets.token_hex(6)  # 12 字符随机前缀

        email = f"{prefix}@{domain}"

        # 3. 确定密码
        default_pwd = str(self._get_config("default_password", "")).strip()
        password = default_pwd if default_pwd else secrets.token_urlsafe(12)

        # 4. 调用 API 创建账号（API 需要 list 数组参数）
        data = self._call_api(
            "/api/public/addUser",
            params={"list": [{"email": email, "password": password}]},
        )

        logger.info("[skymail] 创建邮箱成功: %s", email)

        return {
            "success": True,
            "email": email,
            "password": password,
            "provider_name": self.provider_name,
            "extra": {
                "user_id": data.get("id") if data else None,
                "created_at": data.get("createTime") if data else None,
            },
        }

    def delete_mailbox(self, mailbox: dict[str, Any]) -> bool:
        """删除邮箱（SkyMail API 不支持）"""
        logger.warning("[skymail] SkyMail API 不提供删除用户功能")
        return False

    def list_messages(self, mailbox: dict[str, Any]) -> list[dict[str, Any]] | None:
        """获取邮件列表"""
        email = mailbox.get("email", "")
        if not email:
            return []

        try:
            data = self._call_api(
                "/api/public/emailList",
                params={"toEmail": email, "type": 0, "timeSort": "desc"},
            )

            # 解析邮件列表（API 直接返回 list）
            raw_list = data if isinstance(data, list) else []
            
            messages = []
            for item in raw_list:
                if not isinstance(item, dict):
                    continue

                # 标准化时间戳
                received_at = self._normalize_timestamp(item.get("createTime"))

                # 提取发件人信息
                from_email = str(item.get("fromEmail", ""))
                from_name = str(item.get("fromName", ""))
                sender = from_name if from_name else from_email

                messages.append({
                    "id": f"skymail-{item.get('id', '')}",
                    "message_id": f"skymail-{item.get('id', '')}",
                    "from": sender,
                    "from_email": from_email,
                    "from_name": from_name,
                    "subject": str(item.get("title", "")),
                    "received_at": received_at,
                    "size": 0,
                    "preview": str(item.get("content", ""))[:200],
                })

            logger.info("[skymail] 查询邮件列表: %s, 找到 %d 封", email, len(messages))
            return messages

        except SkymailProviderError as exc:
            logger.error("[skymail] 查询邮件列表失败: %s", exc)
            return []

    def get_message_detail(self, mailbox: dict[str, Any], message_id: str) -> dict[str, Any] | None:
        """获取邮件详情（从列表中过滤）"""
        email = mailbox.get("email", "")
        if not email:
            return None

        # SkyMail 的 emailList 接口已返回完整内容，无需单独接口
        skymail_id = message_id.replace("skymail-", "")

        try:
            data = self._call_api(
                "/api/public/emailList",
                params={"toEmail": email, "type": 0, "timeSort": "desc"},
            )

            raw_list = data.get("list", [])
            for item in raw_list:
                if not isinstance(item, dict):
                    continue

                if str(item.get("id")) == skymail_id:
                    from_email = str(item.get("fromEmail", ""))
                    from_name = str(item.get("fromName", ""))
                    sender = from_name if from_name else from_email

                    content_html = str(item.get("content", ""))
                    content_text = str(item.get("contentText", ""))

                    return {
                        "id": message_id,
                        "message_id": message_id,
                        "from": sender,
                        "from_email": from_email,
                        "from_name": from_name,
                        "subject": str(item.get("title", "")),
                        "received_at": self._normalize_timestamp(item.get("createTime")),
                        "content_html": content_html,
                        "content_text": content_text or content_html,
                        "attachments": [],
                    }

            logger.warning("[skymail] 邮件不存在: %s", message_id)
            return None

        except SkymailProviderError as exc:
            logger.error("[skymail] 获取邮件详情失败: %s", exc)
            return None

    def delete_message(self, mailbox: dict[str, Any], message_id: str) -> bool:
        """删除邮件（SkyMail API 不支持）"""
        logger.warning("[skymail] SkyMail API 不提供删除邮件功能")
        return False

    def clear_messages(self, mailbox: dict[str, Any]) -> bool:
        """清空邮箱（SkyMail API 不支持）"""
        logger.warning("[skymail] SkyMail API 不提供批量删除功能")
        return False
