# SkyMail 插件快速上手

## 一分钟快速配置

### 1️⃣ 准备 SkyMail 服务

确保你已经搭建了 SkyMail 服务（参考 [SkyMail 文档](https://doc.skymail.ink)），并拥有：
- 管理员邮箱账号
- 管理员密码
- 至少一个可用域名

### 2️⃣ 安装插件

将 `skymail` 目录放到 OutlookMail Plus 的插件目录：

```bash
# 方式一：复制到插件目录
cp -r skymail /path/to/outlook-email-plus/plugins/temp_mail_providers/

# 方式二：在 OutlookMail Plus 界面上传插件包
```

### 3️⃣ 配置插件

登录 OutlookMail Plus 后台 → **系统设置** → **临时邮箱插件** → **SkyMail**：

| 配置项 | 填写内容 | 示例 |
|--------|---------|------|
| **Base URL** | 你的 SkyMail API 地址 | `https://api.skymail.ink` |
| **管理员邮箱** | SkyMail 管理员账号 | `admin@yourdomain.com` |
| **管理员密码** | 对应密码 | `your_secure_password` |
| **可用域名** | 每行一个域名 | `example.com`<br>`mail.example.com` |

点击"保存配置"。

### 4️⃣ 测试使用

#### 在界面上使用

1. 进入 **临时邮箱** 页面
2. Provider 下拉框选择 **SkyMail**
3. 点击"创建临时邮箱"
4. 系统自动生成邮箱地址（如 `abc123@example.com`）
5. 用这个邮箱去注册网站，回到页面点击"刷新"查看验证邮件

#### 通过 API 使用

```bash
# 1. 获取 API Key（在"系统设置" → "对外接口"中生成）
export API_KEY="your_api_key_here"

# 2. 从邮箱池申领临时邮箱
curl -X POST http://localhost:5000/api/external/pool/claim-random \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "my_project",
    "caller_id": "script_01",
    "task_id": "task_001"
  }'

# 响应示例：
# {
#   "success": true,
#   "mailbox": {
#     "id": 123,
#     "email": "abc123@example.com",
#     "provider": "skymail"
#   }
# }

# 3. 获取验证码（等待邮件到达后）
curl -X POST http://localhost:5000/api/external/pool/verify \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mailbox_id": 123,
    "mode": "code"
  }'

# 响应示例：
# {
#   "success": true,
#   "code": "123456"
# }

# 4. 完成任务（释放邮箱）
curl -X POST http://localhost:5000/api/external/pool/complete \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mailbox_id": 123,
    "result": "success"
  }'
```

## 进阶配置

### 自定义域名策略

如果你有多个域名，可以指定默认域名：

```
可用域名：
example.com
mail.example.com
temp.example.com

默认域名：mail.example.com  ← 优先使用这个
```

### 固定账号密码

如果希望所有临时邮箱使用相同密码（方便登录 SkyMail 后台查看）：

```
默认用户密码：MyFixedPassword123
```

留空则每个账号使用随机生成的 12 位密码。

### 调整超时时间

网络较慢时可增加超时：

```
请求超时(秒)：60
```

## 常见问题

### Q: 创建邮箱失败，提示"无可用域名"？

**A**: 检查"可用域名"是否填写，每行一个域名，不要留空行。

### Q: Token 获取失败？

**A**: 
- 检查管理员邮箱和密码是否正确
- 确认 Base URL 可访问（浏览器打开试试）
- 查看 SkyMail 服务是否正常运行

### Q: 邮件收到了但显示不出来？

**A**: 
- 点击"刷新"按钮
- 检查 SkyMail 后台该邮箱是否真的收到邮件
- 查看浏览器控制台是否有报错

### Q: 插件未出现在下拉列表？

**A**: 
- 确认插件目录结构正确：`plugins/temp_mail_providers/skymail/`
- 重启 OutlookMail Plus 服务
- 查看后台日志是否有插件加载错误

### Q: 删除邮箱功能不可用？

**A**: SkyMail API 目前不提供删除用户接口，创建的账号会永久保留在系统中。如需清理，请在 SkyMail 管理后台手动删除。

## 技术细节

### API 调用顺序

```
创建邮箱流程：
1. POST /api/public/genToken
   └─ 获取管理员 Token（自动缓存）

2. POST /api/public/addUser
   └─ 创建临时邮箱账号
   
读取邮件流程：
1. 使用已缓存的 Token

2. POST /api/public/emailList
   └─ 查询收件箱
```

### Token 管理

- Token 获取后会缓存在内存中
- Token 过期时（401/403 错误）自动重新获取
- 插件重启后 Token 会重新生成

### 邮件同步

- 每次刷新时实时调用 SkyMail API
- 不进行本地缓存（始终显示最新状态）
- 时间戳按 UTC 时间解析

## 性能建议

- **少量邮箱**：直接使用，无需优化
- **大量邮箱**（100+）：建议在 SkyMail 层面做好数据库优化
- **高并发场景**：建议在 OutlookMail Plus 前加负载均衡

## 安全建议

✅ 使用 HTTPS 部署 SkyMail 服务  
✅ 管理员密码使用强密码  
✅ 定期更换管理员 Token（重新生成即可）  
✅ 限制 SkyMail API 的访问 IP（通过防火墙）  
✅ 不要将 plugin 配置文件提交到公开仓库  

## 下一步

- 了解更多 API 用法：[注册与邮箱池接口文档](../../../注册与邮箱池接口文档.md)
- 查看完整配置说明：[README.md](./README.md)
- 开发自定义插件：[临时邮箱 Provider 插件接入说明](../../../临时邮箱Provider插件接入说明.md)

---

如有问题，欢迎提 Issue 或联系：outlookmailplus@163.com
