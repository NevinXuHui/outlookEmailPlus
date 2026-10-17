import unittest

from tests._import_app import clear_login_attempts, import_web_app_module


class PollingSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = import_web_app_module()
        cls.app = cls.module.app

    def setUp(self):
        with self.app.app_context():
            clear_login_attempts()
            from outlook_web.repositories import settings as settings_repo

            settings_repo.set_setting("enable_auto_polling", "false")
            settings_repo.set_setting("polling_interval", "10")
            settings_repo.set_setting("polling_count", "5")

    def _login(self, client, password: str = "testpass123"):
        resp = client.post("/login", json={"password": password})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("success"))

    def test_put_settings_round_trips_zero_polling_count(self):
        client = self.app.test_client()
        self._login(client)

        resp = client.put(
            "/api/settings",
            json={
                "enable_auto_polling": True,
                "polling_interval": 15,
                "polling_count": 0,
            },
        )

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("success"))

        resp2 = client.get("/api/settings")
        self.assertEqual(resp2.status_code, 200)
        settings = resp2.get_json().get("settings", {})
        self.assertTrue(settings.get("enable_auto_polling"))
        self.assertEqual(settings.get("polling_interval"), 15)
        self.assertEqual(settings.get("polling_count"), 0)

        with self.app.app_context():
            from outlook_web.repositories import settings as settings_repo

            self.assertEqual(settings_repo.get_setting("polling_count"), "0")

    def test_put_settings_accepts_positive_polling_count(self):
        client = self.app.test_client()
        self._login(client)

        resp = client.put(
            "/api/settings",
            json={
                "enable_auto_polling": True,
                "polling_interval": 20,
                "polling_count": 3,
            },
        )

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json().get("success"))

        resp2 = client.get("/api/settings")
        settings = resp2.get_json().get("settings", {})
        self.assertEqual(settings.get("polling_interval"), 20)
        self.assertEqual(settings.get("polling_count"), 3)

    def test_put_settings_accepts_polling_contract_boundaries(self):
        client = self.app.test_client()
        self._login(client)

        for interval, count in ((3, 0), (300, 100)):
            with self.subTest(interval=interval, count=count):
                resp = client.put(
                    "/api/settings",
                    json={
                        "polling_interval": interval,
                        "polling_count": count,
                    },
                )
                self.assertEqual(resp.status_code, 200)
                self.assertTrue(resp.get_json().get("success"))

                settings = client.get("/api/settings").get_json().get("settings", {})
                self.assertEqual(settings.get("polling_interval"), interval)
                self.assertEqual(settings.get("polling_count"), count)

    def test_put_settings_rejects_values_outside_polling_contract(self):
        client = self.app.test_client()
        self._login(client)
        cases = (
            ({"polling_interval": 2}, "轮询间隔必须在 3-300 秒之间"),
            ({"polling_interval": 301}, "轮询间隔必须在 3-300 秒之间"),
            ({"polling_count": -1}, "轮询次数必须在 0-100 次之间"),
            ({"polling_count": 101}, "轮询次数必须在 0-100 次之间"),
        )

        for payload, expected_error in cases:
            with self.subTest(payload=payload):
                resp = client.put("/api/settings", json=payload)
                self.assertEqual(resp.status_code, 400)
                body = resp.get_json()
                self.assertFalse(body.get("success"))
                self.assertIn(
                    expected_error,
                    body.get("error", {}).get("message", ""),
                )

        settings = client.get("/api/settings").get_json().get("settings", {})
        self.assertEqual(settings.get("polling_interval"), 10)
        self.assertEqual(settings.get("polling_count"), 5)
