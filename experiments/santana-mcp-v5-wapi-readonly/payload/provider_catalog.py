"""W-API capabilities from docs.w-api.app, retrieved 2026-10-18.

This is documentation, not evidence of live API access. Tool organization uses
the instance / contacts / conversations / files split of mcp-zapi as reference;
no code or OAuth implementation from that project is imported.
"""
WAPI_CAPABILITIES = {
    'connection': {'group': 'instance', 'method': 'GET', 'path': '/v1/instance/status-instance', 'plans': ('LITE', 'PRO')},
    'instance': {'group': 'instance', 'method': 'GET', 'path': '/v1/instance/fetch-instance', 'plans': ('LITE', 'PRO')},
    'conversations': {'group': 'conversations', 'method': 'GET', 'path': '/v1/chats/fetch-chats', 'plans': ('PRO',)},
    'conversation': {'group': 'conversations', 'method': 'GET', 'path': '/v1/chats/chat', 'plans': ('PRO',)},
    'contacts': {'group': 'contacts', 'method': 'GET', 'path': '/v1/contacts/fetch-contacts', 'plans': ('PRO',)},
    'messages': {'group': 'messages', 'method': None, 'path': None, 'plans': ()},
    'files': {'group': 'files', 'method': None, 'path': None, 'plans': ()},
}


def read_route(operation, plan):
    capability = WAPI_CAPABILITIES[operation]
    return {**capability, 'available': plan in capability['plans'],
            'fallback': None if plan in capability['plans'] else 'authorized_sana_storage'}
