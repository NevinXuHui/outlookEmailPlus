# SkyMail 临时邮箱 Provider

OutlookMail Plus 的 SkyMail 临时邮箱服务集成插件。

## 功能特性

- ✅ 创建临时邮箱账号
- ✅ 读取邮件列表
- ✅ 获取邮件详情（HTML + 纯文本）
- ❌ 删除邮箱（API 不支持）
- ❌ 删除单条邮件（API 不支持）
- ❌ 清空邮箱（API 不支持）

## 配置说明

### 必填参数

| 参数 | 说明 | 示例 |
|------|------|------|
| **Base URL** | SkyMail API 服务地址 | `https://api.skymail.ink` |
| **管理员邮箱** | 你的 SkyMail 管理员账号邮箱 | `admin@example.com` |
| **管理员密码** | 对应的密码 | `your_password` |

### 可选参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| **可用域名** | 每行一个域名，用于创建邮箱 | 空（需手动配置） |
| **默认域名** | 创建邮箱时的首选域名 | 第一个可用域名 |
| **默认用户密码** | 创建账号时的默认密码，留空则自动生成 | 空（自动生成） |
| **请求超时** | API 请求超时时间（秒） | `30` |

## 使用步骤

### 1. 获取 SkyMail 管理员账号

首先需要在 SkyMail 服务中创建一个管理员账号。参考 [SkyMail 文档](https://doc.skymail.ink)。

### 2. 配置域名

在插件设置中填写 **可用域名**，每行一个，例如：

```
example.com
mail.example.com
temp.example.com
```

### 3. 安装插件

在 OutlookMail Plus 的插件管理页面：
1. 上传 `skymail` 插件目录（或通过插件市场安装）
2. 启用插件
3. 配置必填参数

### 4. 使用临时邮箱

- 在"临时邮箱"页面选择 **SkyMail** 作为 Provider
- 系统会自动调用 SkyMail API 创建账号并接收邮件
- 创建的账号可在 SkyMail 管理后台查看

## API 调用流程

### 创建邮箱

```
POST /api/public/genToken       # 获取管理员 Token
POST /api/public/addUser         # 创建用户账号
  ├─ email: "user@example.com"
  └─ password: "auto_generated"
```

### 读取邮件

```
POST /api/public/emailList       # 查询收件箱
  ├─ toEmail: "user@example.com"
  ├─ type: 0 (收件)
  └─ timeSort: "desc"
```

## 注意事项

1. **Token 管理**  
   插件会自动获取和缓存 SkyMail Token，Token 过期时会自动刷新。

2. **域名配置**  
   必须在插件设置中配置可用域名，否则无法创建邮箱。

3. **删除功能**  
   SkyMail API 目前不提供删除用户或邮件的接口，创建的账号会保留在系统中。

4. **密码管理**  
   - 如果设置了"默认用户密码"，所有创建的账号使用相同密码
   - 留空则每个账号使用随机生成的 12 位密码
   - 密码会保存在邮箱的 `meta.password` 字段中

5. **邮件查询**  
   SkyMail 的 `emailList` 接口已返回完整邮件内容（HTML + 文本），无需单独的 detail 接口。

## 故障排查

### Token 获取失败

- 检查管理员邮箱和密码是否正确
- 确认 Base URL 可访问
- 查看网络连接是否正常

### 创建邮箱失败

- 确认已配置可用域名
- 检查域名是否在 SkyMail 系统中存在
- 查看是否超出账号配额

### 收不到邮件

- 确认邮箱地址正确
- 检查发件方是否成功发送
- 在 SkyMail 管理后台查看原始邮件

## 版本历史

- **v1.0.0** (2026-07-08)
  - 初始版本
  - 支持创建账号、读取邮件
  - 完整的错误处理和 Token 管理

## 许可证

Apache License 2.0

## 联系方式

- SkyMail 文档：https://doc.skymail.ink
- OutlookMail Plus：https://github.com/zeropointsix/outlook-email-plus
