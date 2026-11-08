# 项目剩余邮箱统计

`GET /api/external/pool/availability?provider=outlook&project_key=duckmail`

鉴权与外部邮箱池统计一致：`X-API-Key`、已启用外部池、API Key 具有池访问权限，同时遵守统计接口禁用、IP 白名单及限流设置。

返回 `data.provider`、`data.project_key` 以及 `data.groups[]` 的 `id`、`name`、`claimable_count`，不返回邮箱或凭证。项目标识必须非空且不超过 128 字符。

`claimable_count` 按该分组、提供商的 active + available 邮箱统计，排除 `account_project_usage` 中相同项目已有 `success_count > 0` 的邮箱，与 `claim-random` 的项目去重条件一致。成功历史跨调用方生效；失败、释放或过期留下的无成功记录不排除邮箱。SQL 使用 `NOT EXISTS`，多调用方成功记录不会重复扣减。

该查询不领取邮箱或修改邮箱状态。统计与后续领取之间仍可能有其他任务领取或归还，因此库存不是预约承诺。旧 `/api/external/groups` 的 `pool_available_count` 继续表示通用邮箱池状态数量，不能用作当前项目剩余量。
