#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
测试：导入时支持两种字段顺序
PRD: 支持 email----password----client_id----refresh_token
     和 email----password----refresh_token----client_id 两种格式
"""

import sys
import unittest
import uuid

sys.path.insert(0, ".")

from outlook_web import app
from outlook_web.db import get_db


class TestImportFieldOrderFlexibility(unittest.TestCase):
    """测试导入时支持两种字段顺序"""

    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True
        
        # 登录
        response = self.app.post(
            "/api/login",
            json={"username": "admin", "password": "admin"},
        )
        self.assertEqual(response.status_code, 200)

    def _get_default_group_id(self):
        """获取默认分组 ID"""
        db = get_db()
        try:
            row = db.execute(
                "SELECT id FROM groups WHERE name = '默认分组' LIMIT 1"
            ).fetchone()
            return row["id"] if row else 1
        finally:
            db.close()

    def test_standard_format_client_id_then_refresh_token(self):
        """测试标准格式：邮箱----密码----client_id----refresh_token"""
        unique = uuid.uuid4().hex[:8]
        email = f"test_standard_{unique}@outlook.com"
        password = "test_pass"
        client_id = "short_client_id_abc123"
        refresh_token = "very_long_refresh_token_" + "x" * 100
        
        account_string = f"{email}----{password}----{client_id}----{refresh_token}"
        
        response = self.app.post(
            "/api/accounts",
            json={
                "account_string": account_string,
                "group_id": self._get_default_group_id(),
            },
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get("success"))
        
        summary = data.get("summary", {})
        self.assertEqual(summary.get("imported"), 1)
        self.assertEqual(summary.get("failed"), 0)
        
        # 验证数据库中的值
        db = get_db()
        try:
            from outlook_web.security.crypto import decrypt_data
            row = db.execute(
                "SELECT client_id, refresh_token FROM accounts WHERE email = ?",
                (email,),
            ).fetchone()
            self.assertIsNotNone(row)
            
            stored_client_id = decrypt_data(row["client_id"])
            stored_refresh_token = decrypt_data(row["refresh_token"])
            
            self.assertEqual(stored_client_id, client_id)
            self.assertEqual(stored_refresh_token, refresh_token)
        finally:
            db.close()

    def test_reversed_format_refresh_token_then_client_id(self):
        """测试反序格式：邮箱----密码----refresh_token----client_id"""
        unique = uuid.uuid4().hex[:8]
        email = f"test_reversed_{unique}@outlook.com"
        password = "test_pass"
        client_id = "short_client_id_xyz789"
        refresh_token = "very_long_refresh_token_" + "y" * 120
        
        # 反序：refresh_token 在前，client_id 在后
        account_string = f"{email}----{password}----{refresh_token}----{client_id}"
        
        response = self.app.post(
            "/api/accounts",
            json={
                "account_string": account_string,
                "group_id": self._get_default_group_id(),
            },
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get("success"))
        
        summary = data.get("summary", {})
        self.assertEqual(summary.get("imported"), 1)
        self.assertEqual(summary.get("failed"), 0)
        
        # 验证数据库中的值
        db = get_db()
        try:
            from outlook_web.security.crypto import decrypt_data
            row = db.execute(
                "SELECT client_id, refresh_token FROM accounts WHERE email = ?",
                (email,),
            ).fetchone()
            self.assertIsNotNone(row)
            
            stored_client_id = decrypt_data(row["client_id"])
            stored_refresh_token = decrypt_data(row["refresh_token"])
            
            # 应该正确识别并存储
            self.assertEqual(stored_client_id, client_id)
            self.assertEqual(stored_refresh_token, refresh_token)
        finally:
            db.close()

    def test_mixed_format_batch_import(self):
        """测试混合格式批量导入"""
        unique = uuid.uuid4().hex[:8]
        
        # 标准格式
        email1 = f"test_mix1_{unique}@outlook.com"
        client_id1 = "client_abc"
        refresh_token1 = "refresh_token_" + "a" * 100
        line1 = f"{email1}----pass1----{client_id1}----{refresh_token1}"
        
        # 反序格式
        email2 = f"test_mix2_{unique}@outlook.com"
        client_id2 = "client_xyz"
        refresh_token2 = "refresh_token_" + "b" * 110
        line2 = f"{email2}----pass2----{refresh_token2}----{client_id2}"
        
        account_string = f"{line1}\n{line2}"
        
        response = self.app.post(
            "/api/accounts",
            json={
                "account_string": account_string,
                "group_id": self._get_default_group_id(),
            },
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get("success"))
        
        summary = data.get("summary", {})
        self.assertEqual(summary.get("imported"), 2)
        self.assertEqual(summary.get("failed"), 0)
        
        # 验证两个账号
        db = get_db()
        try:
            from outlook_web.security.crypto import decrypt_data
            
            row1 = db.execute(
                "SELECT client_id, refresh_token FROM accounts WHERE email = ?",
                (email1,),
            ).fetchone()
            self.assertIsNotNone(row1)
            self.assertEqual(decrypt_data(row1["client_id"]), client_id1)
            self.assertEqual(decrypt_data(row1["refresh_token"]), refresh_token1)
            
            row2 = db.execute(
                "SELECT client_id, refresh_token FROM accounts WHERE email = ?",
                (email2,),
            ).fetchone()
            self.assertIsNotNone(row2)
            self.assertEqual(decrypt_data(row2["client_id"]), client_id2)
            self.assertEqual(decrypt_data(row2["refresh_token"]), refresh_token2)
        finally:
            db.close()

    def test_ambiguous_case_prefers_standard_format(self):
        """测试模棱两可的情况，应优先使用标准格式"""
        unique = uuid.uuid4().hex[:8]
        email = f"test_ambiguous_{unique}@outlook.com"
        password = "test_pass"
        # 两个字段长度相近，应该按标准格式解析
        client_id = "medium_length_client_id_12345"
        refresh_token = "medium_length_refresh_token_67890"
        
        account_string = f"{email}----{password}----{client_id}----{refresh_token}"
        
        response = self.app.post(
            "/api/accounts",
            json={
                "account_string": account_string,
                "group_id": self._get_default_group_id(),
            },
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get("success"))
        
        # 验证按标准格式解析
        db = get_db()
        try:
            from outlook_web.security.crypto import decrypt_data
            row = db.execute(
                "SELECT client_id, refresh_token FROM accounts WHERE email = ?",
                (email,),
            ).fetchone()
            self.assertIsNotNone(row)
            
            stored_client_id = decrypt_data(row["client_id"])
            stored_refresh_token = decrypt_data(row["refresh_token"])
            
            # 应该按标准格式存储
            self.assertEqual(stored_client_id, client_id)
            self.assertEqual(stored_refresh_token, refresh_token)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()