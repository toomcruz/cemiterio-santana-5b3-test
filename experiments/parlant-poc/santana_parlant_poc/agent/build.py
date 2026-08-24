"""Constroi o agente Parlant a partir de `spec.py`.

Aqui se usam, na pratica, os recursos que a POC quer avaliar:
Guidelines, Relationships, Journeys, Tools, Canned Responses e Glossary.
Cada guideline e cada estado da journey recebe um `on_match` que grava o rastro
exibido na pagina de laboratorio.
"""

from __future__ import annotations

from typing import Any, Mapping

import parlant.sdk as p

from ..store import STORE
from . import spec
from .tools import ALL_TOOLS

_CRITICALITY = {
    "LOW": p.Criticality.LOW,
    "MEDIUM": p.Criticality.MEDIUM,
    "HIGH": p.Criticality.HIGH,
}

_TOOLS_BY_NAME = {t.tool.name: t for t in ALL_TOOLS}


def _sessao_corrente(ctx: Any) -> str:
    """Id da sessao do turno.

    O `EngineContext` desta versao do Parlant nao expoe a sessao (so
    `add_tool_event` e `correlator`), entao o rastro sai de `Session.current`,
    que le o contexto da task. Sem isso o painel do laboratorio mostrava
    guidelines/journey sempre vazios — inclusive no modo Gemini.
    """
    sessao = getattr(getattr(ctx, "session", None), "id", None)
    if sessao:
        return str(sessao)
    try:
        return str(p.Session.current.id)
    except Exception:
        return "desconhecida"


def _guideline_tracker(key: str):
    async def on_match(ctx: Any, match: Any) -> None:
        STORE.record_guideline(_sessao_corrente(ctx), key)

    return on_match


def _journey_state_tracker(key: str):
    async def on_match(ctx: Any, match: Any) -> None:
        STORE.record_journey_state(_sessao_corrente(ctx), key)

    return on_match


async def build_agent(server: p.Server) -> tuple[p.Agent, Mapping[str, Any]]:
    """Cria o agente completo e devolve o mapa de objetos criados."""
    agent = await server.create_agent(
        name=spec.AGENT_NAME,
        description=spec.AGENT_DESCRIPTION,
        composition_mode=p.CompositionMode.FLUID,
    )

    # --------------------------------------------------------------- Glossary
    terms = {}
    for term in spec.GLOSSARY:
        terms[term["name"]] = await agent.create_term(
            name=term["name"],
            description=term["description"],
            synonyms=term.get("synonyms", []),
        )

    # -------------------------------------------------------- Canned Responses
    canned: dict[str, Any] = {}
    for canrep in spec.CANNED_RESPONSES:
        canned[canrep["key"]] = await agent.create_canned_response(
            template=canrep["template"],
            signals=canrep.get("signals", []),
            metadata={"poc_key": canrep["key"]},
        )

    # ------------------------------------------------------ Guidelines + Tools
    guidelines: dict[str, Any] = {}
    for definition in spec.GUIDELINES:
        key = definition["key"]
        guidelines[key] = await agent.create_guideline(
            condition=definition["condition"],
            action=definition.get("action"),
            tools=[_TOOLS_BY_NAME[name] for name in definition.get("tools", [])],
            canned_responses=[canned[k] for k in definition.get("canned_responses", [])],
            criticality=_CRITICALITY[definition.get("criticality", "MEDIUM")],
            metadata={"poc_key": key},
            on_match=_guideline_tracker(key),
        )

    # ------------------------------------------------------------ Relationships
    relationships: list[Any] = []
    for rel in spec.RELATIONSHIPS:
        source = guidelines[rel["source"]]
        targets = [guidelines[t] for t in rel["targets"]]
        if rel["kind"] == "prioritize_over":
            relationships.append(await source.prioritize_over(*targets))
        elif rel["kind"] == "entail":
            for target in targets:
                relationships.append(await source.entail(target))
        elif rel["kind"] == "depend_on":
            relationships.append(await source.depend_on(*targets))
        else:  # pragma: no cover - guarda contra spec invalida
            raise ValueError(f"Relacionamento desconhecido: {rel['kind']}")

    # ------------------------------------------------------------------ Journey
    journey = await agent.create_journey(
        title=spec.JOURNEY["title"],
        description=spec.JOURNEY["description"],
        conditions=list(spec.JOURNEY["conditions"]),
    )

    states = {key: value for key, value in _build_journey_states(spec.JOURNEY).items()}
    state_objects = await _apply_journey_states(journey, states)

    return agent, {
        "terms": terms,
        "canned_responses": canned,
        "guidelines": guidelines,
        "relationships": relationships,
        "journey": journey,
        "journey_states": state_objects,
    }



