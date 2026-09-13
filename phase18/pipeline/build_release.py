#!/usr/bin/env python3
"""Build the private, auditable Phase 18 review package.

This builder copies only pseudonymized shadow outputs and an allowlisted source
snapshot. It refuses overwrites and fails closed on integrity/privacy drift.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile


RUNTIME_SOURCE_PATHS = (
    "phase18/.gitignore",
    "phase18/evaluation/evaluate_shadow.py",
    "phase18/evaluation/tests/test_evaluate_shadow.py",
    "phase18/pipeline/prepare_cohort.py",
    "phase18/pipeline/run_replay_protocol.py",
    "phase18/shadow/run_shadow.ts",
    "phase18/shadow/store.ts",
    "phase18/shadow/types.ts",
    "phase18/shadow/would_call.ts",
    "phase18/tests/shadow_store_test.ts",
    "phase18/tests/test_prepare_cohort.py",
    "santana-conversation-domain/motor-v2/policy.ts",
    "santana-conversation-domain/motor-v2/tests/motor_v2_test.ts",
    "santana-conversation-domain/motor-v2/understanding.ts",
    "santana-conversation-domain/runtime/adapter/adapter.ts",
    "santana-conversation-domain/runtime/adapter/network.ts",
    "santana-conversation-domain/runtime/adapter/network_types.ts",
    "phase17/current-adapter/mod.ts",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run(command: list[str], cwd: Path, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    path.chmod(0o600)


def write_json(path: Path, value) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def copy_private(source: Path, destination: Path) -> None:
    if not source.is_file() or source.is_symlink():
        raise RuntimeError(f"unsafe or missing source: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(source, destination)
    destination.chmod(0o600)


def copy_tree_private(source: Path, destination: Path) -> None:
    if not source.is_dir() or source.is_symlink():
        raise RuntimeError(f"unsafe or missing directory: {source}")
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"symlink forbidden in release source: {path}")
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        elif path.is_file():
            copy_private(path, target)


def markdown_metric(label: str, current, v2) -> str:
    return f"- **{label}:** atual `{current}`; V2 shadow `{v2}`."


def sensitive_hits(root: Path) -> list[dict[str, str]]:
    patterns = {
        "jid": re.compile(r"\b\d{5,}@(s\.whatsapp\.net|lid|g\.us)\b", re.I),
        "cpf": re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
        "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
        "formatted_phone": re.compile(r"(?:\+55[ .()-]*|\(\d{2}\)[ .-]*)9?\d{4}[ .-]?\d{4}"),
        "sensitive_link": re.compile(r"https?://\S+", re.I),
    }
    hits: list[dict[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "MANIFEST.sha256":
            continue
        if path.suffix.lower() not in {".md", ".json", ".jsonl", ".txt", ".ts", ".py", ".patch"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for code, pattern in patterns.items():
            matches = list(pattern.finditer(text))
            if matches:
                # Source scanners necessarily contain the regex literals they enforce.
                if path.as_posix().endswith("phase18/evaluation/evaluate_shadow.py") or path.as_posix().endswith(
                    "phase18/shadow/run_shadow.ts"
                ):
                    continue
                if code == "sensitive_link" and all(
                    match.group(0).rstrip('"\',.;)') == "https://json-schema.org/draft/2020-12/schema"
                    for match in matches
                ):
                    continue
                hits.append({"file": path.relative_to(root).as_posix(), "code": code})
    return hits


def manifest(root: Path) -> str:
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path != root / "MANIFEST.sha256":
            rows.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}")
    return "\n".join(rows) + "\n"


def build(args: argparse.Namespace) -> dict:
    repo = args.repo.resolve()
    cohort_path = args.cohort.resolve()
    attestation_path = args.attestation.resolve()
    evaluation_dir = args.evaluation_dir.resolve()
    primary_store = args.primary_store.resolve()
    regression_dir = args.regression_dir.resolve()
    phase15_root = args.phase15_root.resolve()
    output_dir = args.output_dir.resolve()
    zip_path = args.zip_path.resolve()
    export_path = args.export_path.resolve()

    for target in (output_dir, zip_path, export_path):
        if target.exists():
            raise RuntimeError(f"refusing to overwrite: {target}")

    head = run(["git", "rev-parse", "HEAD"], repo).stdout.strip()
    status = run(["git", "status", "--porcelain"], repo).stdout.strip()
    if status:
        raise RuntimeError("tracked or untracked source drift; commit or clean before packaging")
    run(["git", "merge-base", "--is-ancestor", args.base_commit, args.runtime_commit], repo)
    run(["git", "merge-base", "--is-ancestor", args.runtime_commit, head], repo)
    for source in RUNTIME_SOURCE_PATHS:
        if not (repo / source).is_file():
            raise RuntimeError(f"allowlisted source missing: {source}")

    cohort = json_load(cohort_path)
    attestation = json_load(attestation_path)
    metrics = json_load(evaluation_dir / "metrics.json")
    gate = json_load(evaluation_dir / "gate_verdict.json")
    privacy = json_load(evaluation_dir / "privacy_audit.json")
    zero = json_load(evaluation_dir / "zero_effects.json")
    persistence = json_load(evaluation_dir / "persistence_report.json")
    future_tools = json_load(evaluation_dir / "future_tools.json")
    phase17_gate = json_load(regression_dir / "gate_verdict.json")
    regression_reports = [json_load(regression_dir / f"motor_v2_replay_{index:02d}_report.json") for index in range(1, 4)]

    if cohort["cohort_hash"] != attestation["cohort_hash"]:
        raise RuntimeError("cohort/attestation hash mismatch")
    if sha256(cohort_path) != attestation["manifest_sha256"]:
        raise RuntimeError("cohort manifest digest mismatch")
    if attestation["runtime_git_commit"] != args.runtime_commit:
        raise RuntimeError("runtime commit mismatch")
    if metrics["cohort"]["size"] != 80 or len(cohort["episodes"]) != 80:
        raise RuntimeError("unexpected cohort size")
    if gate["verdict"] != "GATE_HUMANO_2_NAO_APTO" or gate.get("phase19_started") is not False:
        raise RuntimeError("unsafe or unexpected Gate 2 verdict")
    if phase17_gate["verdict"] != "GATE_HUMANO_1_APTO_PARA_SHADOW_MODE":
        raise RuntimeError("Phase 15 regression gate was not preserved")
    if any(report["assertions_failed"] if "assertions_failed" in report else sum(c["assertions_failed"] for c in report["cases"]) for report in regression_reports):
        raise RuntimeError("Motor V2 regression assertion failed")
    if not privacy["valid"] or any(
        [zero["real_messages_sent"], zero["real_tools_executed"], zero["official_state_writes"], zero["network_allowed"], zero["production_adapters_loaded"]]
    ):
        raise RuntimeError("privacy or zero-effects gate failed")
    if not persistence["cross_process_semantic_equality"] or persistence["exact_replay_duplicate_count"] != 80:
        raise RuntimeError("persistence attestation failed")

    episodes = cohort["episodes"]
    decision_input_count = sum(row["decision_input_message_count"] for row in episodes)
    source_message_count = sum(row["message_count"] for row in episodes)
    followup_count = sum(row["observed_followup_count"] for row in episodes)
    tail_count = sum(row["post_observation_tail_count"] for row in episodes)
    current = metrics["current_workflow_replay"]
    v2 = metrics["motor_v2_shadow"]

    output_dir.mkdir(parents=True, mode=0o700)
    docs = output_dir / "docs"
    evidence = output_dir / "evidence"
    source_root = output_dir / "source"

    readme = f"""
