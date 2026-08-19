"""Autoridade deterministica do assunto EXUMACAO.

Todas as decisoes de negocio vivem aqui, fora do LLM:

* dominio de valores de cada fato (`facts.v1.json`);
* fatos `authoritative_only` (nunca confirmados por declaracao do municipe);
* derivacao de assinaturas exigidas (decisao humana 6);
* verificacao obrigatoria de jazigo de destino (decisoes humanas 1 e 2);
* proxima melhor pergunta (ordem de prioridade de `questions.v1.json`);
* status do objetivo e pendencias administrativas.

O LLM (Gemini, via Parlant) so pode propor valores candidatos chamando
`ExhumationCase.submit_fact`. Toda proposta e validada aqui e pode ser
recusada. Nenhuma resposta sobre preco, documento ou prazo e produzida
por este modulo: veja `knowledge.py`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from . import catalog

# Origens aceitas para confirmacao de fato, conforme facts.v1.json.
USER_SOURCES = ("USER_EXPLICIT", "USER_CORRECTION")
AUTHORITATIVE_SOURCES = ("SYSTEM", "DOCUMENT")
DERIVED_SOURCE = "DERIVED_RULE"

# Overlay de relevancia local da POC (nao existe no catalogo do repositorio).
# Os fatos de destino so passam a ser exigidos quando a finalidade declarada da
# exumacao for TRANSPORTE; a autoridade das regras de destino continua sendo a
# do repositorio (decisoes humanas 1 e 2).
POC_RELEVANCE_OVERLAY: Mapping[str, Mapping[str, str]] = {
    "transport_destination": {"exhumation_purpose": "TRANSPORTE"},
    "destination_grave_reference": {"transport_destination": "JAZIGO_FAMILIA"},
    "destination_grave_situation": {"transport_destination": "JAZIGO_FAMILIA"},
    "destination_grave_authorization": {"transport_destination": "JAZIGO_FAMILIA"},
}

CONFIRMED = "CONFIRMED"
UNCERTAIN = "UNCERTAIN"

ACCEPTED = "ACCEPTED"
RECORDED_AS_CLAIM = "RECORDED_AS_CLAIM"
REJECTED = "REJECTED"

GOAL_ACTIVE = "ACTIVE"
GOAL_WAITING = "WAITING"
GOAL_RESOLVED = "RESOLVED"


@dataclass(frozen=True)
class FactRecord:
    code: str
    value: Any
    source: str
    status: str
    rule: str | None = None


@dataclass(frozen=True)
class Submission:
    """Resultado da tentativa de registrar um fato."""

    fact_code: str
    outcome: str
    value: Any = None
    reason: str | None = None
    message: str | None = None
    allowed_values: tuple[str, ...] = ()
    pending_action: str | None = None
    superseded_value: Any = None

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "fact_code": self.fact_code,
            "outcome": self.outcome,
            "value": self.value,
        }
        for key in ("reason", "message", "pending_action", "superseded_value"):
            value = getattr(self, key)
            if value is not None:
                data[key] = value
        if self.allowed_values:
            data["allowed_values"] = list(self.allowed_values)
        return data


@dataclass
class ExhumationCase:
    """Estado de um atendimento de EXUMACAO (escopo CASE)."""

    case_id: str = "case-lab"
    facts: dict[str, FactRecord] = field(default_factory=dict)
    claims: dict[str, FactRecord] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    off_topic_notes: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _specs() -> Mapping[str, catalog.FactSpec]:
        return catalog.fact_specs()

    def confirmed_value(self, code: str) -> Any:
        record = self.facts.get(code)
        return record.value if record and record.status == CONFIRMED else None

    def is_relevant(self, code: str) -> bool:
        spec = self._specs()[code]
        for condition in spec.relevant_when:
            fact = condition.get("fact")
            if fact and self.confirmed_value(fact) != condition.get("equals"):
                return False
        for fact, expected in POC_RELEVANCE_OVERLAY.get(code, {}).items():
            if self.confirmed_value(fact) != expected:
                return False
        return True

    def required_fact_codes(self) -> tuple[str, ...]:
        required = list(catalog.goal_spec()["required_facts"])
        for code in ("transport_destination", "destination_grave_reference",
                     "destination_grave_situation", "destination_grave_authorization"):
            if code not in required:
                required.append(code)
        return tuple(code for code in required if code in self._specs() and self.is_relevant(code))

    # ------------------------------------------------------------- submissoes
    def submit_fact(self, fact_code: str, value: Any, source: str = "USER_EXPLICIT") -> Submission:
        """Unica porta de entrada de fatos. Valida contra o catalogo real."""
        specs = self._specs()
        spec = specs.get(fact_code)

        if spec is None:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="UNKNOWN_FACT",
                    message=(
                        "Fato desconhecido no catalogo do assunto Exumacao. "
                        f"Fatos aceitos: {', '.join(sorted(specs))}."
                    ),
                )
            )

        if spec.derived:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="DERIVED_FACT",
                    message=(
                        f"'{fact_code}' e derivado por regra deterministica e nao pode ser "
                        "informado nem inferido pelo atendente."
                    ),
                )
            )

        normalized = self._normalize(spec, value)
        if normalized is None:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="EMPTY_VALUE",
                    message="Valor vazio nao registra fato.",
                )
            )

        if spec.is_enum and normalized not in spec.allowed_values:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="VALUE_OUT_OF_DOMAIN",
                    value=normalized,
                    allowed_values=spec.allowed_values,
                    message=(
                        f"Valor fora do dominio de '{fact_code}'. "
                        f"Valores validos: {', '.join(spec.allowed_values)}."
                    ),
                )
            )

        if source not in USER_SOURCES + AUTHORITATIVE_SOURCES:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="INVALID_SOURCE",
                    message=f"Origem '{source}' nao e aceita para fatos de atendimento.",
                )
            )

        # Fatos autoritativos: declaracao do municipe vira alegacao UNCERTAIN e
        # abre acao pendente para a Administracao (decisoes humanas 1, 2 e 6).
        if spec.authoritative_only and source not in AUTHORITATIVE_SOURCES:
            self.claims[fact_code] = FactRecord(
                code=fact_code, value=normalized, source=source, status=UNCERTAIN
            )
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=RECORDED_AS_CLAIM,
                    value=normalized,
                    reason="AUTHORITATIVE_ONLY",
                    pending_action=spec.resolution_action,
                    message=(
                        f"'{spec.display_name}' so e confirmado pela Administracao do Cemiterio "
                        "(sinal autoritativo ou documento). O relato foi registrado como alegacao "
                        "e uma verificacao foi aberta."
                    ),
                )
            )

        if source not in spec.allowed_sources:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="SOURCE_NOT_ALLOWED_FOR_FACT",
                    message=(
                        f"Origem '{source}' nao pode confirmar '{fact_code}'. "
                        f"Origens aceitas: {', '.join(spec.allowed_sources)}."
                    ),
                )
            )

        previous = self.facts.get(fact_code)
        superseded = previous.value if previous and previous.value != normalized else None
        self.facts[fact_code] = FactRecord(
            code=fact_code, value=normalized, source=source, status=CONFIRMED
        )
        self.claims.pop(fact_code, None)
        self._recompute_derived()

        return self._record(
            Submission(
                fact_code=fact_code,
                outcome=ACCEPTED,
                value=normalized,
                superseded_value=superseded,
                message=(
                    f"'{spec.display_name}' registrado."
                    + (f" Valor anterior '{superseded}' foi superseded." if superseded else "")
                ),
            )
        )

    def apply_authoritative_signal(self, fact_code: str, value: Any, source: str = "SYSTEM") -> Submission:
        """Confirma fato autoritativo. So a Administracao/documento usa esta porta."""
        if source not in AUTHORITATIVE_SOURCES:
            return self._record(
                Submission(
                    fact_code=fact_code,
                    outcome=REJECTED,
                    reason="INVALID_AUTHORITATIVE_SOURCE",
                    message="Sinal autoritativo exige origem SYSTEM ou DOCUMENT.",
                )
            )
        return self.submit_fact(fact_code, value, source=source)

    def note_off_topic(self, description: str) -> None:
        """Registra assunto fora de EXUMACAO sem tentar resolve-lo."""
        text = description.strip()
        if text and text not in self.off_topic_notes:
            self.off_topic_notes.append(text)

    def _record(self, submission: Submission) -> Submission:
        self.history.append(submission.as_dict())
        return submission

    @staticmethod
    def _normalize(spec: catalog.FactSpec, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            text = re.sub(r"\s+", " ", value).strip()
            if not text:
                return None
            return text.upper().replace(" ", "_") if spec.is_enum else text
        return value

    # ---------------------------------------------------------- regras/derivacao
    def _recompute_derived(self) -> None:
        """Decisao humana 6: assinatura derivada apenas de surviving_spouse_status."""
        self.facts.pop("required_authorization_signatory", None)
        spouse = self.confirmed_value("surviving_spouse_status")
        mapping = {
            "VIVO": ("CONJUGE_E_RESPONSAVEL_JAZIGO", "REL_EXUMACAO_SIGNATORY_SPOUSE_ALIVE"),
            "FALECIDO": ("RESPONSAVEL_JAZIGO", "REL_EXUMACAO_SIGNATORY_NO_SPOUSE"),
            "INEXISTENTE": ("RESPONSAVEL_JAZIGO", "REL_EXUMACAO_SIGNATORY_NO_SPOUSE"),
        }
        if spouse in mapping:
            value, rule = mapping[spouse]
            self.facts["required_authorization_signatory"] = FactRecord(
                code="required_authorization_signatory",
                value=value,
                source=DERIVED_SOURCE,
                status=CONFIRMED,
                rule=rule,
            )

    def pending_actions(self) -> tuple[dict[str, str], ...]:
        actions: list[dict[str, str]] = []
        for code in self.required_fact_codes():
            spec = self._specs()[code]
            if not spec.authoritative_only:
                continue
            if self.confirmed_value(code) is not None:
                continue
            actions.append(
                {
                    "action_code": spec.resolution_action or "ACTION_ADMIN_VERIFICATION",
                    "fact_code": code,
                    "fact_name": spec.display_name,
                    "claimed_value": getattr(self.claims.get(code), "value", None) or "",
                }
            )
        return tuple(actions)

    def missing_facts(self) -> tuple[str, ...]:
        return tuple(
            code
            for code in self.required_fact_codes()
            if self.confirmed_value(code) is None
            and not self._specs()[code].authoritative_only
            and not self._specs()[code].derived
        )

    def goal_status(self) -> str:
        if self.missing_facts():
            return GOAL_ACTIVE
        if self.pending_actions():
            return GOAL_WAITING
        return GOAL_RESOLVED

    # ------------------------------------------------------ next best question
    def next_question(self) -> dict[str, str] | None:
        """Proxima melhor pergunta pela ordem de prioridade do catalogo real."""
        ranks = catalog.priority_rank()
        questions = catalog.questions_by_fact()
        candidates: list[tuple[int, int, str]] = []
        for order, code in enumerate(self.missing_facts()):
            spec = self._specs()[code]
            if not spec.ai_extractable:
                continue
            candidates.append((ranks.get(spec.priority_class, 99), order, code))
        if not candidates:
            return None
        _, _, code = min(candidates)
        spec = self._specs()[code]
        return {
            "fact_code": code,
            "priority_class": spec.priority_class,
            "question": questions.get(code, f"Qual o valor de {spec.display_name}?"),
            "allowed_values": ", ".join(spec.allowed_values),
        }

    # -------------------------------------------------------------- snapshot
    def snapshot(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "topic": catalog.TOPIC_CODE,
            "goal": catalog.PRIMARY_GOAL,
            "goal_status": self.goal_status(),
            "confirmed_facts": {
                code: {"value": rec.value, "source": rec.source, "rule": rec.rule}
                for code, rec in sorted(self.facts.items())
            },
            "claims_awaiting_administration": {
                code: rec.value for code, rec in sorted(self.claims.items())
            },
            "missing_facts": list(self.missing_facts()),
            "pending_actions": [dict(a) for a in self.pending_actions()],
            "next_question": self.next_question(),
            "off_topic_notes": list(self.off_topic_notes),
        }


def enum_domain() -> Mapping[str, Sequence[str]]:
    """Dominios de valores expostos ao agente (para o LLM mapear, nao inventar)."""
    return {
        code: spec.allowed_values
        for code, spec in catalog.fact_specs().items()
        if spec.is_enum and not spec.derived
    }


def user_writable_facts() -> tuple[str, ...]:
    return tuple(
        code
        for code, spec in catalog.fact_specs().items()
        if not spec.derived and spec.ai_extractable
    )


def authoritative_facts() -> tuple[str, ...]:
    return tuple(
        code for code, spec in catalog.fact_specs().items() if spec.authoritative_only
    )


def describe_facts(codes: Iterable[str] | None = None) -> list[dict[str, Any]]:
    specs = catalog.fact_specs()
    selected = list(codes) if codes is not None else list(specs)
    return [
        {
            "fact_code": code,
            "display_name": specs[code].display_name,
            "priority_class": specs[code].priority_class,
            "allowed_values": list(specs[code].allowed_values),
            "authoritative_only": specs[code].authoritative_only,
            "derived": specs[code].derived,
        }
        for code in selected
        if code in specs
    ]
