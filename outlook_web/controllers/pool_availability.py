"""Authenticated project-scoped pool stock; never claims or modifies an account."""
from flask import jsonify, request

from outlook_web.controllers.external_pool import _audit, _check_pool_access, _check_pool_external_enabled
from outlook_web.repositories.pool_availability import project_group_availability
from outlook_web.security.auth import api_key_required
from outlook_web.security.external_api_guard import external_api_guards
from outlook_web.services import external_api as external_api_service


@api_key_required
@external_api_guards(feature='pool_stats')
def api_external_pool_availability():
    endpoint = '/api/external/pool/availability'
    denied = _check_pool_external_enabled(endpoint)
    if denied is not None:
        return denied
    denied = _check_pool_access(endpoint)
    if denied is not None:
        return denied
    provider = str(request.args.get('provider') or '').strip()
    project_key = str(request.args.get('project_key') or '').strip()
    if not provider or len(provider) > 64 or not project_key or len(project_key) > 128:
        return jsonify(external_api_service.fail('INVALID_SCOPE', 'provider 和 project_key 必须有效')), 400
    try:
        groups = project_group_availability(provider, project_key)
        _audit(endpoint, 'ok', details={'provider': provider, 'project_key': project_key})
        return jsonify(external_api_service.ok({
            'provider': provider, 'project_key': project_key, 'groups': groups,
        }))
    except Exception as error:
        _audit(endpoint, 'error', details={'code': 'INTERNAL_ERROR', 'err': type(error).__name__})
        return jsonify(external_api_service.fail('INTERNAL_ERROR', '服务内部错误')), 500