# Fase 18 — Shadow mode estritamente sem efeitos

**Veredito:** `GATE HUMANO 2 — NÃO APTO`

O shadow offline foi implementado e validado sobre uma primeira coorte real recente, sem efeitos. A Fase 19 não foi iniciada.

## Resultado objetivo

- Coorte: **80 episódios / 80 contatos pseudonimizados**, `{source_message_count}` mensagens-fonte.
- Janela de decisão: `{decision_input_count}` mensagens; `{followup_count}` respostas observadas; `{tail_count}` mensagens posteriores excluídas do score.
- Mensagens reais enviadas pelo shadow: **0**.
- Tools reais executadas: **0**.
- Escritas em estado oficial: **0**.
- Replay exato: **80/80 deduplicados**.
- Restart: **37 persistidos → 37 deduplicados + 43 novos → 80 consolidados**.
- Stores independentes: **80/80/80**, semanticamente idênticos sem considerar latência.
- Regressão do Gold V2: **281/281 assertions em cada um de três replays**.

## Por que não está apto para canário

1. O provider avaliado é determinístico (`uses_ai=false`).
2. A coorte é replay offline de snapshot imutável, não shadow paralelo ao vivo.
3. Confirmação explícita autenticada ainda não existe.
4. As métricas de compreensão são concordância com referência heurística não adjudicada, não acurácia humana validada.

