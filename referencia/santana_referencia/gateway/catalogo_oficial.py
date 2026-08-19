"""Carga do catalogo oficial estruturado e calculo do release_id.

O `release_id` e derivado do conteudo: catalogo oficial + catalogos de dominio.
Duas consequencias praticas — duas configuracoes diferentes nunca compartilham
cache de avaliacao, e todo log fica correlacionavel a uma versao exata do
conhecimento.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

from ..dominio import catalog

SCHEMA_SUPORTADO = "1.0"

# Codigos estruturados de falha de carga. Existem porque mensagem de excecao nao
# e portavel: o vetor V7 e a checagem de schema precisam comparar a MESMA coisa
# nas duas implementacoes, e uma frase em portugues nao atravessa a fronteira
# Python/TypeScript. A frase continua, como texto de diagnostico; o que o vetor
# compara e o codigo.
CATALOGO_NAO_ENCONTRADO = "CATALOGO_NAO_ENCONTRADO"
SCHEMA_NAO_SUPORTADO = "SCHEMA_NAO_SUPORTADO"
FONTE_INEXISTENTE = "FONTE_INEXISTENTE"
TIPO_DE_INFORMACAO_NAO_DECLARADO = "TIPO_DE_INFORMACAO_NAO_DECLARADO"


class ErroDeCatalogo(Exception):
    """Falha de carga com codigo estruturado.

    `codigo` e o que os vetores comparam; `mensagem` e diagnostico humano e pode
    mudar sem quebrar vetor nenhum.
    """

    def __init__(self, codigo: str, mensagem: str, **detalhe: Any) -> None:
        super().__init__(f"{codigo}: {mensagem}")
        self.codigo = codigo
        self.mensagem = mensagem
        self.detalhe = detalhe


def catalogo_path() -> Path:
    """Caminho do catalogo oficial.

    Ele **nao** vive dentro de `referencia/`. A implementacao Python e apenas
    implementacao de referencia para conformidade; ela nao pode ser dona da
    fonte autoritativa. O catalogo fica num caminho neutro, `santana-authority/`,
    ao lado de `santana-conversation-domain/`, para que o Gateway TS/Deno leia
    exatamente o mesmo arquivo quando existir. Uma unica copia operacional.
    """
    override = os.environ.get("SANTANA_CATALOGO_OFICIAL")
    if override:
        return Path(override).resolve()
    return catalog.repo_root() / "santana-authority" / "catalogo" / "exumacao.v1.json"


@dataclass(frozen=True)
class Fonte:
    source_id: str
    tipo: str
    referencia: str
    aprovada: bool
    nota: str | None = None


@dataclass(frozen=True)
class TipoDeInformacao:
    codigo: str
    forma_do_valor: str
    campos_de_aplicabilidade: tuple[str, ...]
    exige_fonte_oficial: bool
    nota: str | None = None


@dataclass(frozen=True)
class Entrada:
    entry_id: str
    tipo_informacao: str
    aplicabilidade: Mapping[str, str]
    valor: Mapping[str, Any]
    source_id: str
    vigencia_inicio: str | None
    vigencia_fim: str | None

    def vigente_em(self, referencia: date) -> bool:
        if self.vigencia_inicio and date.fromisoformat(self.vigencia_inicio) > referencia:
            return False
        if self.vigencia_fim and date.fromisoformat(self.vigencia_fim) < referencia:
            return False
        return True

    def especificidade(self) -> int:
        return len(self.aplicabilidade)


@dataclass(frozen=True)
class CatalogoOficial:
    release_id: str
    topic: str
    fontes: Mapping[str, Fonte]
    tipos: Mapping[str, TipoDeInformacao]
    entradas: tuple[Entrada, ...]

    def entradas_do_tipo(self, tipo: str) -> tuple[Entrada, ...]:
        return tuple(e for e in self.entradas if e.tipo_informacao == tipo)


def _release_id(bruto: bytes) -> str:
    """Hash do conteudo oficial + dos catalogos de dominio que ele referencia."""
    digest = hashlib.sha256()
    digest.update(bruto)
    base = catalog.domain_dir()
    for nome in sorted(("topics.v1.json", "goals.v1.json", "facts.v1.json",
                        "relations.v1.json", "questions.v1.json")):
        arquivo = base / nome
        if arquivo.exists():
            digest.update(arquivo.read_bytes())
    return f"exu-{SCHEMA_SUPORTADO}-{digest.hexdigest()[:12]}"


def carregar() -> CatalogoOficial:
    """Carrega o catalogo apontado por `catalogo_path()`.

    O cache e por caminho, nao global: os vetores V3, V4, V7 e V8 rodam contra
    catalogos-fixture, e um cache sem chave devolveria o catalogo oficial para
    todos eles depois da primeira carga.
    """
    return _carregar(catalogo_path())


@lru_cache(maxsize=16)
def _carregar(caminho: Path) -> CatalogoOficial:
    if not caminho.exists():
        raise ErroDeCatalogo(
            CATALOGO_NAO_ENCONTRADO, f"Catalogo oficial nao encontrado: {caminho}"
        )
    bruto = caminho.read_bytes()
    dados = json.loads(bruto.decode("utf-8"))

    versao = dados.get("schema_version")
    if versao != SCHEMA_SUPORTADO:
        raise ErroDeCatalogo(
            SCHEMA_NAO_SUPORTADO,
            f"Catalogo oficial em schema {versao!r}; este runtime suporta {SCHEMA_SUPORTADO!r}. "
            "Falha fechada: um catalogo de schema desconhecido nao pode ser interpretado.",
            encontrado=versao,
            suportado=SCHEMA_SUPORTADO,
        )

    fontes = {
        f["source_id"]: Fonte(
            source_id=f["source_id"],
            tipo=f["tipo"],
            referencia=f["referencia"],
            aprovada=bool(f.get("aprovada", False)),
            nota=f.get("nota"),
        )
        for f in dados.get("fontes", ())
    }

    tipos = {
        codigo: TipoDeInformacao(
            codigo=codigo,
            forma_do_valor=spec["forma_do_valor"],
            campos_de_aplicabilidade=tuple(spec.get("campos_de_aplicabilidade", ())),
            exige_fonte_oficial=bool(spec.get("exige_fonte_oficial", True)),
            nota=spec.get("nota"),
        )
        for codigo, spec in dados.get("tipos_de_informacao", {}).items()
    }

    entradas: list[Entrada] = []
    for bruta in dados.get("entradas", ()):
        source_id = bruta["source_id"]
        if source_id not in fontes:
            raise ErroDeCatalogo(
                FONTE_INEXISTENTE,
                f"Entrada {bruta['entry_id']} aponta para fonte inexistente {source_id!r}.",
                entry_id=bruta["entry_id"],
                source_id=source_id,
            )
        if not fontes[source_id].aprovada:
            # Falha fechada: fonte nao aprovada nao entra em runtime.
            continue
        if bruta["tipo_informacao"] not in tipos:
            raise ErroDeCatalogo(
                TIPO_DE_INFORMACAO_NAO_DECLARADO,
                f"Entrada {bruta['entry_id']} usa tipo de informacao nao declarado "
                f"{bruta['tipo_informacao']!r}.",
                entry_id=bruta["entry_id"],
                tipo_informacao=bruta["tipo_informacao"],
            )
        vigencia = bruta.get("vigencia") or {}
        entradas.append(
            Entrada(
                entry_id=bruta["entry_id"],
                tipo_informacao=bruta["tipo_informacao"],
                aplicabilidade=dict(bruta.get("aplicabilidade") or {}),
                valor=dict(bruta["valor"]),
                source_id=source_id,
                vigencia_inicio=vigencia.get("inicio"),
                vigencia_fim=vigencia.get("fim"),
            )
        )

    return CatalogoOficial(
        release_id=_release_id(bruto),
        topic=dados.get("topic", catalog.TOPIC_CODE),
        fontes=fontes,
        tipos=tipos,
        entradas=tuple(entradas),
    )


def tipos_de_informacao() -> Sequence[str]:
    return tuple(sorted(carregar().tipos))


def release_id() -> str:
    return carregar().release_id
