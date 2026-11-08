"""Read-only counts using the same project-success exclusion as claim-random."""
from outlook_web.db import get_db


def project_group_availability(provider: str, project_key: str) -> list[dict]:
    rows = get_db().execute("""
        SELECT g.id, g.name, COALESCE(p.claimable_count, 0) AS claimable_count
        FROM groups g
        LEFT JOIN (
            SELECT a.group_id, COUNT(*) AS claimable_count
            FROM accounts a
            WHERE a.status = 'active' AND a.pool_status = 'available'
              AND a.provider = ?
              AND NOT EXISTS (
                  SELECT 1 FROM account_project_usage u
                  WHERE u.account_id = a.id AND u.project_key = ? AND u.success_count > 0
              )
            GROUP BY a.group_id
        ) p ON p.group_id = g.id
        ORDER BY g.id
    """, (provider, project_key)).fetchall()
    return [{'id': row['id'], 'name': row['name'], 'claimable_count': row['claimable_count']} for row in rows]