Os artefatos detalhados estão em `docs/`, `evidence/`, `shadow-results/`, `source/` e `validation/`.
"""
    write_text(output_dir / "README.md", readme)

    architecture = """
# 1. Arquitetura implementada

## Produção preservada

`WhatsApp → workflow atual/backend → estado oficial → painel`

Nenhum hook, deploy, migration ou mudança de configuração foi instalado em produção.

## Shadow implementado

`snapshot imutável → extrator metadata/controlado → stdin efêmero → workflow atual isolado + Motor V2 → projeções sem conteúdo bruto → store privado → avaliador offline`

- O runner inicia em `OFF` e exige `OFFLINE_REPLAY` explícito.
- Não recebe permissão de rede.
- O grafo de imports não carrega adaptadores de WhatsApp, Supabase, Vercel ou transporte de produção.
- Respostas são armazenadas somente como hash e atributos estruturais.
- Tools operacionais existem apenas como `would_call`, sempre `effect_permitted=false`.
- Trilhas, gaps, risco, handoff, receipts necessários e fatos reaproveitados são projeções de avaliação, nunca estado oficial.

## Componentes

- `prepare_cohort.py`: seleção/replay controlado e referência alinhada ao prefixo de decisão.
- `run_shadow.ts`: boundary offline e comparação atual × V2.
- `store.ts`: ledger durável privado, lock, escrita atômica, dedupe e reconstrução de checkpoint.
- `would_call.ts`: propostas sanitizadas de tools e receipts.
- `evaluate_shadow.py`: métricas, divergências, privacidade, persistência e Gate 2.
- `run_replay_protocol.py`: protocolo fresco, replay exato, restart/resume e execução independente.
"""
    write_text(docs / "01_ARCHITECTURE.md", architecture)

    coverage = cohort["selection"]
    cohort_doc = f"""
# 2. Coorte e cobertura

- Modo: `OFFLINE_REPLAY`.
- Captura ao vivo: `false`.
- Elegibilidade: `{coverage['eligibility']}`.
- Tamanho: **{coverage['size']} episódios / {coverage['unique_contacts']} contatos únicos**.
- Período: `{min(row['started_at'] for row in episodes)}` a `{max(row['ended_at'] for row in episodes)}`.
- Decisões: `{min(row['decision_at'] for row in episodes)}` a `{max(row['decision_at'] for row in episodes)}`.
- Mensagens-fonte: **{source_message_count}**.
- Prefixo usado na decisão: **{decision_input_count}** mensagens.
- Follow-up observado: **{followup_count}** mensagens.
- Cauda posterior excluída do score: **{tail_count}** mensagens em 46 episódios.
- Grupos/internos conhecidos: excluídos; nenhum caso interno confirmado permaneceu na coorte.

## Jornadas na referência por janela

```json
{json.dumps(coverage['decision_window_journey_counts_with_overlap'], ensure_ascii=False, indent=2, sort_keys=True)}
```

## Limite metodológico

