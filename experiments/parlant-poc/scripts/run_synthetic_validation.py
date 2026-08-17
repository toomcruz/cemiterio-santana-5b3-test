#!/usr/bin/env python
"""Executa a validacao sintetica e gera os dois relatorios da POC.

    python scripts/run_synthetic_validation.py            # 300 conversas
    SYNTHETIC_CONVERSATIONS=50 python scripts/run_synthetic_validation.py

Nao usa secret, nao usa rede: o `NetworkGuard` bloqueia e conta qualquer
tentativa de sair para fora do loopback.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from santana_parlant_poc.synthetic import corpus as corpus_mod  # noqa: E402
from santana_parlant_poc.synthetic.runner import rodar  # noqa: E402

JSON_SAIDA = RAIZ / "synthetic-validation-report.json"
MD_SAIDA = RAIZ / "SYNTHETIC_VALIDATION_REPORT.md"


def versao_parlant() -> str:
    from importlib.metadata import version

    return version("parlant")


def commit() -> str:
    import subprocess

    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=RAIZ
        ).stdout.strip()[:12]
    except Exception:
        return "desconhecido"


def avaliar_gates(relatorio: dict) -> tuple[bool, list[str]]:
    """Gates do criterio final. Nenhum e relaxado para conseguir PASS."""
    bloqueadores: list[str] = []
    violacoes = relatorio.get("violacoes", {})

    for nome, valor in violacoes.items():
        if valor:
            bloqueadores.append(f"{nome} = {valor} (exigido 0)")

    inventario = relatorio.get("inventario", {})
    if inventario.get("faltando"):
        bloqueadores.append(f"entidades faltando: {inventario['faltando']}")

    if relatorio.get("erro_bateria"):
        bloqueadores.append(f"erro na bateria: {relatorio['erro_bateria']}")

    turnos = relatorio.get("turnos", 0)
    com_erro = relatorio.get("turnos_com_erro", 0)
    if turnos and com_erro:
        bloqueadores.append(f"turnos sem conclusao: {com_erro}/{turnos}")

    if not relatorio.get("guidelines_ativadas"):
        bloqueadores.append("nenhuma guideline observada no rastro (instrumentacao)")

    if not relatorio.get("tools_chamadas"):
        bloqueadores.append("nenhuma tool observada no rastro (instrumentacao)")

    # So contam falhas de schema NAO injetadas: as injetadas sao os modos de
    # falha do provider, ligados de proposito para observar a reacao do Parlant.
    falhas_schema = relatorio.get("schemas", {}).get("falhas_de_schema", {})
    if falhas_schema:
        bloqueadores.append(f"falhas de schema: {falhas_schema}")

    cenarios = relatorio.get("cenarios", {})
    relacionamentos = cenarios.get("relationships", {})
    if relacionamentos and relacionamentos.get("aprovados") != relacionamentos.get("total"):
        bloqueadores.append(
            f"relationships: {relacionamentos.get('aprovados')}/{relacionamentos.get('total')}"
        )

    ferramentas = cenarios.get("tools", {})
    if ferramentas and ferramentas.get("aprovados") != ferramentas.get("total"):
        bloqueadores.append(f"tools: {ferramentas.get('aprovados')}/{ferramentas.get('total')}")

    jornada = cenarios.get("journey", {})
    if jornada and not jornada.get("houve_transicao"):
        bloqueadores.append("journey nao transicionou de estado")

    falhas = cenarios.get("modos_de_falha", {})
    if falhas.get("violacoes"):
        bloqueadores.append(f"violacao de autoridade sob falha do NLP: {falhas['violacoes']}")

    isolado = cenarios.get("isolamento_dirigido", {})
    if isolado.get("cross_session_contamination"):
        bloqueadores.append(
            f"contaminacao entre sessoes: {isolado['cross_session_contamination']}"
        )

    # Bloqueia so o que e seguranca: turno de guarda de autoridade sem nenhuma
    # guarda casada. Divergencia em guideline de estilo entra no relatorio.
    casamento = relatorio.get("casamento_de_guidelines", {})
    if casamento.get("falsos_negativos_em_guarda"):
        bloqueadores.append(
            "turnos de guarda de autoridade sem guarda casada: "
            f"{casamento['falsos_negativos_em_guarda']}"
        )

    return (not bloqueadores), bloqueadores


def escrever_markdown(relatorio: dict, passou: bool, bloqueadores: list[str]) -> None:
    schemas = relatorio.get("schemas", {})
    inventario = relatorio.get("inventario", {})
    violacoes = relatorio.get("violacoes", {})

    linhas = [
        "# Validacao sintetica — Parlant real + Santana",
        "",
        f"**PARLANT SYNTHETIC VALIDATION: {'PASS' if passou else 'FAIL'}**",
        "",
        f"- data: {relatorio.get('gerado_em')}",
        f"- parlant: {relatorio.get('parlant')}",
        f"- commit: {relatorio.get('commit')}",
        f"- seed: {relatorio.get('seed')}",
        f"- provider: sintetico (sem LLM externo, sem secret)",
        "",
        "## Inicializacao",
        "",
        f"- tempo ate o servidor no ar: **{relatorio.get('inicializacao_s')}s**",
        f"- duracao total da bateria: {relatorio.get('duracao_total_s')}s",
        f"- entidades esperadas: `{inventario.get('esperado')}`",
        f"- entidades carregadas: `{inventario.get('carregado')}`",
        f"- entidades faltando: `{inventario.get('faltando') or 'nenhuma'}`",
        "",
        "## Schemas do Parlant",
        "",
        f"- encontrados nesta POC: **{schemas.get('total_encontrados')}**",
        f"- atendidos semanticamente: {', '.join(schemas.get('atendidos_semanticamente', [])) or '-'}",
        f"- atendidos estruturalmente: {', '.join(schemas.get('atendidos_estruturalmente', [])) or '-'}",
        f"- falhas de schema: `{schemas.get('falhas_de_schema') or 'nenhuma'}`",
        "",
        "## Conversas",
        "",
        f"- conversas: {relatorio.get('conversas')}",
        f"- turnos: {relatorio.get('turnos')}",
        f"- turnos com resposta: {relatorio.get('turnos_com_resposta')}",
        f"- turnos sem conclusao: {relatorio.get('turnos_com_erro')}",
        f"- categorias cobertas: {len(relatorio.get('categorias', []))}",
        "",
        "## Autoridade e seguranca (todos precisam ser zero)",
        "",
        "| gate | valor |",
        "| ---- | ----- |",
    ]
    for nome, valor in violacoes.items():
        linhas.append(f"| {nome} | {valor} |")

    cenarios = relatorio.get("cenarios", {})
    casamento = relatorio.get("casamento_de_guidelines", {})
    falhas = cenarios.get("modos_de_falha", {})
    jornada = cenarios.get("journey", {})

    linhas += [
        "",
        "## Rede",
        "",
        f"- chamadas externas: **{relatorio.get('rede', {}).get('external_network_calls')}**",
        f"- tentativas bloqueadas: `{relatorio.get('rede', {}).get('tentativas')}`",
        f"- PARLANT_HOME desta execucao: `{relatorio.get('parlant_home')}` "
        f"({relatorio.get('cache_de_avaliacao')})",
        "",
        "## Rastro observado",
        "",
        f"- guidelines: `{relatorio.get('guidelines_ativadas')}`",
        f"- tools: `{relatorio.get('tools_chamadas')}`",
        f"- journey: `{relatorio.get('journey_estados')}`",
        "",
        "## Casamento de guidelines (onde ha expectativa declarada)",
        "",
        f"- turnos avaliados: {casamento.get('turnos_avaliados')}",
        f"- acertos: {casamento.get('acertos')}",
        f"- falsos negativos: {casamento.get('falsos_negativos')} "
        f"(em guarda de autoridade: {casamento.get('falsos_negativos_em_guarda')})",
        f"- falsos positivos: {casamento.get('falsos_positivos')}",
        f"- acuracia: {casamento.get('acuracia')}",
        f"- por categoria: `{casamento.get('por_categoria')}`",
        "",
        "## Cenarios dirigidos",
        "",
        f"- Relationships (guarda vence coleta): "
        f"**{cenarios.get('relationships', {}).get('aprovados')}/"
        f"{cenarios.get('relationships', {}).get('total')}**",
        f"- Tools (chama / nao chama): **{cenarios.get('tools', {}).get('aprovados')}/"
        f"{cenarios.get('tools', {}).get('total')}**",
        f"- Journey: transicionou de estado = **{jornada.get('houve_transicao')}**; "
        f"estados observados = `{jornada.get('estados_distintos')}`",
        f"- Isolamento dirigido: contaminacao = "
        f"**{cenarios.get('isolamento_dirigido', {}).get('cross_session_contamination')}**",
        f"- Modos de falha do NLP: {falhas.get('modos_testados')} injetados, "
        f"violacoes de autoridade = **{falhas.get('violacoes')}**",
        "",
        "### Transicoes da Journey observadas",
        "",
        "| estado anterior | evento | estado novo |",
        "| --- | --- | --- |",
    ]
    for transicao in jornada.get("transicoes", []):
        linhas.append(
            f"| `{transicao['estado_anterior']}` | {transicao['evento']} | "
            f"`{transicao['estado_novo']}` |"
        )

    linhas += [
        "",
        "### Modos de falha do provider NLP",
        "",
        "| modo | houve resposta | numero na resposta | fato autoritativo confirmado |",
        "| --- | --- | --- | --- |",
    ]
    for caso in falhas.get("casos", []):
        linhas.append(
            f"| {caso['modo']} | {caso['houve_resposta']} | {caso['resposta_com_numero']} | "
            f"{caso['fatos_autoritativos_confirmados'] or 'nenhum'} |"
        )

    linhas += [
        "",
        f"Falhas injetadas de proposito (nao sao defeito): "
        f"{sum(schemas.get('falhas_injetadas', {}).values())} chamadas.",
        "",
        "## Determinismo",
        "",
        "`scripts/check_determinism.py` roda a bateria duas vezes, em processos",
        "separados, com a mesma seed, e compara corpus, rastro, tools, journey, gates",
        "e rede. O volume de chamadas ao provider fica **fora** do criterio: o motor do",
        "Parlant agenda lotes em paralelo e o total oscila em uma ou duas chamadas entre",
        "execucoes (confirmado tambem com concorrencia 1 no laboratorio), sem que nenhuma",
        "decisao mude. Resultado corrente em `synthetic-determinism.json`.",
        "",
        "## Bloqueadores",
        "",
    ]
    linhas += [f"- {b}" for b in bloqueadores] or ["- nenhum"]
    linhas += [
        "",
        "## O que este teste NAO prova",
        "",
        "O provider sintetico substitui o modelo. Portanto **nada aqui** diz respeito a:",
        "",
        "- qualidade linguistica real do Gemini;",
        "- interpretacao real de portugues informal, girias ou erros de digitacao pelo modelo;",
        "- aderencia real do Gemini a schemas estruturados complexos;",
        "- latencia, custo ou cota do Gemini.",
        "",
        "O que ele prova: que o **Parlant real** carrega a POC completa, percorre seu pipeline",
        "(indexacao, casamento de guidelines, tools, journey, composicao), e que a autoridade",
        "deterministica do Santana e as guardas de seguranca se mantem sob esse pipeline.",
        "",
        "Dito de outro modo: o sintetico responde *se a arquitetura sustenta as regras*;",
        "so o Gemini real responde *se o modelo entende o municipe*.",
    ]
    MD_SAIDA.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def main() -> int:
    quantidade = int(os.environ.get("SYNTHETIC_CONVERSATIONS", "300"))
    seed = int(os.environ.get("SYNTHETIC_SEED", str(corpus_mod.SEED_PADRAO)))

    relatorio = rodar(quantidade=quantidade, seed=seed)
    relatorio["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    relatorio["parlant"] = versao_parlant()
    relatorio["commit"] = commit()

    passou, bloqueadores = avaliar_gates(relatorio)
    relatorio["resultado"] = "PASS" if passou else "FAIL"
    relatorio["bloqueadores"] = bloqueadores

    JSON_SAIDA.write_text(
        json.dumps(relatorio, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    escrever_markdown(relatorio, passou, bloqueadores)

    print(f"\nPARLANT SYNTHETIC VALIDATION: {'PASS' if passou else 'FAIL'}")
    for bloqueador in bloqueadores:
        print(f"  BLOCKER: {bloqueador}")
    print(f"relatorios: {JSON_SAIDA.name}, {MD_SAIDA.name}")
    return 0 if passou else 1


if __name__ == "__main__":
    sys.exit(main())
