-- =============================================================================
-- outlook-email-plus 账号清理 / 归档方案（只读诊断 + 可控删除）
-- 生成日期：2026-08-05
-- 库文件：data/outlook_accounts.db
--
-- 背景：
--   accounts ≈ 116 万行，DB ≈ 1.7GiB，仅 refresh_token 文本 ≈ 825MiB。
--   单进程 gunicorn 全表 hydrate 会把 RSS 顶到 10GiB+。
--
-- 使用原则：
--   1. 先跑「诊断」段，确认分组/状态/可归档范围
--   2. 在事务中执行「归档」或「删除」，先 BEGIN 再人工核对 rowcount
--   3. 默认不要直接在生产无备份时 DELETE；优先复制到归档库/导出后删
--   4. 大删除后执行 VACUUM（会长时间锁库，需停服务窗口）
-- =============================================================================

.headers on
.mode column

-- ---------------------------------------------------------------------------
-- A. 诊断（只读）
-- ---------------------------------------------------------------------------

-- A1. 总体规模
SELECT COUNT(*) AS accounts_total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_cnt,
       SUM(CASE WHEN status != 'active' OR status IS NULL THEN 1 ELSE 0 END) AS non_active_cnt,
       ROUND(SUM(LENGTH(COALESCE(refresh_token, ''))) / 1024.0 / 1024.0, 1) AS refresh_token_mb,
       ROUND(SUM(LENGTH(COALESCE(password, ''))) / 1024.0 / 1024.0, 1) AS password_mb
FROM accounts;

-- A2. 按分组规模（优先处理超大组）
SELECT g.id,
       g.name,
       COUNT(a.id) AS account_cnt,
       ROUND(SUM(LENGTH(COALESCE(a.refresh_token, ''))) / 1024.0 / 1024.0, 1) AS token_mb
FROM groups g
LEFT JOIN accounts a ON a.group_id = g.id
GROUP BY g.id
ORDER BY account_cnt DESC;

-- A3. 无分组账号
SELECT COUNT(*) AS ungrouped
FROM accounts
WHERE group_id IS NULL;

-- A4. pool 状态分布
SELECT COALESCE(pool_status, '<null>') AS pool_status, COUNT(*) AS cnt
FROM accounts
GROUP BY pool_status
ORDER BY cnt DESC;