async def build_c1_price_agent(server: p.Server) -> tuple[p.Agent, Mapping[str, Any]]:
    """Agente mínimo para a validação real C1 de preço.

    A chave do laboratório possui limite real de 5 requisições por minuto.
    Portanto C1 cria somente as duas entidades indispensáveis: o agente e a
    guideline de preço. Canned responses, relações, jornada e demais regras
    continuam cobertos por testes offline; incluí-los neste probe consumia a
    cota antes do primeiro turno.
    """

    agent = await server.create_agent(
        name="Atendente Santana (POC C1 Preço)",
        description=(
            "Você atende exclusivamente perguntas sobre preço de exumação. "
            "Nunca invente ou estime valores e siga as regras do Cemitério Santana."
        ),
        composition_mode=p.CompositionMode.FLUID,
    )

    definition = next(item for item in spec.GUIDELINES if item["key"] == "G_PRECO")
    guideline = await agent.create_guideline(
        condition=definition["condition"],
        action=definition["action"],
        tools=[_TOOLS_BY_NAME[name] for name in definition["tools"]],
        criticality=_CRITICALITY[definition["criticality"]],
        metadata={"poc_key": "G_PRECO"},
        on_match=_guideline_tracker("G_PRECO"),
    )

    return agent, {
        "terms": {},
        "canned_responses": {},
        "guidelines": {"G_PRECO": guideline},
        "relationships": [],
        "journey": None,
        "journey_states": {},
    }

def _build_journey_states(journey_spec: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {state["key"]: state for state in journey_spec["states"]}


async def _apply_journey_states(
    journey: Any, states: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    """Monta o fluxo: estado -> pergunta -> registro -> volta ao estado -> fechamento."""
    created: dict[str, Any] = {}

    s_estado = await journey.initial_state.transition_to(
        tool_state=_TOOLS_BY_NAME[states["S_ESTADO"]["tool"]],
        tool_instruction=states["S_ESTADO"]["instruction"],
        on_match=_journey_state_tracker("S_ESTADO"),
    )
    created["S_ESTADO"] = s_estado.target

    s_acolhimento = await s_estado.target.transition_to(
        chat_state=states["S_ACOLHIMENTO"]["instruction"],
        on_match=_journey_state_tracker("S_ACOLHIMENTO"),
    )
    created["S_ACOLHIMENTO"] = s_acolhimento.target

    # S_REGISTRO deixou de ser um tool_state: nao existe mais "a" tool de
    # registro, e sim uma por fato. Quem seleciona a tool certa e a guideline
    # (G_COLETA/G_MULTI_FATO/G_CORRECAO), que carrega todas elas.
    s_registro = await s_acolhimento.target.transition_to(
        chat_state=states["S_REGISTRO"]["instruction"],
        on_match=_journey_state_tracker("S_REGISTRO"),
    )
    created["S_REGISTRO"] = s_registro.target

    s_pergunta = await s_registro.target.transition_to(
        condition="ainda ha fatos faltando no caso",
        chat_state=states["S_PROXIMA_PERGUNTA"]["instruction"],
        on_match=_journey_state_tracker("S_PROXIMA_PERGUNTA"),
    )
    created["S_PROXIMA_PERGUNTA"] = s_pergunta.target

    # Volta ao estado deterministico apos cada resposta do municipe (laco).
    await s_pergunta.target.transition_to(
        condition="o municipe respondeu e ainda faltam fatos",
        state=created["S_ESTADO"],
    )

    s_fechamento = await s_registro.target.transition_to(
        condition=states["S_FECHAMENTO"]["condition"],
        chat_state=states["S_FECHAMENTO"]["instruction"],
        on_match=_journey_state_tracker("S_FECHAMENTO"),
    )
    created["S_FECHAMENTO"] = s_fechamento.target

    return created