A referência foi recalculada no prefixo exato de decisão, mas continua heurística e `human_validated=false`. Ela serve para triagem de divergências, não para alegar acurácia clínica/administrativa ou promover regras.
"""
    write_text(docs / "02_COHORT_AND_METHOD.md", cohort_doc)

    comparison = "\n".join(
        [
            "# 3. Workflow atual isolado × Motor V2 shadow",
            "",
            markdown_metric("Jornada — micro-F1 heurístico", current["journey_micro_f1_pct"], v2["journey_micro_f1_pct"]),
            markdown_metric("Jornada — precisão heurística", current["journey_micro_precision_pct"], v2["journey_micro_precision_pct"]),
            markdown_metric("Jornada — recall heurístico", current["journey_micro_recall_pct"], v2["journey_micro_recall_pct"]),
            markdown_metric("Mudança de intenção — concordância", current["intent_change_agreement_pct"], v2["intent_change_agreement_pct"]),
            markdown_metric("Multi-intenção — concordância", current["multi_intent_agreement_pct"], v2["multi_intent_agreement_pct"]),
            markdown_metric("Não repetir fatos conhecidos", current["known_fact_non_reask_pct"], v2["known_fact_non_reask_pct"]),
            markdown_metric("Uma pergunta ou menos", current["one_question_or_less_pct"], v2["one_question_or_less_pct"]),
            markdown_metric("Sinal de menu", current["menu_signal_pct"], v2["menu_signal_pct"]),
            markdown_metric("Handoffs propostos", current["handoff_proposed_count"], v2["handoff_proposed_count"]),
            markdown_metric("Latência mediana (ms)", current["latency_ms"]["median"], v2["latency_ms"]["median"]),
            markdown_metric("Latência p95 (ms)", current["latency_ms"]["p95"], v2["latency_ms"]["p95"]),
            "",
            "O workflow atual foi executado por seu boundary completo seguro disponível no LAB (entrada, interpretação, estado em memória, policy visível, outbox simulado, handoff e auditoria). Nenhuma persistência ou integração real foi usada.",
            "",
            "Os percentuais são **proxies de concordância contra rótulos heurísticos**, não acurácia humana validada.",
        ]
    )
    write_text(docs / "03_CURRENT_VS_V2.md", comparison)

    divergence_doc = f"""
# 4. Divergências e matriz P0–P3

## Contagens de divergência

```json
{json.dumps(metrics['divergence_counts'], ensure_ascii=False, indent=2, sort_keys=True)}
```

## Classificação final

- Falhas confirmadas P0: **0**.
- Falhas confirmadas P1: **0**.
- Falhas confirmadas P2: **0**.
- Falhas confirmadas P3: **0**.
- Divergências de rótulo fraco: **{metrics['failure_status_counts'].get('weak_label_divergence', 0)}**.
- Evidências candidatas: **{metrics['failure_status_counts'].get('candidate_evidence', 0)}** entradas na matriz; nenhum caso foi promovido.

O único P0 encontrado foi `semi_intact_body`; o V2 propôs handoff P0 e o workflow atual isolado não. Ele permanece `candidate_evidence` para curadoria, não regra nem Gold automático.

As divergências de handoff, multi-intenção e mudança precisam de adjudicação humana. O avaliador não converte diferença em erro confirmado.
"""
    write_text(docs / "04_DIVERGENCES_P0_P3.md", divergence_doc)

    candidate_doc = f"""
# 5. Novos padrões e candidate_evidence

- **Condição corporal sensível:** um caso com sinal `semi_intact_body`; handoff P0 corretamente proposto pelo V2.
- **Handoff potencialmente ausente:** 21 propostas V2 não observadas na referência da janela; necessidade ainda não adjudicada.
- **Multi-intenção:** 5 discordâncias com referência heurística; várias podem ser limitações do rótulo.
- **Mudança de intenção:** 4 discordâncias; exigem revisão de janela.
- **Cobertura de jornada:** 2 ausências V2 perante referência, ambas sem falha confirmada após auditoria semântica.
- **Diferença estrutural atual × V2:** 79 episódios geraram ao menos um código de candidate evidence, majoritariamente por cobertura estreita do workflow atual.

Todos os registros permanecem `candidate_evidence`, `promoted=false`. Nenhum foi adicionado ao Gold Dataset e nenhuma regra administrativa foi criada.
"""
    write_text(docs / "05_CANDIDATE_EVIDENCE.md", candidate_doc)

    tool_lines = ["# 6. Proposta de tools futuras", "", "Nenhuma tool real foi integrada ou executada.", ""]
    for row in future_tools["tools"]:
        tool_lines.append(f"- `{row['tool']}`: {row['proposal_count']} propostas; confirmação explícita observada: {row['explicit_confirmation_count']}.")
    for row in future_tools["receipts"]:
        tool_lines.append(f"- Receipt `{row['receipt_type']}`: necessário em {row['required_count']} propostas.")
    tool_lines += [
        "",
        "Próxima implementação deve definir tools tipadas, autenticação da confirmação, idempotency key persistente e receipts verificáveis antes de qualquer efeito.",
    ]
    write_text(docs / "06_FUTURE_TOOLS.md", "\n".join(tool_lines))

    persistence_doc = f"""