-- A5. 刷新时间分布（长期未刷新可归档）
SELECT
  SUM(CASE WHEN last_refresh_at IS NULL OR TRIM(last_refresh_at) = '' THEN 1 ELSE 0 END) AS never_refreshed,
  SUM(CASE WHEN last_refresh_at < datetime('now', '-90 days') THEN 1 ELSE 0 END) AS older_than_90d,
  SUM(CASE WHEN last_refresh_at < datetime('now', '-180 days') THEN 1 ELSE 0 END) AS older_than_180d,
  SUM(CASE WHEN last_refresh_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS refreshed_30d
FROM accounts
WHERE status = 'active';

-- A6. 空 token / 可疑凭据
SELECT
  SUM(CASE WHEN TRIM(COALESCE(refresh_token, '')) = '' THEN 1 ELSE 0 END) AS empty_refresh_token,
  SUM(CASE WHEN TRIM(COALESCE(client_id, '')) = '' THEN 1 ELSE 0 END) AS empty_client_id,
  SUM(CASE WHEN LENGTH(refresh_token) < 20 THEN 1 ELSE 0 END) AS short_refresh_token
FROM accounts;

-- A7. audit_logs 规模
SELECT COUNT(*) AS audit_rows,
       ROUND(SUM(LENGTH(COALESCE(details, ''))) / 1024.0 / 1024.0, 1) AS details_mb,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM audit_logs;

-- A8. 库页信息
PRAGMA page_count;
PRAGMA page_size;
PRAGMA freelist_count;


-- ---------------------------------------------------------------------------
-- B. 归档表（可选：先把候选行搬出主表，再决定是否物理删除）
-- ---------------------------------------------------------------------------
-- 创建归档表（若已存在可跳过）
CREATE TABLE IF NOT EXISTS accounts_archive (
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    archive_reason TEXT,
    id INTEGER,
    email TEXT,
    password TEXT,
    client_id TEXT,
    refresh_token TEXT,
    account_type TEXT,
    provider TEXT,
    group_id INTEGER,
    status TEXT,
    last_refresh_at TEXT,
    created_at TEXT,
    pool_status TEXT,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_archive_email ON accounts_archive(email);
CREATE INDEX IF NOT EXISTS idx_accounts_archive_reason ON accounts_archive(archive_reason);


-- ---------------------------------------------------------------------------
-- C. 可控清理示例（务必先备份！）
--    备份示例：
--      cp data/outlook_accounts.db data/outlook_accounts.db.bak.$(date +%Y%m%d%H%M%S)
-- ---------------------------------------------------------------------------

-- C1. 归档：指定超大分组（把 :group_id 换成真实 id，例如 187）
-- BEGIN;
-- INSERT INTO accounts_archive (
--   archive_reason, id, email, password, client_id, refresh_token,
--   account_type, provider, group_id, status, last_refresh_at, created_at, pool_status
-- )
-- SELECT 'group_archive:' || group_id, id, email, password, client_id, refresh_token,
--        account_type, provider, group_id, status, last_refresh_at, created_at, pool_status
-- FROM accounts
-- WHERE group_id = :group_id;
--
-- DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE group_id = :group_id);
-- DELETE FROM account_refresh_logs WHERE account_id IN (SELECT id FROM accounts WHERE group_id = :group_id);
-- DELETE FROM account_claim_logs WHERE account_id IN (SELECT id FROM accounts WHERE group_id = :group_id);
-- DELETE FROM account_project_usage WHERE account_id IN (SELECT id FROM accounts WHERE group_id = :group_id);
-- DELETE FROM accounts WHERE group_id = :group_id;
-- -- 核对变更行数后：
-- -- COMMIT;
-- -- ROLLBACK;

-- C2. 归档：空 refresh_token 的 outlook 账号（通常不可用）
-- BEGIN;
-- INSERT INTO accounts_archive (
--   archive_reason, id, email, password, client_id, refresh_token,
--   account_type, provider, group_id, status, last_refresh_at, created_at, pool_status
-- )
-- SELECT 'empty_refresh_token', id, email, password, client_id, refresh_token,
--        account_type, provider, group_id, status, last_refresh_at, created_at, pool_status
-- FROM accounts
-- WHERE TRIM(COALESCE(refresh_token, '')) = ''
--   AND LOWER(COALESCE(account_type, 'outlook')) = 'outlook';
--
-- DELETE FROM account_tags WHERE account_id IN (
--   SELECT id FROM accounts
--   WHERE TRIM(COALESCE(refresh_token, '')) = ''
--     AND LOWER(COALESCE(account_type, 'outlook')) = 'outlook'
-- );
-- DELETE FROM accounts
-- WHERE TRIM(COALESCE(refresh_token, '')) = ''
--   AND LOWER(COALESCE(account_type, 'outlook')) = 'outlook';
-- -- COMMIT; / ROLLBACK;

-- C3. 清理 90 天前 audit_logs（低风险，建议先做）
-- BEGIN;
-- DELETE FROM audit_logs WHERE created_at < datetime('now', '-90 days');
-- -- COMMIT;

-- C4. 清理 6 个月前 refresh 日志（代码里定时任务也会做，可手动加速）
-- BEGIN;
-- DELETE FROM account_refresh_logs WHERE created_at < datetime('now', '-6 months');
-- DELETE FROM refresh_runs WHERE started_at < datetime('now', '-6 months');
-- -- COMMIT;


-- ---------------------------------------------------------------------------
-- D. 空间回收（高风险/长耗时：需要停服务维护窗）
-- ---------------------------------------------------------------------------
-- 1) 停容器：docker stop outlook-email-plus
-- 2) 确认无其它进程打开 DB
-- 3) 执行：
--      sqlite3 data/outlook_accounts.db 'VACUUM;'
-- 4) 启动：docker start outlook-email-plus
--
-- 注意：VACUUM 会重写整个库文件，1.7GiB 可能需要数分钟到更久，并临时需要同体量磁盘空间。


-- ---------------------------------------------------------------------------
-- E. 建议目标水位
-- ---------------------------------------------------------------------------
-- 热数据（经常 claim/读信）建议控制在 5~20 万账号/实例以内；
-- 超过 50 万应分库/分实例，或把冷号只放对象存储/归档表，不进运行库。
