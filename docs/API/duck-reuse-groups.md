# Duck 旧账号复用的分组邮箱接口

`GET /api/external/accounts/group?group_id=183&limit=500&after_id=0` 使用现有 `X-API-Key` 鉴权、external pool 权限及公网 API 守卫。省略 `group_id` 表示全部分组，`limit` 为 1–500，响应使用现有 `success/data` 包装。

`data.accounts` 仅包含 `email`、`group_id`、`provider: outlook`、`can_read: true`；`data.group_id` 回显选择，`total` 为权限范围内匹配总数，`next_cursor` 为下一页的 `after_id`，最后一页为 `null`。调用方的 `allowed_emails` 限制同时作用于列表和总数。

本接口只查询本地账号状态及凭据是否存在，不执行 Graph/IMAP 上游探测、不解密或返回密码与令牌，也不领取或改变邮箱池状态。已经用于注册的邮箱只要仍可读，也可返回，供调用方匹配其持有的旧 Duck 主账号。`can_read` 不代表已完成上游连通性验证；在实际取信前可仅对选中的邮箱使用原 `account-status` 接口检查。

Duck 复用应先获取选中分组的邮箱，再匹配历史主账号、检查每日使用和并发租约；不应逐一探测全部历史账号后判断所属分组。
