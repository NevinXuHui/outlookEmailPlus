# SkyMail 插件安装指南

## ✅ 插件已部署完成

插件文件已成功部署到：
```
/root/outlookEmailPlus/plugins/temp_mail_providers/skymail.py
```

**文件大小**: 15KB (405 行)  
**验证状态**: ✅ Python 编译检查通过  
**接口兼容**: ✅ 符合 TempMailProviderBase 规范

---

## 🚀 启动服务

根据你的部署方式选择：

### 方式一：使用 run.sh 脚本（推荐）

```bash
cd /root/outlookEmailPlus
chmod +x run.sh
./run.sh
```

### 方式二：Docker 部署

```bash
cd /root/outlookEmailPlus
docker-compose up -d app

# 或者
docker run -d \
  --name outlook-email-plus \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/plugins:/app/plugins \
  ghcr.io/zeropointsix/outlook-email-plus:latest
```

### 方式三：直接运行

```bash
cd /root/outlookEmailPlus

# 激活虚拟环境（如果有）
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动应用
python outlook_web/app.py
# 或
flask --app outlook_web/app run --host 0.0.0.0 --port 8000
```

---

## 🔍 验证插件加载

### 1. 检查插件是否已加载

启动服务后，访问：
```
http://localhost:8000
```

登录后台，进入：
```
系统设置 → 临时邮箱插件
```

你应该能看到 **SkyMail** 插件出现在列表中。

### 2. 通过 CLI 验证

```bash
cd /root/outlookEmailPlus
python outlook_web/app.py list-providers
```

应该输出：
```
[插件] skymail - SkyMail (1.0.0)
```

### 3. 通过 Python 验证

```bash
cd /root/outlookEmailPlus
python3 <<EOF
import sys
sys.path.insert(0, '.')

# 触发插件加载
from outlook_web.services.temp_mail_provider_factory import load_plugins, get_available_providers

load_plugins()
providers = get_available_providers()

for p in providers:
    if p['name'] == 'skymail':
        print(f"✅ SkyMail 插件已加载")
        print(f"   名称: {p['name']}")
        print(f"   标签: {p['label']}")
        print(f"   版本: {p['version']}")
        break
else:
    print("❌ SkyMail 插件未加载")
EOF
```

---

## ⚙️ 配置插件

### 通过 Web 界面配置（推荐）

1. 登录 OutlookMail Plus 后台
2. 进入 **系统设置** → **临时邮箱插件** → **SkyMail**
3. 填写以下配置：

| 配置项 | 必填 | 示例值 | 说明 |
|--------|:----:|--------|------|
| **Base URL** | ✅ | `https://api.skymail.ink` | SkyMail API 地址 |
| **管理员邮箱** | ✅ | `admin@example.com` | SkyMail 管理员账号 |
| **管理员密码** | ✅ | `your_password` | 管理员密码 |
| **可用域名** | ⚠️ | `example.com`<br>`mail.example.com` | 每行一个域名 |
| 默认域名 | | `example.com` | 优先使用的域名 |
| 默认用户密码 | | `MyPassword123` | 留空则自动生成 |
| 请求超时（秒） | | `30` | API 超时时间 |

4. 点击"保存配置"
5. 点击"测试连接"验证配置是否正确

### 通过 SQL 直接配置（备用）

```bash
cd /root/outlookEmailPlus
sqlite3 data/outlook_email.db <<EOF
INSERT OR REPLACE INTO settings (key, value) VALUES ('plugin.skymail.base_url', 'https://api.skymail.ink');
INSERT OR REPLACE INTO settings (key, value) VALUES ('plugin.skymail.admin_email', 'admin@example.com');
INSERT OR REPLACE INTO settings (key, value) VALUES ('plugin.skymail.admin_password', 'your_password');
INSERT OR REPLACE INTO settings (key, value) VALUES ('plugin.skymail.domains', 'example.com
mail.example.com');
EOF
```

---

## 🧪 测试使用

### 1. 在界面上测试

1. 进入 **临时邮箱** 页面
2. Provider 下拉框选择 **SkyMail**
3. 点击"创建临时邮箱"
4. 系统自动生成邮箱地址（如 `abc123@example.com`）
5. 用这个邮箱去注册任意网站
6. 回到页面点击"刷新"查看验证邮件

### 2. 通过 API 测试

```bash
# 设置 API Key（在"系统设置" → "对外接口"中生成）
API_KEY="your_api_key_here"

# 测试创建邮箱
curl -X POST http://localhost:8000/api/temp-emails \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "skymail",
    "prefix": "test123"
  }'

# 响应示例：
# {
#   "success": true,
#   "mailbox": {
#     "email": "test123@example.com",
#     "provider": "skymail"
#   }
# }
```

---

## 🔄 热重载插件

如果修改了插件代码，无需重启服务：

### 通过 Web 界面
```
系统设置 → 临时邮箱插件 → 应用变更
```

### 通过 API
```bash
curl -X POST http://localhost:8000/api/plugins/reload \
  -H "X-API-Key: $API_KEY"
```

---

## 🐛 故障排查

### 问题 1: 插件未出现在列表中

**原因**: 
- 插件文件不在正确位置
- 服务未启动或未重新加载

**解决**:
```bash
# 检查文件是否存在
ls -lh /root/outlookEmailPlus/plugins/temp_mail_providers/skymail.py

# 检查语法是否正确
python3 -m py_compile /root/outlookEmailPlus/plugins/temp_mail_providers/skymail.py

# 重启服务
./run.sh  # 或 docker-compose restart app
```

### 问题 2: Token 获取失败

**原因**:
- 管理员邮箱或密码错误
- Base URL 不可访问

**解决**:
```bash
# 测试 Base URL
curl https://api.skymail.ink/api/public/genToken \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}'

# 应返回: {"code":200,"data":{"token":"..."}}
```

### 问题 3: 创建邮箱失败："未配置可用域名"

**原因**: 
- domains 字段为空

**解决**:
1. 在 Web 界面配置"可用域名"，每行一个
2. 或通过 SQL 直接插入：
```sql
UPDATE settings 
SET value='example.com
mail.example.com' 
WHERE key='plugin.skymail.domains';
```

### 问题 4: 邮件列表为空

**原因**:
- 邮件未到达
- Email 地址错误

**解决**:
1. 在 SkyMail 管理后台确认邮件是否真的收到
2. 检查邮箱地址拼写是否正确
3. 点击"刷新"按钮重新拉取

---

## 📊 当前状态

```
✅ 插件文件已部署: plugins/temp_mail_providers/skymail.py (15KB)
✅ Python 语法检查: 通过
✅ 接口兼容性: TempMailProviderBase 全部方法已实现
✅ 编译检查: 通过

⏸ 服务状态: 未运行（需要启动）
⚠ 配置状态: 需要在 Web 界面配置 Base URL、管理员账号、域名
```

---

## 📝 下一步

1. **启动服务**: 运行 `./run.sh` 或 `docker-compose up -d`
2. **登录后台**: 访问 `http://localhost:8000`
3. **配置插件**: 系统设置 → 临时邮箱插件 → SkyMail
4. **测试使用**: 创建临时邮箱 → 发送测试邮件 → 刷新查看

---

## 📚 参考文档

- 完整功能说明: `plugins/temp_mail_providers/skymail/README.md`
- 快速上手: `plugins/temp_mail_providers/skymail/QUICKSTART.md`
- 交付报告: `plugins/temp_mail_providers/skymail/DELIVERY.md`
- SkyMail API: https://doc.skymail.ink/api/api-doc.html

---

**插件已完全准备就绪，启动服务即可使用！** 🎉
