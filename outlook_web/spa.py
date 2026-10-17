from __future__ import annotations

import os
from pathlib import Path

from flask import Response, send_from_directory

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SPA_DIST = _REPO_ROOT / "ant-design-pro" / "dist"


def spa_dist_dir() -> Path:
    return _SPA_DIST


def spa_enabled() -> bool:
    """Return whether the Ant Design Pro build should be served in production."""
    flag = os.getenv("SPA_ENABLED", "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    return (spa_dist_dir() / "index.html").is_file()


def send_spa_index() -> Response:
    dist = spa_dist_dir()
    return send_from_directory(str(dist), "index.html")


def send_spa_asset(path: str) -> Response:
    """Serve a built asset or fall back to the SPA shell for client-side routes."""
    dist = spa_dist_dir()
    safe_path = (path or "").lstrip("/")
    if safe_path and (dist / safe_path).is_file():
        return send_from_directory(str(dist), safe_path)
    return send_spa_index()


def send_spa_file(path: str) -> Response | None:
    """Serve a built asset only when it exists in the SPA dist directory.

    Unlike send_spa_asset(), this never falls back to the SPA shell,
    so callers can decide their own fallback (e.g. 404 for images).
    """
    dist = spa_dist_dir()
    safe_path = (path or "").lstrip("/")
    if safe_path and (dist / safe_path).is_file():
        return send_from_directory(str(dist), safe_path)
    return None
