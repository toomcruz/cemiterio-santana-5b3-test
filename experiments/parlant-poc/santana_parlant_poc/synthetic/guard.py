"""Prova automatizada de zero rede externa.

Nao basta afirmar que o provider sintetico nao usa rede: este modulo intercepta
o proprio `socket` e conta toda tentativa de conexao. Loopback e permitido (o
laboratorio conversa com o servidor Parlant local); qualquer outro destino e
bloqueado e contabilizado como violacao.

    with NetworkGuard() as guarda:
        ...
    assert guarda.external_calls == 0
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass, field
from typing import Any


class ExternalNetworkBlocked(RuntimeError):
    """Levantada quando algum componente tenta sair para a rede."""


@dataclass
class TentativaExterna:
    destino: str
    porta: int | None


def _normalizar_host(host: Any) -> str:
    """O host chega como str ou bytes (asyncio.getaddrinfo usa bytes)."""
    if isinstance(host, (bytes, bytearray)):
        return host.decode("utf-8", "ignore")
    return "" if host is None else str(host)


def _e_loopback(host: str) -> bool:
    if host in ("localhost", "", "::1", "ip6-localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass
class NetworkGuard:
    """Bloqueia e conta conexoes para fora do loopback."""

    permitir_loopback: bool = True
    external_calls: int = 0
    tentativas: list[TentativaExterna] = field(default_factory=list)
    _socket_connect: Any = None
    _create_connection: Any = None
    _getaddrinfo: Any = None

    # ------------------------------------------------------------------ core
    def _checar(self, endereco: Any) -> None:
        host, porta = None, None
        if isinstance(endereco, tuple) and endereco:
            host = _normalizar_host(endereco[0])
            porta = endereco[1] if len(endereco) > 1 else None

        if host is not None and self.permitir_loopback and _e_loopback(host):
            return

        self.external_calls += 1
        self.tentativas.append(TentativaExterna(destino=str(host), porta=porta))
        raise ExternalNetworkBlocked(
            f"conexao externa bloqueada pelo NetworkGuard: {host}:{porta}"
        )

    # ------------------------------------------------------------- ativacao
    def __enter__(self) -> NetworkGuard:
        guarda = self

        self._socket_connect = socket.socket.connect
        self._create_connection = socket.create_connection
        self._getaddrinfo = socket.getaddrinfo

        def connect(self_socket: Any, endereco: Any, *args: Any, **kwargs: Any) -> Any:
            guarda._checar(endereco)
            return guarda._socket_connect(self_socket, endereco, *args, **kwargs)

        def create_connection(endereco: Any, *args: Any, **kwargs: Any) -> Any:
            guarda._checar(endereco)
            return guarda._create_connection(endereco, *args, **kwargs)

        def getaddrinfo(host: Any, porta: Any, *args: Any, **kwargs: Any) -> Any:
            # Resolucao de nome externo tambem conta: e o primeiro passo de uma
            # chamada a Gemini/OpenAI e falha cedo, com mensagem clara.
            guarda._checar((host, porta))
            return guarda._getaddrinfo(host, porta, *args, **kwargs)

        socket.socket.connect = connect  # type: ignore[method-assign]
        socket.create_connection = create_connection  # type: ignore[assignment]
        socket.getaddrinfo = getaddrinfo  # type: ignore[assignment]
        return self

    def __exit__(self, *_: Any) -> None:
        socket.socket.connect = self._socket_connect  # type: ignore[method-assign]
        socket.create_connection = self._create_connection  # type: ignore[assignment]
        socket.getaddrinfo = self._getaddrinfo  # type: ignore[assignment]

    def resumo(self) -> dict[str, Any]:
        return {
            "external_network_calls": self.external_calls,
            "tentativas": [
                {"destino": t.destino, "porta": t.porta} for t in self.tentativas
            ],
        }
