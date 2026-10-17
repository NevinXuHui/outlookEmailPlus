"""SPA 静态资源服务测试。"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from outlook_web import spa as spa_support


class TestSpaServing(unittest.TestCase):
    def test_spa_disabled_without_build(self):
        with mock.patch.dict(os.environ, {"SPA_ENABLED": "false"}, clear=False):
            self.assertFalse(spa_support.spa_enabled())

    def test_spa_enabled_when_dist_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dist = Path(tmpdir)
            (dist / "index.html").write_text("<html>spa</html>", encoding="utf-8")
            with mock.patch.object(spa_support, "spa_dist_dir", return_value=dist):
                with mock.patch.dict(os.environ, {"SPA_ENABLED": ""}, clear=False):
                    self.assertTrue(spa_support.spa_enabled())

    def test_send_spa_index_and_asset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dist = Path(tmpdir)
            (dist / "index.html").write_text("<html>spa</html>", encoding="utf-8")
            (dist / "umi.js").write_text("console.log('ok')", encoding="utf-8")

            with mock.patch.object(spa_support, "spa_dist_dir", return_value=dist):
                from flask import Flask

                app = Flask(__name__)
                with app.test_request_context("/overview"):
                    index_resp = spa_support.send_spa_index()
                    self.assertEqual(index_resp.status_code, 200)
                    self.assertEqual(index_resp.mimetype, "text/html")

                    asset_resp = spa_support.send_spa_asset("umi.js")
                    self.assertEqual(asset_resp.status_code, 200)

                    fallback_resp = spa_support.send_spa_asset("overview")
                    self.assertEqual(fallback_resp.status_code, 200)
                    self.assertEqual(fallback_resp.mimetype, "text/html")


class TestSpaFileFallback(unittest.TestCase):
    """仓库 img/ 被部署排除时，/img/* 与 favicon 回退 SPA dist 的测试。"""

    def test_send_spa_file_hit_and_miss(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dist = Path(tmpdir)
            (dist / "img").mkdir()
            (dist / "img" / "ico.png").write_bytes(b"png-bytes")

            with mock.patch.object(spa_support, "spa_dist_dir", return_value=dist):
                from flask import Flask

                app = Flask(__name__)
                with app.test_request_context("/img/ico.png"):
                    hit = spa_support.send_spa_file("img/ico.png")
                    self.assertIsNotNone(hit)
                    self.assertEqual(hit.status_code, 200)
                    self.assertIsNone(spa_support.send_spa_file("img/missing.png"))

    def test_image_asset_falls_back_to_spa_dist(self):
        from flask import Flask

        from outlook_web.controllers import pages as pages_controller

        app = Flask(__name__)
        with app.test_request_context("/img/not-in-repo.png"):
            with mock.patch.object(spa_support, "send_spa_file", return_value="SPA_RESP") as mocked:
                resp = pages_controller.image_asset("not-in-repo.png")
                self.assertEqual(resp, "SPA_RESP")
                mocked.assert_called_once_with("img/not-in-repo.png")

    def test_image_asset_404_when_missing_everywhere(self):
        from flask import Flask
        from werkzeug.exceptions import NotFound

        from outlook_web.controllers import pages as pages_controller

        app = Flask(__name__)
        with app.test_request_context("/img/not-in-repo.png"):
            with mock.patch.object(spa_support, "send_spa_file", return_value=None):
                with self.assertRaises(NotFound):
                    pages_controller.image_asset("not-in-repo.png")


if __name__ == "__main__":
    unittest.main()
