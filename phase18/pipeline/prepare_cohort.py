#!/usr/bin/env python3
"""Select and stream a private, recent real cohort for offline shadow replay.

`select` persists metadata only. `stream` writes raw message text only to stdout
for an in-memory consumer; it never writes message text to disk.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata


EXPECTED_SNAPSHOT_SHA256 = "e81b1778060519636d23f2834259e9c5c77c10d5547444e6b7adc77c659e26a2"
EXPECTED_CLASSIFICATION_SHA256 = "b6a74df838fbb8ff26ff921ae4fe4c7d7f2f9e9ce4c6d232295dddac130e847c"
EXPECTED_SEMANTIC_SHA256 = "808d73a066b5b57d9972892d480d3c7675a009b2d40f02f2ea5ea6b99cf86d7d"
SESSION_GAP_MS = 24 * 60 * 60 * 1000
JOURNEYS = (
    "FUNERARIO_IMEDIATO",
    "RESTOS_MORTAIS",
    "JAZIGO_ESPACO_FISICO",
    "DIREITOS_CADASTRO",
    "SUPORTE_RECLAMACAO",
    "DESCONHECIDA_AMBIGUA",
)

# Phase 11's heuristic taxonomy, reproduced locally so the comparison labels
# are computed from the exact decision prefix fed to both engines. Whole-
# episode Phase 11 labels remain selection/provenance metadata only.
DECISION_JOURNEY_PATTERNS = {
    "FUNERARIO_IMEDIATO": r"\b(velorio|sepultamento|sepultar|enterro|capela|obito recente|falecimento recente)\b",
    "RESTOS_MORTAIS": r"\b(exumacao|exumar|restos mortais|ossuario|ossario|ossos|reinumacao|semi intacto)\b|retir\w* (os )?restos",
    "JAZIGO_ESPACO_FISICO": r"\b(jazigo|tumulo|gaveta|quadra|terreno|lapide|placa|reforma|manutencao|limpeza|zeladoria|localizar|localizacao|visita)\b",
    "DIREITOS_CADASTRO": r"\b(recadastro|recadastramento|titularidade|titular|concessao|cessionario|transferencia de concessao|sucessao|herdeir\w*)\b",
    "SUPORTE_RECLAMACAO": r"\b(reclamacao|reclamar|demora|problema|atendente|ninguem responde|sem retorno|nao respondeu|insatisfeit\w*)\b",
}
DECISION_SUBINTENT_PATTERNS = {
    "RETIRAR_RESTOS": r"\b(exumacao|exumar)\b|retir\w* (os )?restos|tirar (os )?ossos",
    "DESTINO_OSSUARIO": r"\b(ossuario|ossario|guardar (os )?ossos|caixa de ossos)\b",
    "DESTINO_CREMAR": r"\b(cremar|cremacao)\b.*\b(restos|ossos|exum)|\b(restos|ossos|exum)\b.*\b(cremar|cremacao)\b",
    "DESTINO_TRASLADAR": r"\b(traslado|transladar)\b.*\b(restos|ossos|exum)|\b(restos|ossos|exum)\b.*\b(traslado|transladar)\b",
    "REINUMACAO": r"\b(reinumacao|reinumar|sepultar novamente)\b",
    "MULTIPLOS_FALECIDOS": r"\b(dois|duas|tres|varios|varias|mais de um)\b.{0,40}\b(falecid\w*|corpos?|restos|ossos)\b",
    "CORPO_SEMI_INTACTO": r"\b(semi intacto|semi-intacto|corpo intacto|nao decomposto)\b",
    "VELORIO": r"\b(velorio|velar)\b",
    "SEPULTAMENTO": r"\b(sepultamento|sepultar|enterro|enterrar)\b",
    "CREMACAO_IMEDIATA": r"\b(cremacao|cremar)\b(?!.*\b(restos|ossos|exum))",
    "TRASLADO_CORPO": r"\b(traslado|transladar)\b(?!.*\b(restos|ossos|exum))",
    "CAPELA_SALA": r"\b(capela|sala de velorio|sala do velorio)\b",
    "LOCALIZAR": r"\b(localizar|localizacao|onde fica|achar)\b.{0,50}\b(jazigo|tumulo|sepultura|quadra|terreno)\b",
    "VISITAR": r"\b(visita|visitar|horario de visita)\b",
    "MANUTENCAO": r"\b(manutencao|conservacao|conserto)\b",
    "OBRA_REFORMA": r"\b(obra|reforma|construcao)\b",
    "LAPIDE_PLACA": r"\b(lapide|placa|letreiro)\b",
    "IDENTIFICAR_REFERENCIA": r"\b(quadra|terreno|gaveta|rua)\b",
    "LIMPEZA_ZELADORIA": r"\b(limpeza|zeladoria|entulho|mato|conservacao)\b",
    "RECADASTRAR": r"\b(recadastro|recadastramento|atualizacao cadastral|atualizar cadastro)\b",
    "TITULARIDADE": r"\b(titularidade|titular|cessionario)\b",
    "CONCESSAO": r"\b(concessao|perpetuidade|carta de concessao)\b",
    "TRANSFERENCIA": r"\b(transferencia|transferir)\b.{0,40}\b(concessao|titular|jazigo)\b",
    "SUCESSAO": r"\b(sucessao|herdeir\w*|inventario)\b",
    "RELACAO_FAMILIAR_DECLARADA": r"\b(mae|pai|filh\w*|irma\w*|espos\w*|marido|avo|net\w*|ti\w*|sobrinh\w*)\b",
    "SEM_RETORNO": r"\b(sem retorno|aguardo retorno|ninguem responde|nao respondeu|falta de retorno)\b",
    "RECLAMACAO_OPERACIONAL": r"\b(reclamacao|reclamar|absurdo|insatisfeit\w*|problema|demora)\b",
    "CORRECAO_DE_DADO": r"\b(corrigir|correcao|esta errado|nao foi isso|informacao errada)\b",
    "PEDIDO_HUMANO": r"\b(falar com (um |uma )?atendente|atendimento humano|preciso de ajuda|alguem pode responder)\b",
    "EMISSAO_SEGUNDA_VIA_DOCUMENTO": r"\b(segunda via|copia)\b.{0,40}\b(declaracao|certidao|documento)\b|\b(emitir|emissao|solicitar)\b.{0,40}\b(declaracao|certidao)\b",
    "PLANO_ZELADORIA": r"\b(plano de zeladoria|pacote de zeladoria)\b",
    "ADMINISTRACAO_PROVISORIA": r"\b(administracao provisoria|administrador provisorio)\b",
}
DECISION_TRANSVERSE_PATTERNS = {
    "DOCUMENTACAO": r"\b(document\w*|certidao|declaracao de obito|atestado de obito|cpf|rg|comprovante|requerimento)\b",
    "FINANCEIRO": r"\b(valor|preco|custa|pagamento|pagar|pix|boleto|cartao|parcela|taxa)\b",
    "AGENDA": r"\b(agenda|agendar|agendamento|data disponivel|horario|disponibilidade)\b",
    "HANDOFF": r"\b(encaminhar|encaminhado|administracao|setor responsavel|equipe responsavel|atendente|aguarde.*retorno)\b",
}
COMPILED_DECISION_JOURNEYS = {key: re.compile(value) for key, value in DECISION_JOURNEY_PATTERNS.items()}
COMPILED_DECISION_SUBINTENTS = {key: re.compile(value) for key, value in DECISION_SUBINTENT_PATTERNS.items()}
COMPILED_DECISION_TRANSVERSE = {key: re.compile(value) for key, value in DECISION_TRANSVERSE_PATTERNS.items()}
DECISION_HANDOFF_RE = re.compile(
    r"\b(encaminh\w*|setor responsavel|equipe responsavel|falar com (um |uma )?atendente|"
    r"aguarde.{0,30}retorno|administracao.{0,40}(analisar|responder|confirmar|retorno))\b"
)
DECISION_RESOLUTION_RE = re.compile(
    r"\b(resolvid\w*|concluid\w*|confirmad\w*|agendad\w*|localizad\w*|finalizad\w*|encaminhado com sucesso)\b"
)
DECISION_NON_RESOLUTION_RE = re.compile(
    r"\b(nao|ainda nao|sem|sera|vai ser)\b.{0,30}\b(resolvid\w*|concluid\w*|confirmad\w*|agendad\w*|localizad\w*|finalizad\w*)\b"
)

# Human-audited non-citizen sources from Phase 14. Their contacts are excluded
# from this cohort, without changing the source classification dataset.
KNOWN_NON_CITIZEN_EPISODES = {
    "episode_be64398bd813c626371defbc",
    "episode_dc9b647d1718cc975560251a",
    "episode_abe833055e8e9add1cdf279c",
    "episode_280a56c197e63479d371cd80",
    "episode_28c9a43e1d579b048bce593f",
    "episode_2c98512796c3843507f647cc",
    "episode_40124842769baff1f7c89c7e",
    "episode_23904e0c5cf0154ca3096906",
    "episode_e8eb16fdc594f167299b8255",
    "episode_20a474b18725124317813c07",
    "episode_2a49bef915adbb90bcb70f5e",
    "episode_e15542b2f075357cf659865b",
    "episode_823bf1dad27d408c9751d292",
}

STRONG_INTERNAL_PATTERNS = (
    r"\b(?:vou|pode|precisa) lancar no sistema\b",
    r"\b(?:meu|seu|troca de) turno\b",
    r"\b(?:estou|esta|ficou) de plantao\b",
    r"\b(?:colega|colaborador|funcionario)\b",
    r"\bmandei no grupo\b",
    r"\bfechamento (?:do )?caixa\b",
    r"\b(?:planilha|relatorio) (?:intern|de fechamento)\w*\b",
    r"\b(?:senha|acesso) (?:do|ao) sistema\b",
    r"\b(?:escala|cobrir) (?:de )?horario\b",
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def iso_utc(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).isoformat()


def pseudonym(key: bytes, kind: str, value: object) -> str:
    digest = hmac.new(key, f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()
    return f"{kind}_{digest[:24]}"


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn").lower()
    return re.sub(r"\s+", " ", text).strip()


def semantic_normalize(value: str) -> str:
    """Match the Phase 11 normalization used to create heuristic labels."""
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn").lower()
    text = re.sub(r"https?://\S+|\b\S+@\S+\b", " ", text)
    text = re.sub(r"[^a-z0-9? ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def open_snapshot(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    connection.execute("PRAGMA query_only = ON")
    return connection


def iter_episodes(connection: sqlite3.Connection):
    rows = connection.execute(
        """
        SELECT COALESCE(jm.jid_row_id, c.jid_row_id) AS person_id,
               m._id, m.timestamp, m.from_me, m.message_type, COALESCE(m.text_data, '')
          FROM message AS m
          JOIN chat AS c ON c._id = m.chat_row_id
          JOIN jid AS j ON j._id = c.jid_row_id
     LEFT JOIN jid_map AS jm ON j.server = 'lid' AND jm.lid_row_id = c.jid_row_id
         WHERE j.server IN ('lid', 's.whatsapp.net') AND m.timestamp > 0
      ORDER BY person_id, m.timestamp, m._id
        """
    )
    current_person = None
    previous_timestamp = None
    sequence = 0
    episode: list[tuple] = []
    for row in rows:
        person_id, _, timestamp = row[:3]
        row_current = iso_utc(timestamp).startswith("2026-")
        episode_current = bool(episode and iso_utc(episode[0][2]).startswith("2026-"))
        new_episode = (
            current_person != person_id
            or previous_timestamp is None
            or timestamp - previous_timestamp > SESSION_GAP_MS
            or (episode and row_current != episode_current)
        )
        if new_episode and episode:
            yield current_person, sequence, episode
            episode = []
            sequence += 1
        if current_person != person_id:
            current_person = person_id
            sequence = 0
        episode.append(row)
        previous_timestamp = timestamp
    if episode:
        yield current_person, sequence, episode


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("select", "stream"), required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--classification", type=Path, required=True)
    parser.add_argument("--semantic", type=Path, required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--size", type=int, default=80)
    return parser.parse_args()


def verify_sources(args: argparse.Namespace) -> None:
    expected = {
        args.snapshot: EXPECTED_SNAPSHOT_SHA256,
        args.classification: EXPECTED_CLASSIFICATION_SHA256,
        args.semantic: EXPECTED_SEMANTIC_SHA256,
    }
    for path, digest in expected.items():
        if file_sha256(path) != digest:
            raise RuntimeError(f"source hash mismatch: {path.name}")
    if args.size < 50 or args.size > 100:
        raise RuntimeError("cohort size must be between 50 and 100")
    if len(args.key.read_bytes()) != 32:
        raise RuntimeError("pseudonym key must be 32 bytes")


def candidate_priority(record: dict) -> tuple:
    specific_risk = any(flag != "HUMAN_HANDOFF_OBSERVED" for flag in record["risk_flags"])
    stable = hashlib.sha256(f"phase18-cohort-v1|{record['episode_id']}".encode()).hexdigest()
    return (
        0 if specific_risk else 1,
        0 if record["intent_changed"] else 1,
        0 if record["multi_intent"] else 1,
        0 if record["handoff_observed"] else 1,
        -int(datetime.fromisoformat(record["ended_at"]).timestamp()),
        stable,
    )


def decision_window(rows: list[tuple]) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """Return the latest observable inbound→outbound decision and later tail."""
    windows: list[tuple[int, int]] = []
    for index, row in enumerate(rows):
        if row[3]:
            continue
        end = index + 1
        while end < len(rows) and rows[end][3]:
            end += 1
        if end > index + 1:
            windows.append((index, end))
    if windows:
        trigger, observed_end = windows[-1]
    else:
        trigger = max(index for index, row in enumerate(rows) if not row[3])
        observed_end = trigger + 1
    return rows[: trigger + 1], rows[trigger + 1 : observed_end], rows[observed_end:]


def matching_labels(patterns: dict[str, re.Pattern], text: str) -> list[str]:
    return [name for name, pattern in patterns.items() if pattern.search(text)]


def decision_reference(rows: list[tuple]) -> dict:
    """Recompute weak labels from exactly the decision prefix seen by engines."""
    inbound = [semantic_normalize(row[5]) for row in rows if not row[3] and row[5]]
    outbound = [semantic_normalize(row[5]) for row in rows if row[3] and row[5]]
    citizen_text = " ".join(inbound)
    all_text = " ".join(inbound + outbound)
    journey_input = citizen_text or all_text
    journeys = matching_labels(COMPILED_DECISION_JOURNEYS, journey_input) or ["DESCONHECIDA_AMBIGUA"]
    subintents = matching_labels(COMPILED_DECISION_SUBINTENTS, journey_input)
    transverse = matching_labels(COMPILED_DECISION_TRANSVERSE, all_text)
    initial = matching_labels(COMPILED_DECISION_JOURNEYS, " ".join(inbound[:3]))
    final = matching_labels(COMPILED_DECISION_JOURNEYS, " ".join(inbound[-3:]))
    intent_changed = bool(final and initial and set(final) != set(initial))
    multi_intent = len(journeys) > 1 or len(subintents) > 2
    handoff = any(DECISION_HANDOFF_RE.search(text) for text in outbound)
    risk_flags = []
    if re.search(r"\b(morte nao natural|morte violenta|iml|necropsia|boletim de ocorrencia)\b", citizen_text):
        risk_flags.append("DEATH_NON_NATURAL")
    if re.search(r"\b(conflito|discord|nao autoriza|todos os herdeiros)\b", citizen_text):
        risk_flags.append("FAMILY_AUTHORITY")
    if "CORPO_SEMI_INTACTO" in subintents:
        risk_flags.append("BODY_CONDITION")
    if handoff:
        risk_flags.append("HUMAN_HANDOFF_OBSERVED")
    resolution_apparent = any(
        DECISION_RESOLUTION_RE.search(text) and not DECISION_NON_RESOLUTION_RE.search(text)
        for text in outbound[-3:]
    )
    return {
        "source": "phase11_heuristic_recomputed_on_decision_window",
        "scope": "decision_input_prefix_only",
        "human_validated": False,
        "journeys": journeys,
        "subintents": subintents,
        "transverse_states": transverse,
        "intent_changed": intent_changed,
        "multi_intent": multi_intent,
        "handoff_observed": handoff,
        "possible_abandonment": bool(len(rows) > 1 and not rows[-1][3] and not resolution_apparent),
        "resolution_apparent": resolution_apparent,
        "risk_flags": risk_flags,
    }


def select_ids(args: argparse.Namespace, raw_by_id: dict[str, list[tuple]]) -> dict:
    classifications = {row["episode_id"]: row for row in read_jsonl(args.classification)}
    semantics = {row["episode_id"]: row for row in read_jsonl(args.semantic)}
    non_citizen_contacts = {
        classifications[episode_id]["contact_id"]
        for episode_id in KNOWN_NON_CITIZEN_EPISODES
        if episode_id in classifications
    }
    with open_snapshot(args.snapshot) as connection:
        maximum = connection.execute("SELECT MAX(timestamp) FROM message WHERE timestamp > 0").fetchone()[0]
    cutoff = datetime.fromtimestamp(maximum / 1000, timezone.utc) - timedelta(hours=24)
    window_start = cutoff - timedelta(days=45)
    excluded = {"known_non_citizen_contact": 0, "internal_discourse": 0, "unsafe_message_bounds": 0}
    candidates: list[dict] = []
    for episode_id, record in semantics.items():
        classification = classifications.get(episode_id)
        rows = raw_by_id.get(episode_id)
        if not classification or not rows:
            continue
        ended = datetime.fromisoformat(record["ended_at"])
        if not (
            classification["category"] == "probable_citizen"
            and classification["classification_confidence"] == "high"
            and classification["inbound_count"] > 0
            and classification["outbound_count"] > 0
            and classification["message_count"] >= 3
            and window_start <= ended <= cutoff
        ):
            continue
        if classification["contact_id"] in non_citizen_contacts:
            excluded["known_non_citizen_contact"] += 1
            continue
        inbound_text = normalize("\n".join(row[5] for row in rows if not row[3]))
        internal_markers = sum(bool(re.search(pattern, inbound_text)) for pattern in STRONG_INTERNAL_PATTERNS)
        if internal_markers >= 2:
            excluded["internal_discourse"] += 1
            continue
        if len(rows) > 200 or any(len(row[5]) > 20_000 for row in rows):
            excluded["unsafe_message_bounds"] += 1
            continue
        candidates.append({**record, "contact_id": classification["contact_id"]})

    # Keep one highest-priority episode per pseudonymous contact.
    unique_contacts: dict[str, dict] = {}
    for record in sorted(candidates, key=candidate_priority):
        unique_contacts.setdefault(record["contact_id"], record)
    candidates = list(unique_contacts.values())
    ordered = sorted(candidates, key=candidate_priority)
    selected: list[dict] = []
    selected_ids: set[str] = set()

    def add(record: dict) -> None:
        if record["episode_id"] not in selected_ids and len(selected) < args.size:
            selected.append(record)
            selected_ids.add(record["episode_id"])

    # Preserve every available specific-risk and change candidate, then meet
    # coverage floors before deterministic fill.
    for record in ordered:
        if any(flag != "HUMAN_HANDOFF_OBSERVED" for flag in record["risk_flags"]):
            add(record)
    for record in ordered:
        if record["intent_changed"]:
            add(record)
    for journey in JOURNEYS:
        for record in ordered:
            if sum(journey in current["journeys"] for current in selected) >= 10:
                break
            if journey in record["journeys"]:
                add(record)
    for record in ordered:
        if sum(current["handoff_observed"] for current in selected) >= 15:
            break
        if record["handoff_observed"]:
            add(record)
    for record in ordered:
        if sum(current["multi_intent"] for current in selected) >= 30:
            break
        if record["multi_intent"]:
            add(record)
    for record in ordered:
        add(record)
    if len(selected) != args.size:
        raise RuntimeError(f"could select only {len(selected)} episodes")
    floors = {
        "multi_intent": sum(row["multi_intent"] for row in selected),
        "intent_changed": sum(row["intent_changed"] for row in selected),
        "handoff_observed": sum(row["handoff_observed"] for row in selected),
    }
    if floors["multi_intent"] < 30 or floors["handoff_observed"] < 15:
        raise RuntimeError("cohort coverage floor not met")
    journey_counts = {journey: sum(journey in row["journeys"] for row in selected) for journey in JOURNEYS}
    if any(count < 10 for count in journey_counts.values()):
        raise RuntimeError("journey coverage floor not met")
    decision_references = {
        row["episode_id"]: decision_reference(decision_window(raw_by_id[row["episode_id"]])[0])
        for row in selected
    }
    decision_journey_counts = {
        journey: sum(journey in decision_references[row["episode_id"]]["journeys"] for row in selected)
        for journey in JOURNEYS
    }
    identity = {
        "schema_version": "phase18-cohort-manifest/1.2.0",
        "source_hashes": {
            "snapshot": EXPECTED_SNAPSHOT_SHA256,
            "classification": EXPECTED_CLASSIFICATION_SHA256,
            "semantic_2026": EXPECTED_SEMANTIC_SHA256,
        },
        "selection_version": "phase18-cohort-v3-window-aligned-reference",
        "decision_protocol": "latest_inbound_with_contiguous_observed_outbound_reply",
        "selected_episode_ids": [row["episode_id"] for row in selected],
    }
    cohort_hash = hashlib.sha256(canonical(identity).encode()).hexdigest()
    return {
        **identity,
        "cohort_id": f"phase18_cohort_{cohort_hash[:20]}",
        "cohort_hash": cohort_hash,
        "mode": "OFFLINE_REPLAY",
        "live_capture": False,
        "selection": {
            "size": len(selected),
            "unique_contacts": len({row["contact_id"] for row in selected}),
            "window_start": window_start.isoformat(),
            "cutoff": cutoff.isoformat(),
            "eligibility": "probable_citizen/high_confidence/bidirectional/direct/complete",
            "known_non_citizen_contacts_excluded": len(non_citizen_contacts),
            "excluded_candidate_counts": excluded,
            "whole_episode_journey_counts_with_overlap": journey_counts,
            "decision_window_journey_counts_with_overlap": decision_journey_counts,
            **floors,
            "specific_risk_candidates": sum(
                any(flag != "HUMAN_HANDOFF_OBSERVED" for flag in row["risk_flags"]) for row in selected
            ),
            "reference_is_human_validated": False,
            "reference_scope": "decision_input_prefix_only",
            "whole_episode_labels_used_for_scoring": False,
        },
        "episodes": [
            {
                "episode_id": row["episode_id"],
                "event_id": f"shadow_event_{hashlib.sha256((cohort_hash + '|' + row['episode_id']).encode()).hexdigest()[:24]}",
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "message_count": row["message_count"],
                "decision_at": iso_utc(decision_window(raw_by_id[row["episode_id"]])[0][-1][2]),
                "decision_input_message_count": len(decision_window(raw_by_id[row["episode_id"]])[0]),
                "observed_followup_count": len(decision_window(raw_by_id[row["episode_id"]])[1]),
                "post_observation_tail_count": len(decision_window(raw_by_id[row["episode_id"]])[2]),
                "decision_reference": decision_references[row["episode_id"]],
                "episode_candidate_metadata": {
                    "source": "phase11_full_episode_heuristic_candidate_evidence",
                    "used_for_scoring": False,
                    "journeys": row["journeys"],
                    "subintents": row["subintents"],
                    "transverse_states": row["transversal_states"],
                    "intent_changed": row["intent_changed"],
                    "multi_intent": row["multi_intent"],
                    "handoff_observed": row["handoff_observed"],
                    "possible_abandonment": row["possible_abandonment"],
                    "resolution_apparent": row["resolution_apparent"],
                    "risk_flags": row["risk_flags"],
                },
            }
            for row in selected
        ],
        "raw_message_text_persisted": False,
        "production_writes": 0,
    }


def reconstruct(args: argparse.Namespace) -> tuple[bytearray, dict[str, list[tuple]]]:
    key = bytearray(args.key.read_bytes())
    found: dict[str, list[tuple]] = {}
    with open_snapshot(args.snapshot) as connection:
        for person_id, sequence, rows in iter_episodes(connection):
            episode_id = pseudonym(key, "episode", f"{person_id}:{sequence}")
            found[episode_id] = rows
    return key, found


def main() -> None:
    args = parse_args()
    verify_sources(args)
    key, raw_by_id = reconstruct(args)
    try:
        if args.mode == "select":
            manifest = select_ids(args, raw_by_id)
            args.manifest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            args.manifest.write_text(canonical(manifest) + "\n", encoding="utf-8")
            os.chmod(args.manifest.parent, 0o700)
            os.chmod(args.manifest, 0o600)
            print(canonical({"status": "SELECTED", "cohort_id": manifest["cohort_id"], "cohort_hash": manifest["cohort_hash"], "size": len(manifest["episodes"])}))
            return
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        expected = select_ids(args, raw_by_id)
        if canonical(manifest) != canonical(expected):
            raise RuntimeError("cohort manifest does not match deterministic selection")
        by_id = {row["episode_id"]: row for row in manifest["episodes"]}
        for episode_id in manifest["selected_episode_ids"]:
            metadata = by_id[episode_id]
            rows = raw_by_id[episode_id]
            decision_rows, observed_rows, _ = decision_window(rows)
            messages = [
                {
                    "turn_id": pseudonym(key, "turn", row[1]),
                    "role": "assistant" if row[3] else "user",
                    "content": row[5].strip() or "[mensagem de mídia sem texto; conteúdo não inferido]",
                    "synthetic": False,
                }
                for row in decision_rows
            ]
            observed_followup_messages = [
                {
                    "turn_id": pseudonym(key, "turn", row[1]),
                    "role": "assistant",
                    "content": row[5].strip() or "[mensagem de mídia sem texto; conteúdo não inferido]",
                    "synthetic": False,
                }
                for row in observed_rows
            ]
            envelope = {
                "schema_version": "phase18-shadow-input/1.2.0",
                "mode": "OFFLINE_REPLAY",
                "cohort_id": manifest["cohort_id"],
                "cohort_hash": manifest["cohort_hash"],
                "source_snapshot_sha256": EXPECTED_SNAPSHOT_SHA256,
                "event_id": metadata["event_id"],
                "episode_id": episode_id,
                "started_at": metadata["started_at"],
                "ended_at": metadata["ended_at"],
                "decision_at": metadata["decision_at"],
                "source_episode_message_count": metadata["message_count"],
                "messages": messages,
                "observed_followup_messages": observed_followup_messages,
                "reference": metadata["decision_reference"],
            }
            sys.stdout.write(canonical(envelope) + "\n")
    finally:
        if isinstance(key, bytearray):
            for index in range(len(key)):
                key[index] = 0


if __name__ == "__main__":
    main()
