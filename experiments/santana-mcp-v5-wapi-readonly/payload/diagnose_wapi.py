#!/usr/bin/env python3
"""Bounded GET-only diagnosis: documented capabilities are not live proof."""
import json
import os
from provider_catalog import read_route
from wapi_provider import WapiReadProvider, WapiHTTPError, WapiCapabilityError, WapiPayloadError


def diagnose(env=None, transport=None, *, probe_pro_routes=False):
    env = os.environ if env is None else env
    token = env.get('WAPI_API_TOKEN') or env.get('WAPI_TOKEN')
    plan = env.get('WAPI_PLAN', 'LITE')
    result = {'status': 'NOT_TESTED', 'real_send_attempts': 0, 'calls': [],
              'configured_plan': plan, 'observed_plan': None,
              'routes': {key: read_route(key, plan) for key in
                         ('connection', 'instance', 'conversations', 'conversation', 'contacts', 'messages', 'files')}}
    if not token or not env.get('WAPI_INSTANCE_ID'):
        return {**result, 'reason': 'credentials_not_available_in_mcp_environment'}
    provider = WapiReadProvider(env['WAPI_INSTANCE_ID'], token, transport,
                                plan=None if probe_pro_routes else plan)
    result['status'] = 'READ_ONLY_PROBE'
    for label, operation in [('connection', provider.status), ('instance', provider.instance_metadata),
                             ('conversations', lambda: provider.list_conversations(1, 1)),
                             ('contacts', lambda: provider.list_contacts(1, 1))]:
        try:
            data = operation()
            entry = {'operation': label, 'http': 200, 'result': 'API_OPERATION_OK'}
            if label == 'connection':
                entry['connected'] = data['connected']
            if label == 'instance':
                result['observed_plan'] = data.get('observed_plan')
        except WapiCapabilityError:
            entry = {'operation': label, 'http': None, 'result': 'SKIPPED_CONFIGURED_PLAN'}
        except WapiHTTPError as exc:
            entry = {'operation': label, 'http': exc.status, 'result': 'API_DENIED_OR_UNAVAILABLE'}
        except WapiPayloadError:
            entry = {'operation': label, 'http': 200, 'result': 'API_ERROR_ENVELOPE'}
        except Exception:
            entry = {'operation': label, 'http': None, 'result': 'REDACTED_TRANSPORT_OR_CONFIGURATION_FAILURE'}
        result['calls'].append(entry)
        if entry.get('http') in (401, 429):
            break
    result['connection_proven'] = any(x.get('connected') is True for x in result['calls'])
    result['authorized_message_read_proven'] = False
    result['history_source'] = 'Sana authorized storage; W-API is not a historical message store'
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(diagnose(), ensure_ascii=False, indent=2))
    except Exception:
        print(json.dumps({'status': 'NOT_TESTED', 'reason': 'invalid_configuration', 'real_send_attempts': 0}))
