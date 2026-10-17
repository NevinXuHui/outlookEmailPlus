from __future__ import annotations

import unittest

from outlook_web.services.performance_metrics import reset_performance_metrics
from tests._import_app import import_web_app_module


class PerformanceApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = import_web_app_module()
        cls.app = cls.module.app
        cls.client = cls.app.test_client()
        response = cls.client.post(
            "/login",
            json={"password": "testpass123"},
            content_type="application/json",
        )
        if response.status_code != 200:
            raise RuntimeError(f"测试用户登录失败: {response.status_code}")

    def setUp(self) -> None:
        reset_performance_metrics()

    def tearDown(self) -> None:
        reset_performance_metrics()

    def test_performance_snapshot_requires_login(self) -> None:
        response = self.app.test_client().get("/api/overview/performance")
        self.assertEqual(response.status_code, 401)

    def test_performance_snapshot_returns_required_sections(self) -> None:
        response = self.client.get(
            "/api/overview/performance",
            headers={"Cookie": "loggedin"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        for key in (
            "window",
            "summary",
            "endpoints",
            "pages",
            "bottlenecks",
            "recommendations",
        ):
            self.assertIn(key, payload)

    def test_client_metrics_endpoint_accepts_valid_batch(self) -> None:
        csrf_response = self.client.get("/api/csrf-token")
        csrf_payload = csrf_response.get_json() or {}
        token = csrf_payload.get("csrf_token") or (csrf_payload.get("data") or {}).get("csrf_token")
        headers = {"X-CSRFToken": token} if token else {}
        response = self.client.post(
            "/api/performance/client",
            json={
                "metrics": [
                    {
                        "kind": "api",
                        "name": "/api/emails/42?folder=inbox",
                        "duration_ms": 850,
                        "status": 200,
                        "success": True,
                    }
                ]
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json().get("accepted"), 1)


if __name__ == "__main__":
    unittest.main()
