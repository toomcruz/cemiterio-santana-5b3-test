"""Leitura (somente leitura) dos catalogos reais do dominio Santana.

Esta POC nao duplica nem reescreve as regras do repositorio: ela carrega os
artefatos versionados de `santana-conversation-domain/` e recorta o subconjunto
do assunto EXUMACAO. Nenhum arquivo do sistema atual e alterado.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

TOPIC_CODE = "EXUMACAO"
PRIMARY_GOAL = "GOAL_EXUMACAO"

_CATALOG_FILES = {
    "topics": "topics.v1.json",
    "goals": "goals.v1.json",
    "facts": "facts.v1.json",
    "relations": "relations.v1.json",
    "questions": "questions.v1.json",
}


def repo_root() -> Path:
    """Raiz do repositorio (permite override por variavel de ambiente)."""
    override = os.environ.get("SANTANA_REPO_ROOT")
    if override:
        return Path(override).resolve()
    # .../referencia/santana_referencia/dominio/catalog.py
    return Path(__file__).resolve().parents[3]


def domain_dir() -> Path:
    return repo_root() / "santana-conversation-domain"


@lru_cache(maxsize=1)
def _raw_catalogs() -> Mapping[str, Any]:
    base = domain_dir()
    missing = [name for name in _CATALOG_FILES.values() if not (base / name).exists()]
    if missing:
        raise FileNotFoundError(
            f"Catalogos do dominio Santana nao encontrados em {base}: {', '.join(missing)}"
        )
    return {
        key: json.loads((base / filename).read_text(encoding="utf-8"))
        for key, filename in _CATALOG_FILES.items()
    }


@dataclass(frozen=True)
class FactSpec:
    """Especificacao de um fato, tal como declarada em `facts.v1.json`."""

    code: str
    display_name: str
    value_type: str
    priority_class: str
    allowed_values: tuple[str, ...]
    allowed_sources: tuple[str, ...]
    ai_extractable: bool
    authoritative_only: bool
    derived: bool
    deterministic_rule: bool
    relevant_when: tuple[Mapping[str, Any], ...]
    depends_on: tuple[str, ...]
    resolution_action: str | None
    human_rule_note: str | None

    @property
    def is_enum(self) -> bool:
        return self.value_type == "ENUM"


def _fact_spec(raw: Mapping[str, Any]) -> FactSpec:
    return FactSpec(
        code=raw["fact_code"],
        display_name=raw.get("display_name", raw["fact_code"]),
        value_type=raw.get("value_type", "TEXT"),
        priority_class=raw.get("priority_class", "ADMINISTRATIVE"),
        allowed_values=tuple(raw.get("allowed_values", ())),
        allowed_sources=tuple(raw.get("allowed_sources", ())),
        ai_extractable=bool(raw.get("ai_extractable", False)),
        authoritative_only=bool(raw.get("authoritative_only", False)),
        derived=bool(raw.get("derived", False)),
        deterministic_rule=bool(raw.get("deterministic_rule", False)),
        relevant_when=tuple(raw.get("relevant_when", ())),
        depends_on=tuple(raw.get("depends_on", ())),
        resolution_action=raw.get("resolution_action"),
        human_rule_note=raw.get("human_rule_note"),
    )


# Fatos que a POC exercita no assunto EXUMACAO. Os exigidos pelo goal real
# (`goals.v1.json`) mais os fatos de ramificacao de destino usados pelas
# decisoes humanas 1 e 2.
POC_FACT_CODES: tuple[str, ...] = (
    "exhumation_purpose",
    "remains_status",
    "burial_reference",
    "surviving_spouse_status",
    "required_authorization_signatory",
    "exhumation_authorization",
    "transport_destination",
    "destination_grave_reference",
    "destination_grave_situation",
    "destination_grave_authorization",
    "requester_document",
)


# Escopo adicional, usado APENAS pelas fixtures dos vetores. Vazio em runtime, e
# ha teste que exige que continue vazio por padrao. Existe porque
# `POC_FACT_CODES` e escopo de assunto: dos 26 fatos declarados no dominio, 15
# pertencem a recadastro, comercial e reclamacao, e deixa-los entrar num caso de
# EXUMACAO seria pior do que a inconveniencia que este seam resolve.
_ESCOPO_DE_FIXTURE: tuple[str, ...] = ()


def definir_escopo_de_fixture(codigos: tuple[str, ...]) -> None:
    """Acrescenta fatos ao escopo. So os vetores chamam isto."""
    global _ESCOPO_DE_FIXTURE
    if codigos == _ESCOPO_DE_FIXTURE:
        return
    _ESCOPO_DE_FIXTURE = codigos
    fact_specs.cache_clear()


def escopo_de_fatos() -> tuple[str, ...]:
    return POC_FACT_CODES + _ESCOPO_DE_FIXTURE


@lru_cache(maxsize=1)
def fact_specs() -> Mapping[str, FactSpec]:
    facts = {f["fact_code"]: f for f in _raw_catalogs()["facts"]["facts"]}
    escopo = escopo_de_fatos()
    missing = [code for code in escopo if code not in facts]
    if missing:
        raise KeyError(f"Fatos ausentes em facts.v1.json: {missing}")
    return {code: _fact_spec(facts[code]) for code in escopo}


@lru_cache(maxsize=1)
def ai_boundary() -> Mapping[str, Sequence[str]]:
    """Fronteira IA x regra, exatamente como declarada no repositorio."""
    boundary = _raw_catalogs()["facts"]["ai_boundary"]
    return {
        "ai_may": tuple(boundary["ai_may"]),
        "ai_may_not": tuple(boundary["ai_may_not"]),
    }


@lru_cache(maxsize=1)
def goal_spec() -> Mapping[str, Any]:
    for goal in _raw_catalogs()["goals"]["goals"]:
        if goal["goal_code"] == PRIMARY_GOAL:
            return goal
    raise KeyError(f"{PRIMARY_GOAL} nao encontrado em goals.v1.json")


@lru_cache(maxsize=1)
def priority_rank() -> Mapping[str, int]:
    return {
        entry["priority_class"]: int(entry["rank"])
        for entry in _raw_catalogs()["questions"]["priority_order"]
    }


@lru_cache(maxsize=1)
def questions_by_fact() -> Mapping[str, str]:
    return {
        q["fact_code"]: q["text"]
        for q in _raw_catalogs()["questions"]["questions"]
        if "fact_code" in q
    }


@lru_cache(maxsize=1)
def exhumation_relations() -> Sequence[Mapping[str, Any]]:
    """Relacoes relevantes para EXUMACAO / destino do transporte."""
    wanted = {
        "REL_EXUMACAO_SIGNATORY_SPOUSE_ALIVE",
        "REL_EXUMACAO_SIGNATORY_NO_SPOUSE",
        "REL_TRANSPORTE_REQUIRES_EXUMACAO",
        "REL_TRANSPORTE_ALREADY_EXHUMED",
        "REL_TRANSPORTE_JAZIGO_FAMILIA_CHECK",
    }
    return tuple(
        r for r in _raw_catalogs()["relations"]["relations"] if r["relation_code"] in wanted
    )


@lru_cache(maxsize=1)
def topic_spec() -> Mapping[str, Any]:
    for topic in _raw_catalogs()["topics"]["topics"]:
        if topic["topic_code"] == TOPIC_CODE:
            return topic
    raise KeyError(f"{TOPIC_CODE} nao encontrado em topics.v1.json")


def limpar_caches() -> None:
    """Zera todos os caches deste modulo.

    Existe para os vetores: eles trocam o diretorio de dominio entre casos, e
    caches sem chave devolveriam o catalogo do caso anterior. Fora dos vetores
    ninguem chama isto — em runtime o dominio nao muda no meio da execucao.
    """
    for funcao in (
        _raw_catalogs,
        fact_specs,
        ai_boundary,
        goal_spec,
        priority_rank,
        questions_by_fact,
        exhumation_relations,
        topic_spec,
    ):
        funcao.cache_clear()