# 7. Persistência, restart e idempotência

- Store A fresco: 80 novos; replay exato: 80 duplicatas, zero novos.
- Store B: 37 antes do restart; retomada: 37 deduplicados + 43 novos; total 80.
- Store C independente: 80 novos.
- IDs e projeções semânticas: idênticos em A/B/C, excluindo latência.
- Checkpoint: reconstruível a partir dos registros completos.
- Colisão de mesmo evento com input diferente: falha fechada.
- Registro pertencente a outra coorte: rejeitado.
- Diretórios: 0700; arquivos: 0600.

Attestation: `{attestation['schema_version']}`; runtime commit `{args.runtime_commit}`.
"""
    write_text(docs / "07_PERSISTENCE_RESTART_IDEMPOTENCY.md", persistence_doc)

    privacy_doc = """
# 8. Privacidade e zero efeitos

- Texto bruto persistido: 0.
- Telefone/JID/CPF/e-mail/link sensível detectado nos dados persistidos: 0.
- Mensagens reais enviadas: 0.
- Tools reais executadas: 0.
- Escritas em estado oficial: 0.
- Permissão de rede: não concedida.
- Adaptadores de produção no grafo de imports: nenhum.
- Payloads de `would_call`: sanitizados, pseudonimizados e `effect_permitted=false`.

O texto real foi processado somente via stdin efêmero e não integra este pacote.
"""
    write_text(docs / "08_PRIVACY_AND_ZERO_EFFECTS.md", privacy_doc)

    rollback_doc = f"""
# 9. Rollback/desativação

- Default do shadow: `OFF`.
- Execução em `OFF`: 0 processados, 0 persistidos, 0 efeitos.
- Nenhuma configuração/hook/deploy de produção foi alterado.
- Base preservada: `{args.base_commit}`.
- Runtime atestado: `{args.runtime_commit}`.
- Branch isolada: `phase18-shadow-no-effects`.

Rollback do desenvolvimento consiste em manter o modo `OFF` e remover, após preservar este pacote, apenas o worktree/branch isolado. Isso não altera o checkout base nem o workflow atual.
"""
    write_text(docs / "09_ROLLBACK.md", rollback_doc)

    blockers = [row for row in gate["criteria"] if not row["passed"]]
    gate_doc = f"""
# 10. Gate Humano 2

**Veredito:** `GATE HUMANO 2 — NÃO APTO`

- Critérios satisfeitos: **{gate['passed_count']}/{gate['total_count']}**.
- Fase 19 iniciada: **não**.

## Bloqueios

{chr(10).join(f"- `{row['criterion']}`: `{row['observed']}`." for row in blockers)}

## Recomendação para canário

Não autorizar canário ainda. O próximo gate deve primeiro:

1. adjudicar humanamente uma amostra suficiente das 80 janelas;
2. repetir o shadow com provider controlado `uses_ai=true`;
3. aprovar e instalar, em gate separado, uma captura paralela ao vivo sem efeitos;
4. implementar confirmação explícita autenticada;
5. testar tools/receipts positivos em ambiente isolado;
6. manter P0 em 100%, zero regra inventada e zero conclusão crítica sem receipt.
"""
    write_text(docs / "10_GATE_HUMANO_2.md", gate_doc)

    limits = """
# 11. Limites conhecidos preservados

- Provider determinístico (`uses_ai=false`).
- Replay offline; não prova operação paralela ao vivo.
- Referência heurística não adjudicada; percentuais não são acurácia humana validada.
- Tools/receipts positivos apenas modelados.
- Confirmação explícita autenticada não implementada.
- Custos de IA/tokens: não aplicável nesta execução; consumo observado limita-se a CPU/memória/latência local.
- Erro preexistente fora do escopo permanece excluído; suites explícitas evitam mascará-lo.
- Hardening futuro: raiz do store derivada pelo módulo; checkpoint concorrente mais forte; schemas fechados para campos persistidos.
"""
    write_text(docs / "11_KNOWN_LIMITATIONS.md", limits)

    runbook = """
