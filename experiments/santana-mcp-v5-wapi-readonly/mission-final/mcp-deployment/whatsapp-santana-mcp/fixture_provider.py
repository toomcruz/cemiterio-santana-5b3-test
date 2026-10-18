"""Synthetic records for local protocol and authorization tests only."""

CONTACTS = {
    "contact-demo-01": {"id": "contact-demo-01", "name": "Munícipe Fictício A", "phone": "+5511999990001"},
    "contact-demo-02": {"id": "contact-demo-02", "name": "Munícipe Fictício B", "phone": "+5511999990002"},
}
CONVERSATIONS = [
    {"id": "conversation-demo-01", "contact_id": "contact-demo-01", "status": "active", "human_paused": False},
    {"id": "conversation-demo-02", "contact_id": "contact-demo-02", "status": "human_takeover", "human_paused": True},
]
MESSAGES = {
    "conversation-demo-01": [
        {"id": "message-demo-01", "direction": "inbound", "text": "Mensagem fictícia de teste.", "created_at": "2026-10-17T00:00:00Z"},
        {"id": "message-demo-02", "direction": "outbound", "text": "Resposta fictícia de teste.", "created_at": "2026-10-17T00:00:05Z"},
    ],
    "conversation-demo-02": [
        {"id": "message-demo-03", "direction": "inbound", "text": "Conversa fictícia em pausa humana.", "created_at": "2026-10-17T00:01:00Z"},
    ],
}
FILES = {
    "conversation-demo-01": [{"id": "file-demo-01", "name": "documento-ficticio.pdf", "mime_type": "application/pdf", "size_bytes": 12345}],
}


class FixtureProvider:
    def list_conversations(self, per_page=20, page=1):
        if not isinstance(per_page, int) or isinstance(per_page, bool) or not 1 <= per_page <= 50:
            raise ValueError("per_page deve estar entre 1 e 50.")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 10000:
            raise ValueError("page deve estar entre 1 e 10000.")
        start = (page - 1) * per_page
        return {"source": "fixture", "page": page, "per_page": per_page,
                "items": CONVERSATIONS[start:start + per_page]}

    def get_conversation(self, phone):
        if not isinstance(phone, str) or not phone.strip():
            raise ValueError("phone obrigatório.")
        for conversation in CONVERSATIONS:
            contact = CONTACTS[conversation["contact_id"]]
            if contact["phone"] == phone:
                return {"source": "fixture", "conversation": conversation}
        return {"source": "fixture", "conversation": None}

    def list_contacts(self, per_page=20, page=1):
        if not isinstance(per_page, int) or isinstance(per_page, bool) or not 1 <= per_page <= 50:
            raise ValueError("per_page deve estar entre 1 e 50.")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 10000:
            raise ValueError("page deve estar entre 1 e 10000.")
        start = (page - 1) * per_page
        return {"source": "fixture", "page": page, "per_page": per_page,
                "items": list(CONTACTS.values())[start:start + per_page]}

    def get_messages(self, conversation_id, limit=50):
        if not conversation_id:
            raise ValueError("conversation_id obrigatório.")
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("limit deve estar entre 1 e 100.")
        if conversation_id not in MESSAGES:
            raise ValueError("Conversa não encontrada no fixture.")
        return {"source": "fixture", "conversation_id": conversation_id, "items": MESSAGES[conversation_id][:limit]}

    def get_contact(self, contact_id=None, phone=None):
        if bool(contact_id) == bool(phone):
            raise ValueError("Informe somente contact_id ou phone.")
        for item in CONTACTS.values():
            if item["id"] == contact_id or item["phone"] == phone:
                return {"source": "fixture", "contact": item}
        return {"source": "fixture", "contact": None}

    def list_files(self, conversation_id):
        if not conversation_id:
            raise ValueError("conversation_id obrigatório.")
        return {"source": "fixture", "conversation_id": conversation_id, "items": FILES.get(conversation_id, [])}
