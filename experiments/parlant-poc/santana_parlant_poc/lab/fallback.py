"""Modo offline do laboratorio: conversa deterministica, sem LLM.

Existe por dois motivos:

1. a pagina de teste precisa abrir e funcionar mesmo sem `GEMINI_API_KEY`;
2. os testes automatizados precisam rodar sem rede e sem gastar chave.

Este modo NAO e o Parlant. Ele reutiliza o lexico deterministico real do
repositorio (`santana-conversation-domain/runtime/interpreter/lexicon.v1.json`)
para reconhecer intencao e fatos por palavra-chave, e a mesma autoridade
deterministica usada pelas tools do Parlant. Toda resposta produzida aqui vem
marcada com `fallback` no rastro.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Iterable, Mapping, Sequence

from ..agent import spec
from ..domain import authority, catalog, knowledge
from ..store import LabStore, STORE

FALLBACK_REASON = "modo offline deterministico (sem LLM): GEMINI_API_KEY ausente ou Gemini indisponivel"

_INJECTION_PATTERNS = (
    "ignore as instrucoes",
    "ignora as instrucoes",
    "ignore tudo",
    "esqueca as regras",
    "esquece as regras",
    "voce agora e",
    "aja como",
    "finja que",
    "modo desenvolvedor",
    "system prompt",
    "prompt do sistema",
    "suas instrucoes",
    "revele as regras",
    "sem restricoes",
    "pode inventar",
    "chuta um valor",
    "chute um valor",
    "da um valor por alto",
)

_PRICE_PATTERNS = ("preco", "precos", "valor", "valores", "custo", "custa", "quanto fica", "taxa", "quanto sai")
_DOC_PATTERNS = ("documento", "documentos", "documentacao", "papelada", "certidao", "o que preciso levar")
_DEADLINE_PATTERNS = ("prazo", "demora", "quanto tempo", "quando fica pronto", "leva quantos dias")
_RULE_PATTERNS = ("quem assina", "quem autoriza", "quem pode autorizar", "assinatura", "procedimento", "como funciona a regra")

_EXHUMATION_INTENT = (
    "exumacao", "exumar", "tirar os restos", "tirar os ossos", "retirar os restos",
    "tirar do tumulo", "abrir a sepultura", "desenterrar", "tirar o corpo",
    "levar os restos", "translado", "transferir o corpo",
)

_PURPOSE_PATTERNS: Mapping[str, Sequence[str]] = {
    "TRANSPORTE": ("outro cemiterio", "transportar", "translado", "levar para", "transferir o corpo", "mudar de cemiterio", "jazigo da familia"),
    "OSSUARIO": ("ossuario", "ossario"),
    "CREMACAO": ("cremar", "crematorio", "cremacao"),
}

# Palavras que aparecem depois do parentesco mas nao sao nome proprio.
_NAO_E_NOME = frozenset(
    """esta estava foi ja ainda nao e que no na do da de o a se quer quero queria
    precisa preciso enterrado enterrada sepultado sepultada falecido falecida morreu
    faleceu era tem teve continua mesmo tambem ta so""".split()
)

_DOCUMENT_PATTERN = re.compile(r"\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b|\b\d{7,12}\b")


def normalize(text: str) -> str:
    lowered = (text or "").lower()
    stripped = "".join(
        c for c in unicodedata.normalize("NFD", lowered) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", stripped)).strip()


@lru_cache(maxsize=1)
def lexicon() -> Mapping[str, Any]:
    path = catalog.domain_dir() / "runtime" / "interpreter" / "lexicon.v1.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _matches(haystack: str, needles: Iterable[str]) -> bool:
    return any(normalize(n) in haystack for n in needles)


@dataclass
class Reply:
    text: str
    guidelines: list[str]
    tool_calls: list[dict[str, Any]]
    journey_state: str
    fallback: str = FALLBACK_REASON
    error: str | None = None


class DeterministicLab:
    """Conversa offline: interpreta por lexico e responde pela autoridade."""

    def __init__(self, store: LabStore | None = None) -> None:
        self._store = store or STORE

    # ---------------------------------------------------------------- publico
    def respond(self, session_id: str, message: str) -> Reply:
        case = self._store.case(session_id)
        text = normalize(message)
        guidelines: list[str] = []
        tools: list[dict[str, Any]] = []
        parts: list[str] = []

        # 1. Guarda de prompt injection tem prioridade sobre tudo.
        if _matches(text, _INJECTION_PATTERNS):
            guidelines.append("G_INJECAO")
            parts.append(spec.canned_response("INSTRUCAO_RECUSADA")["template"])
            return self._finish(session_id, case, parts, guidelines, tools, "S_PROXIMA_PERGUNTA")

        # 2. Perguntas de autoridade: preco, documentos, prazo, regra.
        restricted = self._restricted_topic(text)
        if restricted:
            guideline_key, topic, canned_key = restricted
            guidelines.append(guideline_key)
            answer = knowledge.lookup(topic)
            tools.append(
                {
                    "tool": "consultar_base_autoritativa",
                    "arguments": {"assunto": topic},
                    "result": answer.as_dict(),
                }
            )
            parts.append(
                spec.canned_response(canned_key)["template"] if canned_key else answer.text
            )

        # 3. Assunto fora de exumacao.
        off_topic = self._off_topic(text)
        if off_topic:
            guidelines.append("G_FORA_DE_ESCOPO")
            case.note_off_topic(off_topic)
            tools.append(
                {
                    "tool": "registrar_assunto_fora_de_escopo",
                    "arguments": {"descricao": off_topic},
                    "result": {"registrado": True},
                }
            )
            parts.append(spec.canned_response("FORA_DE_ESCOPO")["template"])

        # 4. Correcao explicita.
        is_correction = _matches(text, lexicon()["correction_markers"]) or _matches(
            text, lexicon()["change_of_mind_markers"]
        )
        if is_correction:
            guidelines.append("G_CORRECAO")

        # 5. Extracao de fatos pelo lexico real + heuristicas locais.
        extracted = self._extract_facts(text, message, case)
        if len(extracted) > 1:
            guidelines.append("G_MULTI_FATO")

        accepted: list[str] = []
        claims: list[str] = []
        repeated: list[str] = []
        for fact_code, value in extracted:
            if case.confirmed_value(fact_code) == value and not is_correction:
                repeated.append(fact_code)
                continue
            source = "USER_CORRECTION" if is_correction else "USER_EXPLICIT"
            submission = case.submit_fact(fact_code, value, source=source)
            tool_name = "corrigir_fato" if is_correction else "registrar_fato"
            tools.append(
                {
                    "tool": tool_name,
                    "arguments": {"fato": fact_code, "valor": value},
                    "result": submission.as_dict(),
                }
            )
            if submission.outcome == authority.ACCEPTED:
                accepted.append(fact_code)
            elif submission.outcome == authority.RECORDED_AS_CLAIM:
                claims.append(fact_code)

        if accepted and not is_correction:
            guidelines.append("G_COLETA")
        if repeated:
            guidelines.append("G_REPETICAO")
            parts.append("Isso ja esta anotado aqui comigo, pode ficar tranquilo.")

        # 6. Ambiguidade bloqueante do lexico real.
        ambiguity = self._ambiguity(text, extracted)
        if ambiguity:
            guidelines.append("G_AMBIGUO")
            parts.append(
                "So pra eu nao errar: "
                + ambiguity["description"].lower().rstrip(".")
                + ". Voce pode me dizer qual e o caso?"
            )

        if accepted:
            names = ", ".join(
                catalog.fact_specs()[code].display_name.lower() for code in accepted
            )
            verb = "Corrigi" if is_correction else "Anotei"
            parts.append(f"{verb} aqui: {names}.")

        if claims:
            guidelines.append("G_PENDENCIA_ADMIN")
            parts.append(spec.canned_response("AGUARDANDO_ADMINISTRACAO")["template"])

        if not parts and not extracted and _matches(text, _EXHUMATION_INTENT):
            guidelines.append("G_COLETA")
            parts.append("Entendi, voce quer tratar de uma exumacao. Vou te ajudar com isso.")

        # 7. Proxima melhor pergunta vem sempre da autoridade.
        snapshot = case.snapshot()
        tools.append(
            {"tool": "consultar_estado_do_caso", "arguments": {}, "result": snapshot}
        )
        journey_state = "S_ESTADO"
        if snapshot["next_question"] and not ambiguity:
            guidelines.append("G_PROXIMA_PERGUNTA")
            journey_state = "S_PROXIMA_PERGUNTA"
            parts.append(self._phrase_question(snapshot["next_question"]))
        elif not snapshot["missing_facts"]:
            journey_state = "S_FECHAMENTO"
            parts.append(self._closing(snapshot))

        if not parts:
            parts.append(
                "Nao consegui entender direito. Voce pode me contar com outras palavras o que "
                "precisa sobre a exumacao?"
            )

        return self._finish(session_id, case, parts, guidelines, tools, journey_state)

    # ---------------------------------------------------------------- privado
    def _finish(
        self,
        session_id: str,
        case: authority.ExhumationCase,
        parts: Sequence[str],
        guidelines: Sequence[str],
        tools: Sequence[dict[str, Any]],
        journey_state: str,
    ) -> Reply:
        trace = self._store.start_turn(session_id)
        for key in guidelines:
            trace.guidelines.append(key)
        trace.journey_states.append(journey_state)
        trace.tool_calls.extend(tools)
        trace.fallback = FALLBACK_REASON
        return Reply(
            text=" ".join(dict.fromkeys(p.strip() for p in parts if p.strip())),
            guidelines=list(dict.fromkeys(guidelines)),
            tool_calls=list(tools),
            journey_state=journey_state,
        )

    @staticmethod
    def _restricted_topic(text: str) -> tuple[str, str, str | None] | None:
        if _matches(text, _PRICE_PATTERNS):
            return ("G_PRECO", "PRECO", "SEM_PRECO")
        if _matches(text, _DOC_PATTERNS):
            return ("G_DOCUMENTOS", "DOCUMENTOS", "SEM_DOCUMENTOS")
        if _matches(text, _DEADLINE_PATTERNS):
            return ("G_PRAZO", "PRAZO", "SEM_PRAZO")
        if _matches(text, _RULE_PATTERNS):
            return ("G_REGRA", "ASSINATURA_EXUMACAO", None)
        return None

    @staticmethod
    def _off_topic(text: str) -> str | None:
        for pattern in lexicon()["goal_patterns"]:
            if pattern["goal_code"] in ("GOAL_EXUMACAO", "GOAL_TRANSPORTE"):
                continue
            for phrase in pattern["any"]:
                if normalize(phrase) in text:
                    return f"{pattern['goal_code']}: {phrase}"
        return None

    def _extract_facts(
        self, text: str, raw: str, case: authority.ExhumationCase
    ) -> list[tuple[str, str]]:
        poc_facts = set(catalog.POC_FACT_CODES)
        found: dict[str, str] = {}

        for pattern in lexicon()["fact_patterns"]:
            code = pattern["fact_code"]
            if code not in poc_facts:
                continue
            if pattern.get("none") and _matches(text, pattern["none"]):
                continue
            if _matches(text, pattern["any"]):
                found.setdefault(code, pattern["value"])

        for claim in lexicon()["authoritative_claim_patterns"]:
            if claim["fact_code"] in poc_facts and _matches(text, claim["any"]):
                spec_ = catalog.fact_specs()[claim["fact_code"]]
                found.setdefault(claim["fact_code"], spec_.allowed_values[0])

        for value, patterns in _PURPOSE_PATTERNS.items():
            if _matches(text, patterns):
                found.setdefault("exhumation_purpose", value)
                break
        if "exhumation_purpose" not in found and _matches(text, _EXHUMATION_INTENT):
            if case.confirmed_value("exhumation_purpose") is None and _matches(
                text, ("outro cemiterio", "levar", "transportar")
            ):
                found["exhumation_purpose"] = "TRANSPORTE"

        burial = self._burial_reference(text)
        if burial and case.confirmed_value("burial_reference") is None:
            found.setdefault("burial_reference", burial)

        document = _DOCUMENT_PATTERN.search(raw)
        if document:
            found.setdefault("requester_document", document.group(0).strip())

        return list(found.items())

    @staticmethod
    def _burial_reference(text: str) -> str | None:
        match = re.search(
            r"\b(meu pai|minha mae|meu avo|minha avo|meu irmao|minha irma|meu marido|"
            r"minha esposa|meu filho|minha filha|meu tio|minha tia)\b",
            text,
        )
        if not match:
            return None
        parentesco = match.group(0)
        name = re.search(rf"{parentesco}\s+([a-z]+)", text)
        if name and name.group(1) not in _NAO_E_NOME:
            return f"{parentesco} {name.group(1)}".strip()
        return parentesco

    @staticmethod
    def _ambiguity(text: str, extracted: Sequence[tuple[str, str]]) -> Mapping[str, Any] | None:
        extracted_codes = {code for code, _ in extracted}
        for pattern in lexicon()["ambiguity_patterns"]:
            if not pattern.get("blocking"):
                continue
            if not _matches(text, pattern["all"]):
                continue
            if pattern.get("none") and _matches(text, pattern["none"]):
                continue
            if "transport_destination" in extracted_codes:
                continue
            return pattern
        return None

    @staticmethod
    def _phrase_question(next_question: Mapping[str, Any]) -> str:
        question = next_question["question"]
        options = next_question.get("allowed_values")
        if options:
            return f"{question} (opcoes: {options})"
        return question

    @staticmethod
    def _closing(snapshot: Mapping[str, Any]) -> str:
        pending = snapshot["pending_actions"]
        confirmed = ", ".join(sorted(snapshot["confirmed_facts"]))
        if pending:
            itens = ", ".join(a["fact_name"].lower() for a in pending)
            return (
                f"Ja tenho o que precisava por aqui ({confirmed}). Falta a Administracao do "
                f"Cemiterio Santana verificar: {itens}. Assim que houver retorno, seguimos."
            )
        return f"Ja tenho tudo que precisava por aqui ({confirmed}). A Administracao segue com o pedido."
