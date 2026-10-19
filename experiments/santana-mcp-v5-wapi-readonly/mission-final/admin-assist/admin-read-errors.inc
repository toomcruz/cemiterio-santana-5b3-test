class AdministrativeReadError(RuntimeError):
    """Only fixed public error codes cross the MCP boundary; never payloads."""
    safe_admin_error = True
    CODES = frozenset({
        'MCP_ADMIN_ATTACHMENT_DENIED','MCP_ADMIN_ATTACHMENT_UNAVAILABLE',
        'MCP_ADMIN_ATTACHMENT_TIMEOUT','MCP_ADMIN_ATTACHMENT_TOO_LARGE',
        'MCP_ADMIN_ATTACHMENT_INTEGRITY','MCP_ADMIN_MEDIA_TYPE_UNSUPPORTED',
        'MCP_ADMIN_MEDIA_UNAVAILABLE','MCP_ADMIN_SOURCE_UNAVAILABLE',
        'MCP_ADMIN_UPSTREAM_UNAVAILABLE','MCP_ADMIN_RATE_LIMITED',
        'MCP_ADMIN_GRANT_REQUIRED','MCP_ADMIN_SCOPE_DENIED',
        'MCP_ADMIN_OPERATOR_REVOKED','MCP_ADMIN_CONVERSATION_DENIED',
        'MCP_ADMIN_INVALID_REQUEST','MCP_ADMIN_UNAVAILABLE',
    })

    def __init__(self, code, http_status=503, retry_after=None):
        self.code = code if code in self.CODES else 'MCP_ADMIN_UPSTREAM_UNAVAILABLE'
        self.http_status = http_status if type(http_status) is int and 400 <= http_status <= 599 else 503
        self.retry_after = retry_after if type(retry_after) is int and 1 <= retry_after <= 60 else None
        super().__init__(self.code)

