import json
import secrets
import unittest
from unittest.mock import Mock, patch

from diagnose_wapi import diagnose
from routed_read_provider import AuthorizedWapiProvider
from provider_catalog import read_route
from wapi_provider import WapiReadProvider, WapiCapabilityError, WapiPayloadError


class WapiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_hex(32)
        self.calls = []

    def transport(self, url, token):
        self.calls.append(url)
        if '/status-instance?' in url:
            return 200, {'connected': True}
        return 200, {'token': self.secret, 'webhookReceivedUrl': 'private', 'instanceType': 'LITE'}

    def test_lite_pro_routes_are_blocked_without_network(self):
        p = WapiReadProvider('synthetic', self.secret, self.transport, plan='LITE')
        for f in (p.list_conversations, p.list_contacts, lambda: p.get_conversation('5511999990001')):
            with self.assertRaises(WapiCapabilityError):
                f()
        self.assertEqual(self.calls, [])
        self.assertTrue(p.status()['connected'])

    def test_instance_payload_never_exposes_credentials_or_webhooks(self):
        p = WapiReadProvider('synthetic', self.secret, self.transport, plan='LITE')
        r = p.instance_metadata()
        self.assertEqual(r['observed_plan'], 'LITE')
        self.assertNotIn(self.secret, json.dumps(r))
        self.assertNotIn('private', json.dumps(r))

    def test_http_200_error_is_not_live_connection_proof(self):
        for payload in ({'error': True, 'connected': True}, {'success': False, 'connected': True}):
            p = WapiReadProvider('synthetic', self.secret, lambda *args: (200, payload))
            with self.assertRaises(WapiPayloadError):
                p.status()

    def test_instance_cannot_be_overridden(self):
        p = WapiReadProvider('synthetic', self.secret, self.transport)
        with self.assertRaises(ValueError):
            p._request('/v1/instance/status-instance', {'instanceId': 'other'})
        self.assertEqual(self.calls, [])

    def test_diagnosis_is_bounded_and_redacted(self):
        r = diagnose({'WAPI_TOKEN': self.secret, 'WAPI_INSTANCE_ID': 'synthetic'}, self.transport)
        self.assertTrue(r['connection_proven'])
        self.assertFalse(r['authorized_message_read_proven'])
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn(self.secret, json.dumps(r))
        self.assertEqual(r['calls'][-1]['result'], 'SKIPPED_CONFIGURED_PLAN')

    def test_denied_credentials_stop_diagnosis(self):
        calls = []
        def denied(*args):
            calls.append(args)
            return 401, {'error': 'sensitive'}
        r = diagnose({'WAPI_TOKEN': self.secret, 'WAPI_INSTANCE_ID': 'synthetic'}, denied)
        self.assertEqual(len(calls), 1)
        self.assertFalse(r['connection_proven'])
        self.assertNotIn('sensitive', json.dumps(r))

    def test_documentation_is_separate_from_runtime_observation(self):
        r = diagnose({})
        self.assertEqual(r['status'], 'NOT_TESTED')
        self.assertIsNone(r['observed_plan'])
        self.assertFalse(read_route('contacts', 'LITE')['available'])
        self.assertEqual(read_route('files', 'LITE')['fallback'], 'authorized_sana_storage')

    def test_hybrid_requires_individual_bearer(self):
        with self.assertRaises(PermissionError):
            AuthorizedWapiProvider(Mock(forward_bearer=False), Mock())

    def test_hybrid_propagates_denial_and_never_falls_back_to_wapi(self):
        sana = Mock(forward_bearer=True)
        sana.get_messages.side_effect = PermissionError('denied')
        wapi = Mock()
        p = AuthorizedWapiProvider(sana, wapi)
        with self.assertRaises(PermissionError):
            p.get_messages('scoped-conversation', access_token='individual')
        wapi.assert_not_called()
        self.assertEqual(wapi.mock_calls, [])
        sana.get_messages.assert_called_once_with('scoped-conversation', access_token='individual')

    def test_synthetic_homolog_cannot_authorize_real_instance(self):
        sana = Mock(forward_bearer=True)
        sana.list_conversations.return_value = {'source': 'synthetic_homolog'}
        wapi = Mock()
        with self.assertRaises(PermissionError):
            AuthorizedWapiProvider(sana, wapi).status('individual')
        self.assertEqual(wapi.mock_calls, [])

    def test_real_status_requires_authorized_panel_first(self):
        order = []
        sana = Mock(forward_bearer=True)
        sana.list_conversations.side_effect = lambda *a, **k: (order.append('auth') or {'source': 'sana_panel_fast_snapshot'})
        wapi = Mock()
        wapi.status.side_effect = lambda: (order.append('wapi') or {'source': 'w-api', 'connected': True})
        self.assertTrue(AuthorizedWapiProvider(sana, wapi).status('individual')['connected'])
        self.assertEqual(order, ['auth', 'wapi'])

    def test_mcp_hybrid_uses_individual_oauth_and_preserves_denial(self):
        import server
        provider = Mock()
        provider.get_messages.side_effect = PermissionError('denied')
        token = 'header.payload.signature'
        with patch.object(server, 'DATA_SOURCE', 'sana_wapi'), patch.object(server, 'PROVIDER', provider), \
             patch.object(server, 'verify_oauth_identity', return_value={'client_id': 'oauth-client'}), \
             patch.dict(server.os.environ, {'CHATGPT_OAUTH_CLIENT_ID': 'oauth-client'}):
            identity, forwarded = server.identify_request('Bearer ' + token)
            self.assertEqual(identity, ('chatgpt', 'read'))
            self.assertEqual(forwarded, token)
            with self.assertRaises(server.MCPError) as ctx:
                server._read_dispatch('consultar_mensagens', {'conversation_id': 'scope'}, forwarded)
            self.assertEqual(ctx.exception.code, -32003)
            provider.get_messages.assert_called_once_with('scope', 50, False, None, None, access_token=token)

    def test_mcp_hybrid_tools_preserve_ids_and_write_block(self):
        import server
        with patch.object(server, 'DATA_SOURCE', 'sana_wapi'), \
             patch.object(server, 'READ_TOOLS', server.ALL_READ_TOOL_NAMES), \
             patch.object(server, 'CLIENT_READ_SCOPES', {'chatgpt': server.ALL_READ_TOOL_NAMES}):
            result = server.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}, ('chatgpt', 'read'))
            tools = {t['name']: t for t in result['result']['tools']}
            self.assertIn('consultar_conexao', tools)
            self.assertEqual(tools['consultar_contato']['inputSchema']['required'], ['conversation_id'])
            self.assertFalse(any(name in server.WRITE_TOOLS for name in tools))
            self.assertFalse(server.REAL_SEND_GATE_OPEN)


if __name__ == '__main__':
    unittest.main()