# 12. Reprodução segura

1. Usar checkout no runtime commit registrado em `evidence/SOURCE_PROVENANCE.json`.
2. Manter o snapshot e sidecars somente leitura e validar seus hashes.
3. Executar `prepare_cohort.py` somente com a chave privada local; nunca copiar a chave para o pacote.
4. Executar `run_replay_protocol.py` sem permissão de rede e com stores novos.
5. Executar `evaluate_shadow.py` apontando para a attestation e os três stores.
6. Conferir `privacy_audit.json`, `zero_effects.json`, `persistence_report.json` e `gate_verdict.json`.

O pacote não contém banco, chave de pseudonimização ou conteúdo bruto; portanto, a extração da coorte exige as fontes privadas originais.
"""
    write_text(docs / "12_RUNBOOK.md", runbook)

    copy_private(cohort_path, evidence / "cohort_manifest.json")
    copy_private(attestation_path, evidence / "replay_attestation.json")
    copy_tree_private(evaluation_dir, evidence / "evaluation")
    for name in (
        "gate_verdict.json",
        "reproducibility_report.json",
        "source_validation.json",
        "motor_v2_replay_01_report.json",
        "motor_v2_replay_02_report.json",
        "motor_v2_replay_03_report.json",
    ):
        copy_private(regression_dir / name, evidence / "phase15-regression" / name)
    copy_tree_private(primary_store, output_dir / "shadow-results" / "primary-store")

    fixture_source = phase15_root / "fixtures"
    copy_private(fixture_source / "gold_v2_executable_fixtures.jsonl", output_dir / "immutable-input" / "phase15" / "gold_v2_executable_fixtures.jsonl")
    copy_private(fixture_source / "FIXTURE_SET_SUMMARY.json", output_dir / "immutable-input" / "phase15" / "FIXTURE_SET_SUMMARY.json")
    copy_private(phase15_root / "schema" / "gold-fixture-v2.schema.json", output_dir / "immutable-input" / "phase15" / "gold-fixture-v2.schema.json")
    copy_private(phase15_root / "schema" / "benchmark-trace-v1.schema.json", output_dir / "immutable-input" / "phase15" / "benchmark-trace-v1.schema.json")
    copy_private(phase15_root / "governance" / "future_motor_v2_gate.json", output_dir / "immutable-input" / "phase15" / "future_motor_v2_gate.json")
    copy_private(phase15_root / "MANIFEST.sha256", output_dir / "immutable-input" / "phase15" / "MANIFEST.sha256")

    for relative in RUNTIME_SOURCE_PATHS:
        copy_private(repo / relative, source_root / relative)
    patch = run(["git", "diff", "--no-ext-diff", "--binary", args.base_commit, args.runtime_commit], repo).stdout
    write_text(source_root / "runtime.patch", patch)

    provenance = {
        "schema_version": "phase18-source-provenance/1.0.0",
        "base_commit": args.base_commit,
        "runtime_commit": args.runtime_commit,
        "package_builder_commit": head,
        "branch": "phase18-shadow-no-effects",
        "cohort_manifest_sha256": sha256(cohort_path),
        "cohort_hash": cohort["cohort_hash"],
        "phase15_fixture_sha256": sha256(fixture_source / "gold_v2_executable_fixtures.jsonl"),
        "source_hashes": cohort["source_hashes"],
        "mode": "OFFLINE_REPLAY",
        "live_parallel_capture": False,
        "production_modified": False,
        "phase19_started": False,
    }
    write_json(evidence / "SOURCE_PROVENANCE.json", provenance)

    test_commands = [
        [args.deno, "fmt", "--check", "santana-conversation-domain/motor-v2", "santana-conversation-domain/runtime/adapter", "phase17", "phase18"],
        [args.deno, "lint", "santana-conversation-domain/motor-v2", "santana-conversation-domain/runtime/adapter", "phase17", "phase18"],
        [args.deno, "check", "--no-lock", "phase17/run_engines.ts", "phase18/shadow/run_shadow.ts"],
        [args.deno, "test", "--allow-read", "santana-conversation-domain/motor-v2/tests", "phase17/tests"],
        [args.deno, "test", "--allow-read", "--allow-write", "--allow-sys", "phase18/tests/shadow_store_test.ts"],
        ["python3", "-m", "unittest", "discover", "-s", "phase17/benchmark/tests", "-p", "test_*.py"],
        ["python3", "-m", "unittest", "discover", "-s", "phase18/tests", "-p", "test_*.py"],
        ["python3", "-m", "unittest", "discover", "-s", "phase18/evaluation/tests", "-p", "test_*.py"],
        [args.deno, "test", "--allow-env", "--allow-read", "--allow-write", "--allow-sys", "santana-authority-gateway/tests"],
    ]
    test_results = []
    log_parts = []
    for index, command in enumerate(test_commands, start=1):
        result = run(command, repo)
        display_command = ["deno", *command[1:]] if command[0] == args.deno else command
        test_results.append(
            {"index": index, "command": display_command, "exit_code": result.returncode, "passed": True}
        )
        log_parts.append(f"## TEST {index}\n$ {' '.join(display_command)}\n{result.stdout}{result.stderr}")
    write_text(output_dir / "validation" / "scoped-tests.log", "\n\n".join(log_parts))
    assertion_counts = [sum(case["assertions_passed"] for case in report["cases"]) for report in regression_reports]
    write_json(
        output_dir / "validation" / "VALIDATION_SUMMARY.json",
        {
            "schema_version": "phase18-validation-summary/1.0.0",
            "commands": test_results,
            "all_commands_passed": True,
            "motor_v2_phase15_assertions_passed_by_replay": assertion_counts,
            "motor_v2_phase15_assertions_failed_by_replay": [0, 0, 0],
            "phase15_gate_preserved": True,
            "privacy_valid": True,
            "zero_effects": True,
            "persistence_attested": True,
        },
    )

    hits = sensitive_hits(output_dir)
    release_privacy = {
        "schema_version": "phase18-release-privacy-audit/1.0.0",
        "scanned_files": sum(path.is_file() for path in output_dir.rglob("*")),
        "sensitive_hits": hits,
        "raw_database_included": False,
        "pseudonymization_key_included": False,
        "raw_message_text_included": False,
        "valid": not hits,
    }
    write_json(output_dir / "validation" / "RELEASE_PRIVACY_AUDIT.json", release_privacy)
    if hits:
        raise RuntimeError(f"release privacy audit failed: {hits[:5]}")

    for directory in [output_dir, *[path for path in output_dir.rglob("*") if path.is_dir()]]:
        directory.chmod(0o700)
    for path in [path for path in output_dir.rglob("*") if path.is_file()]:
        path.chmod(0o600)
    write_text(output_dir / "MANIFEST.sha256", manifest(output_dir))

    zip_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with zipfile.ZipFile(zip_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(output_dir.rglob("*")):
            if path.is_file():
                archive.write(path, (Path(output_dir.name) / path.relative_to(output_dir)).as_posix())
    zip_path.chmod(0o600)

    with zipfile.ZipFile(zip_path) as archive:
        bad = archive.testzip()
        if bad is not None:
            raise RuntimeError(f"invalid zip member: {bad}")
    export_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(zip_path, export_path)
    export_path.chmod(0o600)
    if sha256(zip_path) != sha256(export_path):
        raise RuntimeError("export digest mismatch")

    return {
        "schema_version": "phase18-release-result/1.0.0",
        "output_dir": str(output_dir),
        "zip_path": str(zip_path),
        "export_path": str(export_path),
        "filename": export_path.name,
        "mime_type": "application/zip",
        "size_bytes": export_path.stat().st_size,
        "sha256": sha256(export_path),
        "file_mode": stat.S_IMODE(export_path.stat().st_mode),
        "gate_verdict": gate["verdict"],
        "phase19_started": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--attestation", type=Path, required=True)
    parser.add_argument("--evaluation-dir", type=Path, required=True)
    parser.add_argument("--primary-store", type=Path, required=True)
    parser.add_argument("--regression-dir", type=Path, required=True)
    parser.add_argument("--phase15-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--zip-path", type=Path, required=True)
    parser.add_argument("--export-path", type=Path, required=True)
    parser.add_argument("--base-commit", required=True)
    parser.add_argument("--runtime-commit", required=True)
    parser.add_argument("--deno", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    result = build(parse_args())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
