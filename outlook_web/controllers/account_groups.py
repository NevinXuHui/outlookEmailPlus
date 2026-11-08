"""Read Outlook inboxes directly from a selected group without probing or claiming."""
from flask import jsonify, request

from outlook_web.controllers.external_pool import _audit, _check_pool_access, _check_pool_external_enabled
from outlook_web.db import get_db
from outlook_web.security.auth import api_key_required, get_external_api_consumer
from outlook_web.security.external_api_guard import external_api_guards
from outlook_web.services import external_api as external_api_service


@api_key_required
@external_api_guards(feature='pool_stats')
def api_external_group_accounts():
    endpoint = '/api/external/accounts/group'
    for check in (_check_pool_external_enabled, _check_pool_access):
        denied = check(endpoint)
        if denied is not None:
            return denied
    try:
        group = request.args.get('group_id', '')
        group = int(group) if group else None
        after = int(request.args.get('after_id', '0'))
        limit = int(request.args.get('limit', '500'))
        if (group is not None and group <= 0) or after < 0 or not 1 <= limit <= 500:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify(external_api_service.fail('INVALID_PARAM', '分组、游标或数量无效')), 400
    allowed = {str(email).strip().lower() for email in ((get_external_api_consumer() or {}).get('allowed_emails') or [])}
    try:
        conditions = ["lower(coalesce(account_type,'outlook'))='outlook'",
                      "lower(coalesce(nullif(provider,''),'outlook'))='outlook'",
                      "lower(coalesce(status,'active'))='active'",
                      "length(trim(coalesce(client_id,'')))>0", "length(trim(coalesce(refresh_token,'')))>0"]
        params = []
        if group is not None:
            conditions.append('group_id=?')
            params.append(group)
        if allowed:
            conditions.append('lower(email) IN (' + ','.join('?' for _ in allowed) + ')')
            params.extend(sorted(allowed))
        db = get_db()
        where = ' AND '.join(conditions)
        total = db.execute('SELECT count(*) FROM accounts WHERE '+where, params).fetchone()[0]
        rows = db.execute('SELECT id,email,group_id FROM accounts WHERE '+where+' AND id>? ORDER BY id LIMIT ?',
                          [*params, after, limit + 1]).fetchall()
        items = [{'email': row['email'].strip().lower(), 'group_id': row['group_id'], 'provider': 'outlook', 'can_read': True}
                 for row in rows[:limit]]
        cursor = rows[limit - 1]['id'] if len(rows) > limit else None
        _audit(endpoint, 'ok', details={'group_id': group, 'returned': len(items)})
        return jsonify(external_api_service.ok({'accounts': items, 'group_id': group, 'total': total, 'next_cursor': cursor}))
    except Exception as error:
        _audit(endpoint, 'error', details={'code': 'INTERNAL_ERROR', 'err': type(error).__name__})
        return jsonify(external_api_service.fail('INTERNAL_ERROR', '服务内部错误')), 500
