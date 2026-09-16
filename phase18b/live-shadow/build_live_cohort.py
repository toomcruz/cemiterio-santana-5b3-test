#!/usr/bin/env python3
"""Build a private, no-effects shadow cohort from the passive WACLI companion.

Raw WhatsApp identifiers and text are read locally and never copied verbatim to
the output. Only direct contacts previously classified as probable citizens are
eligible. The output contains a closed, aggressively redacted conversational
representation suitable for LAB/shadow evaluation.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import unicodedata


SCHEMA_VERSION = "phase18b-live-shadow-cohort/1.0.0"
MAX_EPISODE_MESSAGES = 40
SESSION_GAP_SECONDS = 24 * 60 * 60

SERVICE_TERMS = {
    "administracao", "agendamento", "agendar", "agenda", "aguardando", "analise", "analisar",
    "atendimento", "atendente", "autorizacao", "bloqueada", "bloqueado", "cadastro", "capela",
    "cemiterio", "concessao", "confirmacao", "confirmado", "contato", "cremacao", "cremar",
    "documentacao", "documento", "enterro", "equipe", "exumacao", "exumar", "familiar", "familia",
    "gaveta", "handoff", "herdeiro", "herdeiros", "jazigo", "lapide", "manutencao", "ossario",
    "ossuario", "pagamento", "placa", "procedimento", "quadra", "reclamacao", "recadastro",
    "referencia", "reforma", "reinumacao", "reinumacao", "reinumar", "representante", "restos",
    "retirada", "retirar", "sala", "sepultamento", "sepultar", "solicitacao", "sucessao", "terreno",
    "titular", "titularidade", "transferencia", "traslado", "validacao", "velorio", "zeladoria",
}
COMMON_TERMS = {
    "a", "agora", "ainda", "algum", "alguma", "antes", "ao", "aos", "apenas", "aqui", "as", "assim",
    "ate", "bom", "boa", "com", "como", "consegui", "consegue", "da", "das", "de", "depois", "desde",
    "do", "dos", "e", "ela", "ele", "em", "entao", "essa", "esse", "esta", "estao", "estou", "eu",
    "falar", "fazer", "foi", "foram", "gostaria", "ha", "isso", "ja", "mas", "me", "mesmo", "meu",
    "minha", "na", "nao", "nas", "no", "nos", "o", "obrigado", "obrigada", "ola", "os", "ou", "para",
    "pela", "pelo", "pode", "podem", "por", "porque", "precisa", "preciso", "qual", "quando", "que",
    "quero", "se", "sem", "ser", "sim", "sobre", "sou", "tambem", "tem", "tenho", "uma", "um", "voce",
}
ALLOWED_WORDS = SERVICE_TERMS | COMMON_TERMS

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
JID_RE = re.compile(r"\b[^\s@]+@(?:s\.whatsapp\.net|lid|g\.us|newsletter)\b", re.I)
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.I)
CPF_CNPJ_RE = re.compile(r"\b(?:\d{3}[.]?\d{3}[.]?\d{3}-?\d{2}|\d{2}[.]?\d{3}[.]?\d{3}/?\d{4}-?\d{2})\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}(?!\d)")
DATE_RE = re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b")
TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b")
MONEY_RE = re.compile(r"(?:R\$\s*)?\d{1,3}(?:[.]\d{3})*(?:,\d{2})")
LONG_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9])\d{5,}(?![A-Za-z0-9])")
NAME_MARKER_RE = re.compile(
    r"\b(nome(?:\s+(?:do|da|de))?|me\s+chamo|falecid[oa]|titular)\s*[:=-]?\s+([A-Za-zÀ-ÿ' -]{3,80})",
    re.I,
)
TITLE_NAME_RE = re.compile(r"\b(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç']+\s+){1,4}[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç']+\b")
WORD_RE = re.compile(r"[A-Za-zÀ-ÿ]+(?:['-][A-Za-zÀ-ÿ]+)?|\[[A-Z_]+\]|\d+|[^\w\s]", re.UNICODE)


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def hmac_id(key: bytes, prefix: str, value: str) -> str:
    digest = hmac.new(key, f"{prefix}:{value}".encode(), hashlib.sha256).hexdigest()
    return f"{prefix}_{digest[:24]}"


def normalized_word(value: str) -> str:
    text = unicodedata.normalize("NFD", value)
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower()


def sanitize_text(raw: str, aliases: list[str]) -> tuple[str, list[str]]:
    text = unicodedata.normalize("NFC", raw or "")
    text = "".join(char for char in text if unicodedata.category(char) not in {"Cc", "Cf"} or char in "\n\t")
    classes: set[str] = set()

    def replace(pattern: re.Pattern[str], marker: str, label: str) -> None:
        nonlocal text
        updated, count = pattern.subn(marker, text)
        if count:
            classes.add(label)
            text = updated

    for alias in sorted({item.strip() for item in aliases if len(item.strip()) >= 3}, key=len, reverse=True):
        updated, count = re.subn(re.escape(alias), "[PESSOA]", text, flags=re.I)
        if count:
            classes.add("known_alias")
            text = updated
    replace(URL_RE, "[LINK]", "url")
    replace(EMAIL_RE, "[EMAIL]", "email")
    replace(JID_RE, "[IDENTIFICADOR]", "jid")
    replace(UUID_RE, "[IDENTIFICADOR]", "uuid")
    replace(CPF_CNPJ_RE, "[DOCUMENTO]", "document_id")
    replace(PHONE_RE, "[TELEFONE]", "phone")
    replace(DATE_RE, "[DATA]", "date")
    replace(TIME_RE, "[HORARIO]", "time")
    replace(MONEY_RE, "[VALOR]", "money")
    replace(LONG_NUMBER_RE, "[NUMERO]", "long_number")
    replace(NAME_MARKER_RE, lambda match: f"{match.group(1)} [PESSOA]", "marked_name")
    replace(TITLE_NAME_RE, "[PESSOA]", "title_name")

    safe_tokens: list[str] = []
    for token in WORD_RE.findall(text):
        if token.startswith("[") or not token[0].isalpha():
            safe_tokens.append(token)
            continue
        word = normalized_word(token)
        if word in ALLOWED_WORDS or len(word) <= 2:
            safe_tokens.append(word)
        else:
            safe_tokens.append("[TERMO]")
            classes.add("lexicon_redaction")
    text = " ".join(safe_tokens)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:2000] or "[CONTEUDO_REDACTADO]", sorted(classes)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wacli-db", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--phase11-key", type=Path, required=True)
    parser.add_argument("--cohort-key", type=Path, required=True)
    parser.add_argument("--classification", type=Path, required=True)
    parser.add_argument("--exclusions", type=Path, required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--size", type=int, default=50)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def open_ro(path: Path, immutable: bool = False) -> sqlite3.Connection:
    suffix = "&immutable=1" if immutable else ""
    connection = sqlite3.connect(f"file:{path}?mode=ro{suffix}", uri=True)
    connection.execute("PRAGMA query_only=ON")
    return connection


def contact_id_for_jid(snapshot: sqlite3.Connection, key: bytes, jid: str) -> str | None:
    if "@" not in jid:
        return None
    user, server = jid.rsplit("@", 1)
    row = snapshot.execute(
        "SELECT _id, server FROM jid WHERE raw_string=? OR (user=? AND server=?) LIMIT 1",
        (jid, user, server),
    ).fetchone()
    if row is None:
        return None
    person_id, matched_server = row
    if matched_server == "lid":
        mapped = snapshot.execute("SELECT jid_row_id FROM jid_map WHERE lid_row_id=? LIMIT 1", (person_id,)).fetchone()
        if mapped is not None:
            person_id = mapped[0]
    return hmac_id(key, "contact", str(person_id))


def aliases_for(wacli: sqlite3.Connection, jid: str, message_rows: list[sqlite3.Row]) -> list[str]:
    values: list[str] = []
    row = wacli.execute(
        "SELECT phone,push_name,full_name,first_name,business_name,system_name FROM contacts WHERE jid=?",
        (jid,),
    ).fetchone()
    if row:
        values.extend(str(value) for value in row if value)
    values.extend(str(row[3]) for row in message_rows if row[3])
    return values


def public_direction(from_me: int) -> str:
    return "assistant" if from_me else "user"


def iso_utc(seconds: int) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def safe_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(canonical(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_private_payload(value: object) -> None:
    forbidden = {
        "url": URL_RE,
        "jid": JID_RE,
        "email": EMAIL_RE,
        "cpf_cnpj": CPF_CNPJ_RE,
        "phone": PHONE_RE,
        "uuid": UUID_RE,
    }
    episodes = value.get("episodes", []) if isinstance(value, dict) else []
    for episode in episodes:
        for message in episode.get("messages", []):
            content = message.get("content", "")
            for label, pattern in forbidden.items():
                if pattern.search(content):
                    raise RuntimeError(f"privacy validation failed: {label}")


def main() -> None:
    args = parse_args()
    if args.size < 20 or args.size > 100:
        raise RuntimeError("cohort size must be between 20 and 100")
    after = datetime.fromisoformat(args.after.replace("Z", "+00:00"))
    if after.tzinfo is None:
        raise RuntimeError("--after must include timezone")
    phase11_key = args.phase11_key.read_bytes()
    cohort_key = args.cohort_key.read_bytes()
    if len(phase11_key) != 32 or len(cohort_key) != 32:
        raise RuntimeError("HMAC keys must contain 32 bytes")

    categories: dict[str, set[str]] = defaultdict(set)
    for record in read_jsonl(args.classification):
        categories[record["contact_id"]].add(record["category"])
    exclusions = json.loads(args.exclusions.read_text(encoding="utf-8"))
    blocked_contacts = set(exclusions["team_internal_contact_ids"]) | set(exclusions["supplier_contact_ids"])

    wacli = open_ro(args.wacli_db)
    wacli.row_factory = sqlite3.Row
    snapshot = open_ro(args.snapshot, immutable=True)
    rows = wacli.execute(
        """
        SELECT rowid,chat_jid,ts,from_me,chat_name,sender_name,
               COALESCE(NULLIF(text,''),NULLIF(display_text,''),'') AS body,
               COALESCE(media_type,'') AS media_type,msg_id
          FROM messages
         WHERE ts>=? AND COALESCE(revoked,0)=0 AND COALESCE(deleted_for_me,0)=0
      ORDER BY chat_jid,ts,rowid
        """,
        (int(after.timestamp()),),
    ).fetchall()

    by_chat: dict[str, list[sqlite3.Row]] = defaultdict(list)
    rejection_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        jid = row["chat_jid"] or ""
        if any(marker in jid for marker in ("@g.us", "@newsletter", "@broadcast")) or jid == "status@broadcast":
            rejection_counts["non_direct"] += 1
            continue
        contact_id = contact_id_for_jid(snapshot, phase11_key, jid)
        if contact_id is None:
            rejection_counts["unmapped_contact"] += 1
            continue
        if contact_id in blocked_contacts:
            rejection_counts["known_internal_or_supplier"] += 1
            continue
        if "probable_citizen" not in categories.get(contact_id, set()):
            rejection_counts["not_previously_eligible_citizen"] += 1
            continue
        by_chat[jid].append(row)

    episodes: list[tuple[str, list[sqlite3.Row]]] = []
    for jid, chat_rows in by_chat.items():
        current: list[sqlite3.Row] = []
        previous: int | None = None
        for row in chat_rows:
            if previous is not None and row["ts"] - previous > SESSION_GAP_SECONDS:
                episodes.append((jid, current))
                current = []
            current.append(row)
            previous = row["ts"]
        if current:
            episodes.append((jid, current))

    eligible: list[tuple[str, list[sqlite3.Row], int, int]] = []
    for jid, episode in episodes:
        if not 2 <= len(episode) <= MAX_EPISODE_MESSAGES:
            rejection_counts["episode_size"] += 1
            continue
        decision_index = -1
        outbound_end = -1
        for index, row in enumerate(episode):
            if row["from_me"]:
                continue
            cursor = index + 1
            while cursor < len(episode) and episode[cursor]["from_me"]:
                cursor += 1
            if cursor > index + 1:
                decision_index, outbound_end = index, cursor
        if decision_index < 0:
            rejection_counts["no_observed_current_response"] += 1
            continue
        eligible.append((jid, episode, decision_index, outbound_end))

    # Stable newest-first cohort; ties are HMAC-stable and raw identifiers never leave memory.
    eligible.sort(
        key=lambda item: (
            -int(item[1][-1]["ts"]),
            hmac.new(cohort_key, item[0].encode(), hashlib.sha256).hexdigest(),
        )
    )
    selected = eligible[: args.size]
    if len(selected) != args.size:
        raise RuntimeError(f"only {len(selected)} eligible complete episodes available")

    cohort_id = hmac_id(cohort_key, "cohort", f"{args.after}:{args.size}:{len(rows)}")
    public_episodes: list[dict] = []
    redaction_totals: dict[str, int] = defaultdict(int)
    for jid, episode, decision_index, outbound_end in selected:
        aliases = aliases_for(wacli, jid, episode)
        conversation_ref = hmac_id(cohort_key, "conversation", jid)
        episode_seed = f"{jid}:{episode[0]['ts']}:{episode[-1]['ts']}"
        episode_id = hmac_id(cohort_key, "live_episode", episode_seed)
        messages: list[dict] = []
        for index, row in enumerate(episode):
            raw = row["body"] or ""
            if row["media_type"]:
                raw = (raw + " [MIDIA_NAO_ANALISADA]").strip()
            text, redactions = sanitize_text(raw, aliases)
            for label in redactions:
                redaction_totals[label] += 1
            messages.append(
                {
                    "turn_id": hmac_id(cohort_key, "turn", f"{row['msg_id']}:{row['rowid']}") ,
                    "role": public_direction(int(row["from_me"])),
                    "content": text,
                    "captured_at": iso_utc(int(row["ts"])),
                    "source_event_ref": hmac_id(cohort_key, "event", f"{row['msg_id']}:{row['rowid']}"),
                }
            )
        public_episodes.append(
            {
                "episode_id": episode_id,
                "conversation_ref": conversation_ref,
                "started_at": iso_utc(int(episode[0]["ts"])),
                "ended_at": iso_utc(int(episode[-1]["ts"])),
                "decision_turn_index": decision_index,
                "observed_current_end_index": outbound_end,
                "messages": messages,
            }
        )

    payload = {
        "schema_version": SCHEMA_VERSION,
        "mode": "LIVE_PASSIVE",
        "cohort_id": cohort_id,
        "source": {
            "channel": "whatsapp",
            "boundary": "wacli_passive_companion_sync",
            "production_path_role": "parallel_observer_only",
            "acquired_after": args.after,
            "source_db_sha256": file_sha256(args.wacli_db),
        },
        "safety": {
            "respond_allowed": False,
            "action_allowed": False,
            "official_write_allowed": False,
            "tools_mode": "would_call_only",
            "raw_content_persisted": False,
            "raw_identifiers_persisted": False,
        },
        "episodes": public_episodes,
    }
    validate_private_payload(payload)
    payload_hash = sha256_bytes(canonical(payload).encode())
    payload["cohort_hash"] = payload_hash
    manifest = {
        "schema_version": "phase18b-live-shadow-manifest/1.0.0",
        "cohort_id": cohort_id,
        "cohort_hash": payload_hash,
        "episode_count": len(public_episodes),
        "event_count": sum(len(item["messages"]) for item in public_episodes),
        "first_event_at": min(item["started_at"] for item in public_episodes),
        "last_event_at": max(item["ended_at"] for item in public_episodes),
        "rejection_counts": dict(sorted(rejection_counts.items())),
        "redaction_counts": dict(sorted(redaction_totals.items())),
        "privacy_validation": "PASS",
        "zero_effects": {
            "wacli_send_calls": 0,
            "official_database_writes": 0,
            "production_deploys": 0,
            "real_tool_calls": 0,
        },
    }
    safe_write(args.output, payload)
    safe_write(args.manifest, manifest)
    print(canonical({"cohort_id": cohort_id, "episodes": len(public_episodes), "events": manifest["event_count"]}))


if __name__ == "__main__":
    main()
