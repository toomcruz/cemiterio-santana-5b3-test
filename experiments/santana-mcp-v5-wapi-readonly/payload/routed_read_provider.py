"""W-API status plus individually authorized Sana reads. No silent fallback.

For LITE, chats, contacts, messages and files use the existing Sana adapter.
An upstream denial is never replaced by unscoped W-API or fixture data.
"""
from sana_read_provider import from_environment as sana_from_environment
from wapi_provider import from_environment as wapi_from_environment


class AuthorizedWapiProvider:
    def __init__(self, sana, wapi):
        if not sana.forward_bearer:
            raise PermissionError('O modo integrado exige autenticação individual por chamada.')
        self.sana = sana
        self.wapi = wapi

    def status(self, access_token=None):
        # The backend must authenticate the operator and grant a real read first.
        authorization = self.sana.list_conversations(1, 1, access_token=access_token)
        if authorization.get('source') != 'sana_panel_fast_snapshot':
            raise PermissionError('Uma concessão sintética não autoriza a instância W-API real.')
        return self.wapi.status()

    def list_conversations(self, *args, **kwargs):
        return self.sana.list_conversations(*args, **kwargs)

    def get_conversation(self, *args, **kwargs):
        return self.sana.get_conversation(*args, **kwargs)

    def list_contacts(self, *args, **kwargs):
        return self.sana.list_contacts(*args, **kwargs)

    def get_contact(self, *args, **kwargs):
        return self.sana.get_contact(*args, **kwargs)

    def get_messages(self, *args, **kwargs):
        return self.sana.get_messages(*args, **kwargs)

    def list_files(self, *args, **kwargs):
        return self.sana.list_files(*args, **kwargs)


def from_environment():
    return AuthorizedWapiProvider(sana_from_environment(), wapi_from_environment())
