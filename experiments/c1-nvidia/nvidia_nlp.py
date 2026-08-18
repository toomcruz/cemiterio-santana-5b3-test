"""Integracao minima NVIDIA para a C1, com contador de chamadas.

Decisoes explicitas desta camada, todas registradas:

1. **Nenhum adaptador proprio.** O Parlant 3.3.2 ja traz `NLPServices.litellm`,
   configurado inteiramente por ambiente (`LITELLM_PROVIDER_MODEL_NAME`,
   `LITELLM_PROVIDER_BASE_URL`, `LITELLM_PROVIDER_API_KEY`). Apontar para
   `https://integrate.api.nvidia.com/v1` e configuracao, nao codigo.

2. **Embeddings ficam locais.** Sem `LITELLM_EMBEDDING_MODEL_NAME`, o Parlant
   cai no `JinaAIEmbedder` (HuggingFace, roda no proprio runner). Nenhuma
   chamada de embedding sai para a NVIDIA — e o `Evaluating entities`, que com
   Gemini custou 15m17s e centenas de chamadas, deixa de consumir cota.

3. **Um unico ponto de instrumentacao.** O gerador do Parlant guarda o modulo
   `litellm` em `self._client` e chama `self._client.acompletion(...)`.
   Trocar esse atributo por um shim intercepta toda chamada sem reimplementar
   nada do Parlant.

4. **`/no_think` por decisao explicita.** O modelo escolhido e de raciocinio: a
   Fase 1A mediu `content=null` com o bloco de reasoning ocupando a resposta, e
   `finish_reason=stop` com 12 tokens depois de desligar. O shim injeta um
   system message `/no_think` em toda chamada. Isso NAO afrouxa nenhum criterio
   da C1: a interpretacao de PRECO e a escolha autonoma da tool continuam sendo
   do modelo.

O contador separa inicializacao de turno e **aborta** se o numero de chamadas
crescer alem do teto. O run 32146735829 gastou 98 chamadas sem ninguem ver;
aqui isso para sozinho.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

SYSTEM_NO_THINK = "/no_think"


class TetoDeChamadasEstourado(RuntimeError):
    """Crescimento inesperado de chamadas: aborta em vez de continuar gastando."""


@dataclass
class Chamada:
    indice: int
    fase: str
    modelo: str
    duracao_s: float
    tokens_entrada: int | None
    tokens_saida: int | None
    erro: str | None = None


@dataclass
class ContadorDeChamadas:
    """Contador de chamadas com reserva de indice sob lock.

    A primeira versao derivava o indice de `len(self.chamadas) + 1` no momento
    da reserva, mas o registro so era anexado quando a chamada terminava. Sob
    concorrencia isso tinha duas consequencias, ambas observadas no run
    32194184059: treze chamadas paralelas reservaram o mesmo indice 87, e a
    verificacao do teto podia ser atravessada por N chamadas simultaneas,
    excedendo o limite em ate N-1.

    Os totais daquele run continuam integros — `len()` e atualizado por append
    atomico, e as somas de tokens e latencia batem. O que estava corrompido era
    a identidade de cada chamada e a garantia do teto. Ver
    docs/evidencia/c1-nvidia/CORRECAO-C1.md.

    Agora a reserva incrementa um contador proprio dentro do mesmo lock: o
    indice e unico e o teto vale por reserva, nao por comprimento observado.
    """

    teto: int = 250
    fase: str = "inicializacao"
    chamadas: list[Chamada] = field(default_factory=list)
    _reservados: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def proxima(self) -> int:
        with self._lock:
            self._reservados += 1
            indice = self._reservados
            estourou = indice > self.teto
        if estourou:
            raise TetoDeChamadasEstourado(
                f"teto de {self.teto} chamadas NVIDIA estourado na chamada {indice} "
                f"(fase '{self.fase}'). Abortando para nao gastar mais."
            )
        return indice

    def registrar(self, chamada: Chamada) -> None:
        with self._lock:
            self.chamadas.append(chamada)

    def por_fase(self, fase: str) -> list[Chamada]:
        return [c for c in self.chamadas if c.fase == fase]

    def resumo(self) -> dict[str, Any]:
        def agregar(itens: list[Chamada]) -> dict[str, Any]:
            duracoes = sorted(c.duracao_s for c in itens)
            return {
                "chamadas": len(itens),
                "erros": sum(1 for c in itens if c.erro),
                "tokens_entrada": sum(c.tokens_entrada or 0 for c in itens),
                "tokens_saida": sum(c.tokens_saida or 0 for c in itens),
                "latencia_total_s": round(sum(duracoes), 2),
                "latencia_p50_s": round(duracoes[len(duracoes) // 2], 2) if duracoes else None,
                "latencia_max_s": round(duracoes[-1], 2) if duracoes else None,
            }

        erros_429 = sum(1 for c in self.chamadas if c.erro and "429" in c.erro)
        return {
            "teto": self.teto,
            "reservados": self._reservados,
            "total": len(self.chamadas),
            "inicializacao": agregar(self.por_fase("inicializacao")),
            "turno": agregar(self.por_fase("turno")),
            # O shim fica ABAIXO da camada que retenta: cada tentativa chega
            # como chamada independente, sem vinculo com a anterior. Da para
            # contar quantas falharam com 429; nao da para contar retentativas.
            "retries": {
                "erros_429": erros_429,
                "retries_observed_min": erros_429,
                "retry_owner": "Parlant/library layer",
                "nota": (
                    "o total de chamadas ja inclui as retentativas; "
                    "o numero exato de retries nao e observavel deste ponto"
                ),
            },
        }


CONTADOR = ContadorDeChamadas()


class ShimLiteLLM:
    """Substitui o modulo `litellm` no gerador do Parlant.

    Faz exatamente duas coisas: injeta o system message e contabiliza. Todo o
    resto e repassado intacto ao `litellm` real.
    """

    def __init__(self, real: Any, contador: ContadorDeChamadas) -> None:
        self._real = real
        self._contador = contador

    def __getattr__(self, nome: str) -> Any:
        return getattr(self._real, nome)

    async def acompletion(self, **kwargs: Any) -> Any:
        mensagens = list(kwargs.get("messages") or [])
        if not any(m.get("role") == "system" for m in mensagens):
            mensagens.insert(0, {"role": "system", "content": SYSTEM_NO_THINK})
        kwargs["messages"] = mensagens

        indice = self._contador.proxima()
        fase = self._contador.fase
        modelo = str(kwargs.get("model", "?"))
        inicio = time.perf_counter()
        try:
            resposta = await self._real.acompletion(**kwargs)
        except Exception as erro:
            self._contador.registrar(
                Chamada(
                    indice=indice,
                    fase=fase,
                    modelo=modelo,
                    duracao_s=time.perf_counter() - inicio,
                    tokens_entrada=None,
                    tokens_saida=None,
                    erro=f"{type(erro).__name__}: {erro}",
                )
            )
            raise

        uso = getattr(resposta, "usage", None)
        self._contador.registrar(
            Chamada(
                indice=indice,
                fase=fase,
                modelo=modelo,
                duracao_s=time.perf_counter() - inicio,
                tokens_entrada=getattr(uso, "prompt_tokens", None),
                tokens_saida=getattr(uso, "completion_tokens", None),
            )
        )
        return resposta


class ServicoNVIDIAContado:
    """Delega tudo ao servico LiteLLM do Parlant; so instrumenta o gerador."""

    def __init__(self, interno: Any, contador: ContadorDeChamadas) -> None:
        self._interno = interno
        self._contador = contador

    @property
    def supports_streaming(self) -> bool:
        return bool(getattr(self._interno, "supports_streaming", False))

    async def get_schematic_generator(self, t: Any, hints: Any = {}) -> Any:
        gerador = await self._interno.get_schematic_generator(t, hints)
        real = getattr(gerador, "_client", None)
        if real is not None and not isinstance(real, ShimLiteLLM):
            gerador._client = ShimLiteLLM(real, self._contador)
        return gerador

    async def get_streaming_text_generator(self, hints: Any = {}) -> Any:
        return await self._interno.get_streaming_text_generator(hints)

    async def get_embedder(self, hints: Any = {}) -> Any:
        # Embedder local (JinaAI/HuggingFace): nao passa pelo contador porque
        # nao gera trafego para a NVIDIA.
        return await self._interno.get_embedder(hints)

    async def get_moderation_service(self) -> Any:
        return await self._interno.get_moderation_service()


def servico_nvidia(container: Any) -> Any:
    """Factory para `p.Server(nlp_service=...)`."""
    import parlant.sdk as p

    return ServicoNVIDIAContado(p.NLPServices.litellm(container), CONTADOR)
