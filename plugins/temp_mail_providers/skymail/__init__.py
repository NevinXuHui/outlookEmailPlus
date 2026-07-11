"""
SkyMail 临时邮箱 Provider 插件

提供与 SkyMail 临时邮箱服务的集成。
"""

from .skymail import SkymailTempMailProvider

__all__ = ["SkymailTempMailProvider"]
__version__ = "1.0.0"
