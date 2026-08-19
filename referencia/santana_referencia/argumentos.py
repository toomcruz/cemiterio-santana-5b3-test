"""Contrato canonico de argumentos de tool (R1) e leitor de eventos.

Por que este modulo existe
--------------------------
A C1 registrou `arguments = null` para uma tool de zero argumentos e o gate
aceitou `null` e `{}` como equivalentes. A causa nao era o modelo nem o Parlant:
era o leitor de eventos da POC, em `turnos.py`:

    "argumentos": chamada.get("arguments") or chamada.get("args"),

`{}` e falsy em Python. Com `arguments == {}` o `or` cai para `args`, que nao
existe no evento, e o resultado vira `None`. O `null` do relatorio e nosso.

Tres fatos do Parlant 3.3.2 sustentam que o valor no fio era `{}`:

* `ToolCall.arguments` e `Mapping[str, JSONSerializable]` — o tipo nao admite
  `None` (`core/sessions.py`);
* `validate_tool_arguments` levanta `ToolExecutionError` para qualquer chave
  extra numa tool com `parameters={}` (`core/tools.py`);
* a assinatura real das tools de consulta tem apenas `context`.

O contrato
----------
A forma canonica de uma tool de ZERO argumentos e `{}`.

A normalizacao de ausente/`None` para `{}` vale **somente** para tools cujo
contrato declara zero argumentos. Para tools com parametros, ausencia e tratada
pelo schema especifico e nenhum valor e criado em silencio: obrigatorio ausente
e recusa, nao default.

O que este modulo NAO faz: limpar um argumento indevido e seguir. Argumento fora
do contrato e falha fechada — e o vetor de risco real e um modelo injetando
`modalidade_tarifaria` numa consulta de preco.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

# Marcador que o ToolCaller emite quando nao conseguiu extrair um argumento.
# Nunca pode chegar ao Gateway como se fosse valor.
MARCADOR_MISSING = "__missing__"

# Codigo unico de recusa, exposto ao Gateway. Os motivos detalhados ficam em
# `motivos` — sao diagnostico, nao contrato de status.
ARGUMENTOS_NAO_CANONICOS = "ARGUMENTOS_NAO_CANONICOS"

# Motivos de diagnostico.
TIPO_INVALIDO = "TIPO_INVALIDO"
CHAVE_EXTRA = "CHAVE_EXTRA"
OBRIGATORIO_AUSENTE = "OBRIGATORIO_AUSENTE"
VALOR_NULO = "VALOR_NULO"
VALOR_MISSING = "VALOR_MISSING"


@dataclass(frozen=True)
class ContratoDeTool:
    """O que a tool declara aceitar. `parametros` vazio = tool de zero argumentos."""

    nome: str
    parametros: tuple[str, ...] = ()
    obrigatorios: tuple[str, ...] = ()

    @property
    def zero_argumentos(self) -> bool:
        return not self.parametros


@dataclass(frozen=True)
class ArgumentosCanonizados:
    """Resultado da canonizacao.

    `bruto` e preservado sempre, inclusive quando a canonizacao falha: a
    auditoria precisa do que chegou, nao do que deveria ter chegado.
    """

    contrato: str
    bruto: Any
    canonico: Mapping[str, Any] | None = None
    codigo: str | None = None
    motivos: tuple[str, ...] = field(default_factory=tuple)

    @property
    def aceito(self) -> bool:
        return self.codigo is None

    def as_dict(self) -> dict[str, Any]:
        dados: dict[str, Any] = {
            "contrato": self.contrato,
            "aceito": self.aceito,
            # Preservado literalmente, sem normalizacao. Se o evento trouxe
            # `null`, aqui aparece `null`.
            "bruto": self.bruto,
        }
        if self.canonico is not None:
            dados["canonico"] = dict(self.canonico)
        if self.codigo is not None:
            dados["codigo"] = self.codigo
        if self.motivos:
            dados["motivos"] = list(self.motivos)
        return dados


def ler_argumentos_do_evento(chamada: Mapping[str, Any]) -> Any:
    """Le os argumentos de um evento de tool call sem depender de veracidade.

    Substitui o `or` falsy da POC. `{}` presente e `{}`, e nao vira `None`.
    Ausencia continua sendo ausencia — quem decide o que fazer com ela e a
    canonizacao, que conhece o contrato da tool.
    """
    for chave in ("arguments", "args"):
        if chave in chamada:
            return chamada[chave]
    return None


def canonizar(contrato: ContratoDeTool, bruto: Any) -> ArgumentosCanonizados:
    """Aplica o contrato canonico. Falha fechada, nunca corrige em silencio."""
    motivos: list[str] = []

    def recusar() -> ArgumentosCanonizados:
        return ArgumentosCanonizados(
            contrato=contrato.nome,
            bruto=bruto,
            codigo=ARGUMENTOS_NAO_CANONICOS,
            motivos=tuple(sorted(set(motivos))),
        )

    if bruto is None:
        if contrato.zero_argumentos:
            # Unica normalizacao permitida: ausencia numa tool que declara zero
            # argumentos e, por construcao, `{}`.
            return ArgumentosCanonizados(contrato=contrato.nome, bruto=bruto, canonico={})
        if contrato.obrigatorios:
            motivos.extend(f"{OBRIGATORIO_AUSENTE}:{p}" for p in sorted(contrato.obrigatorios))
            return recusar()
        # Tool com parametros, todos opcionais, nenhum informado. `{}` aqui nao
        # cria valor nenhum — apenas registra que nada foi passado.
        return ArgumentosCanonizados(contrato=contrato.nome, bruto=bruto, canonico={})

    if not isinstance(bruto, Mapping):
        motivos.append(f"{TIPO_INVALIDO}:{type(bruto).__name__}")
        return recusar()

    for chave in sorted(bruto):
        if chave not in contrato.parametros:
            motivos.append(f"{CHAVE_EXTRA}:{chave}")
            continue
        valor = bruto[chave]
        if valor is None:
            motivos.append(f"{VALOR_NULO}:{chave}")
        elif isinstance(valor, str) and MARCADOR_MISSING in valor:
            motivos.append(f"{VALOR_MISSING}:{chave}")

    for parametro in sorted(contrato.obrigatorios):
        if parametro not in bruto:
            motivos.append(f"{OBRIGATORIO_AUSENTE}:{parametro}")

    if motivos:
        return recusar()

    return ArgumentosCanonizados(
        contrato=contrato.nome,
        bruto=bruto,
        canonico={chave: bruto[chave] for chave in sorted(bruto)},
    )
