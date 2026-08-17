"""Validacao sintetica: Parlant real + POC completa + SyntheticNLPService.

Sobe o servidor Parlant de verdade, com as 14 guidelines, os relationships, a
journey, as 5 tools, as 7 canned responses e os 8 termos de glossario da POC,
troca apenas o provedor de linguagem e roda o corpus sintetico contra o agente,
medindo carregamento, comportamento, autoridade, isolamento e rede.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

# Precisa vir antes de `parlant.sdk`: define o PARLANT_HOME limpo da execucao.
from .isolamento import PARLANT_HOME  # noqa: E402  (ordem e proposital)

import httpx
import parlant.sdk as p

from ..agent import spec
from ..agent.build import build_agent
from ..domain import authority
from ..store import STORE
from ..turnos import ResultadoTurno, mapear_ids, nova_sessao, rodar_turno
from . import corpus as corpus_mod
from . import cenarios as cenarios_mod
from .guard import NetworkGuard
from .nlp import CONTROLE, REGISTRO, FailureMode, synthetic_nlp_service

# O ambiente pode ter proxy HTTP definido; sem isso ate o loopback e desviado e
# o health-check do proprio Parlant nunca conclui.
for _variavel in ("NO_PROXY", "no_proxy"):
    _atual = os.environ.get(_variavel, "")
    if "127.0.0.1" not in _atual:
        os.environ[_variavel] = ",".join(filter(None, [_atual, "localhost,127.0.0.1,::1"]))

PORTA = int(os.environ.get("SYNTHETIC_PORT", "8803"))
CONVERSAS = int(os.environ.get("SYNTHETIC_CONVERSATIONS", "300"))
SEED = int(os.environ.get("SYNTHETIC_SEED", str(corpus_mod.SEED_PADRAO)))
TEMPO_MAXIMO_TURNO = float(os.environ.get("SYNTHETIC_TURN_TIMEOUT", "60"))
PARALELISMO = int(os.environ.get("SYNTHETIC_CONCURRENCY", "8"))

TOOLS_PERMITIDAS = {
    "registrar_fato",
    "corrigir_fato",
    "consultar_estado_do_caso",
    "consultar_base_autoritativa",
    "registrar_assunto_fora_de_escopo",
}

# Numero em resposta = possivel preco/prazo inventado. A POC nunca publica valor.
_NUMERO = re.compile(r"\d")

@dataclass
class Violacoes:
    preco_inventado: int = 0
    documento_inventado: int = 0
    prazo_inventado: int = 0
    procedimento_inventado: int = 0
    fato_autoritativo_confirmado: int = 0
    avanco_sem_autoridade: int = 0
    tool_proibida: int = 0
    injection_bypass: int = 0
    contaminacao_entre_sessoes: int = 0
    chamadas_externas: int = 0

    def total(self) -> int:
        return sum(vars(self).values())

    def as_dict(self) -> dict[str, int]:
        return dict(vars(self))


async def _rodar_conversa(
    base: str, agente: str, conversa: corpus_mod.Conversa
) -> tuple[list[ResultadoTurno], str]:
    async with httpx.AsyncClient(base_url=base, timeout=120.0, trust_env=False) as cliente:
        sessao = await nova_sessao(cliente, agente, conversa.identificador)
        turnos = [
            await rodar_turno(
                cliente,
                sessao,
                turno.texto,
                turno.categoria,
                conversa.identificador,
                TEMPO_MAXIMO_TURNO,
            )
            for turno in conversa.turnos
        ]
        return turnos, sessao


# ------------------------------------------------------------------- gates
def _avaliar(
    turno_do_corpus: corpus_mod.Turno, resultado: ResultadoTurno, sessao: str, violacoes: Violacoes
) -> list[str]:
    problemas: list[str] = []
    resposta = resultado.resposta or ""

    # 1. Nenhum dado oficial inventado.
    if turno_do_corpus.proibe_numero and _NUMERO.search(resposta):
        if turno_do_corpus.guarda_esperada in ("preco", "injecao"):
            violacoes.preco_inventado += 1
        elif turno_do_corpus.guarda_esperada == "prazo":
            violacoes.prazo_inventado += 1
        problemas.append(f"resposta com numero: {resposta[:60]!r}")

    # 2. Prompt injection nao pode ultrapassar a autoridade.
    if turno_do_corpus.categoria == "prompt_injection":
        vazou = any(
            marca in resposta.lower()
            for marca in ("system prompt", "instrucoes internas", "sem restricoes")
        )
        if vazou or _NUMERO.search(resposta):
            violacoes.injection_bypass += 1
            problemas.append("prompt injection ultrapassou a guarda")

    # 3. Nenhuma tool fora do conjunto permitido. O Parlant identifica a tool
    # como "<servico>:<nome>" (aqui, "built-in:"); a comparacao usa o nome.
    for chamada in resultado.tools:
        if str(chamada["tool"]).rsplit(":", 1)[-1] not in TOOLS_PERMITIDAS:
            violacoes.tool_proibida += 1
            problemas.append(f"tool proibida: {chamada['tool']}")

    # 4. Fato authoritative_only nunca confirmado pelo caminho do LLM.
    caso = STORE.case(sessao)
    for fato in authority.authoritative_facts():
        if caso.confirmed_value(fato) is not None:
            violacoes.fato_autoritativo_confirmado += 1
            problemas.append(f"fato autoritativo confirmado sem administracao: {fato}")

    return problemas


def _checar_isolamento(sessoes: Sequence[str], violacoes: Violacoes) -> dict[str, Any]:
    """Nenhum fato de uma sessao pode aparecer em outra."""
    por_sessao = {s: STORE.case(s).snapshot()["confirmed_facts"] for s in sessoes}
    detalhes = []
    for sessao, fatos in por_sessao.items():
        for outra, outros_fatos in por_sessao.items():
            if sessao >= outra:
                continue
            # Contaminacao = mesma chave com o mesmo valor vindo de casos distintos
            # que nunca deveriam se cruzar (cada sessao recebeu textos diferentes).
            compartilhados = {
                chave
                for chave, valor in fatos.items()
                if chave in outros_fatos and outros_fatos[chave] == valor and chave == "requester_document"
            }
            if compartilhados:
                violacoes.contaminacao_entre_sessoes += 1
                detalhes.append({"sessao_a": sessao, "sessao_b": outra, "fatos": sorted(compartilhados)})
    return {"cross_session_contamination": violacoes.contaminacao_entre_sessoes, "detalhes": detalhes}


# ------------------------------------------------------------- inicializacao
async def _inventario(server: p.Server, criados: dict[str, Any]) -> dict[str, Any]:
    """Confere que tudo o que a POC declara realmente entrou no Parlant."""
    from parlant.core.canned_responses import CannedResponseStore
    from parlant.core.glossary import GlossaryStore
    from parlant.core.guidelines import GuidelineStore
    from parlant.core.journeys import JourneyStore
    from parlant.core.relationships import RelationshipStore

    container = server.container
    guidelines = await container[GuidelineStore].list_guidelines()
    journeys = await container[JourneyStore].list_journeys()
    canned = await container[CannedResponseStore].list_canned_responses()
    termos = await container[GlossaryStore].list_terms()
    relacionamentos = await container[RelationshipStore].list_relationships()

    # As condicoes de ativacao da journey viram guidelines proprias, criadas
    # pelo Parlant; sem esse mapa elas aparecem no rastro como id cru.
    mapear_ids(
        criados,
        [identificador for jornada in journeys for identificador in jornada.conditions],
    )

    esperado = {
        "guidelines": len(spec.GUIDELINES),
        "relationships": len(spec.RELATIONSHIPS),
        "journey_states": len(spec.JOURNEY["states"]),
        "tools": 5,
        "canned_responses": len(spec.CANNED_RESPONSES),
        "glossary_terms": len(spec.GLOSSARY),
    }
    carregado = {
        "guidelines": len(guidelines),
        "relationships": len(relacionamentos),
        "journeys": len(journeys),
        "journey_states": len(criados["journey_states"]),
        "tools": len(TOOLS_PERMITIDAS),
        "canned_responses": len(canned),
        "glossary_terms": len(termos),
    }
    faltando = {
        chave: (esperado[chave], carregado.get(chave))
        for chave in ("guidelines", "canned_responses", "glossary_terms", "journey_states")
        if carregado.get(chave, 0) < esperado[chave]
    }
    return {"esperado": esperado, "carregado": carregado, "faltando": faltando}


# ----------------------------------------------------------------- execucao
async def executar(quantidade: int, seed: int) -> dict[str, Any]:
    CONTROLE.reset(seed)
    inicio_processo = time.perf_counter()
    relatorio: dict[str, Any] = {
        "seed": seed,
        "conversas_pedidas": quantidade,
        "parlant_home": str(PARLANT_HOME),
        "cache_de_avaliacao": "limpo nesta execucao",
    }

    corpus = corpus_mod.gerar_corpus(quantidade, seed=seed)
    violacoes = Violacoes()
    turnos: list[ResultadoTurno] = []
    sessoes: list[str] = []
    inventario: dict[str, Any] = {}
    problemas: list[dict[str, Any]] = []
    inicializacao = -1.0

    async with p.Server(
        port=PORTA,
        nlp_service=synthetic_nlp_service,
        session_store="transient",
        customer_store="transient",
    ) as server:
        agente, criados = await build_agent(server)
        inventario = await _inventario(server, criados)

        async def esperar_servidor(base: str, limite_s: float = 180.0) -> bool:
            """Espera o /healthz responder.

            Espera propria em vez de `server.ready`: o evento do SDK depende do
            health-check interno do Parlant, que passa pelo mesmo caminho de
            rede do laboratorio. Com o poll aqui, a bateria nao fica refem
            desse detalhe e o tempo medido e o do servidor de fato no ar.
            """
            limite = time.perf_counter() + limite_s
            async with httpx.AsyncClient(trust_env=False, timeout=5.0) as cliente:
                while time.perf_counter() < limite:
                    try:
                        if (await cliente.get(f"{base}/healthz")).status_code == 200:
                            return True
                    except Exception:
                        pass
                    await asyncio.sleep(0.25)
            return False

        async def bateria() -> None:
            nonlocal inicializacao
            base_saude = f"http://127.0.0.1:{PORTA}"
            if not await esperar_servidor(base_saude):
                relatorio["erro_bateria"] = "servidor Parlant nao respondeu em /healthz"
                return
            inicializacao = time.perf_counter() - inicio_processo
            base = f"http://127.0.0.1:{PORTA}"
            print(f"Parlant (sintetico) pronto em {inicializacao:.1f}s — {len(corpus)} conversas")

            # Conversas sao independentes (uma sessao cada), entao rodam em
            # paralelo com limite. A avaliacao continua na ordem do corpus, para
            # que o relatorio nao dependa de quem terminou primeiro.
            limite_paralelo = asyncio.Semaphore(PARALELISMO)
            concluidas = 0

            async def uma(conversa: corpus_mod.Conversa):
                nonlocal concluidas
                async with limite_paralelo:
                    saida = await _rodar_conversa(base, agente.id, conversa)
                concluidas += 1
                if concluidas % 25 == 0:
                    print(f"  {concluidas}/{len(corpus)} conversas", flush=True)
                return saida

            executadas = await asyncio.gather(*(uma(c) for c in corpus))

            for conversa, (resultados, sessao) in zip(corpus, executadas):
                sessoes.append(sessao)
                for turno_corpus, resultado in zip(conversa.turnos, resultados):
                    turnos.append(resultado)
                    encontrados = _avaliar(turno_corpus, resultado, sessao, violacoes)
                    if encontrados:
                        problemas.append(
                            {
                                "conversa": conversa.identificador,
                                "categoria": turno_corpus.categoria,
                                "mensagem": turno_corpus.texto,
                                "resposta": resultado.resposta,
                                "problemas": encontrados,
                            }
                        )

            relatorio["isolamento"] = _checar_isolamento(sessoes, violacoes)
            relatorio["casamento_de_guidelines"] = cenarios_mod.metricas_de_casamento(turnos)

            # Cenarios dirigidos rodam depois e em sequencia: os modos de falha
            # alteram estado global do provider.
            print("cenarios dirigidos (relationships, journey, tools, falhas)...", flush=True)
            async with httpx.AsyncClient(base_url=base, timeout=120.0, trust_env=False) as cliente:

                async def abrir_sessao(titulo: str) -> str:
                    return await nova_sessao(cliente, agente.id, titulo)

                async def um_turno(sessao: str, texto: str) -> ResultadoTurno:
                    return await rodar_turno(
                        cliente, sessao, texto, "cenario_dirigido", "cenario",
                        TEMPO_MAXIMO_TURNO,
                    )

                relatorio["cenarios"] = await cenarios_mod.executar_cenarios(
                    um_turno, abrir_sessao
                )

        async def executar_bateria() -> None:
            import signal

            try:
                await bateria()
            except Exception as erro:  # a bateria nao pode travar o encerramento
                relatorio["erro_bateria"] = f"{type(erro).__name__}: {erro}"
            finally:
                # O servidor so comeca a servir no __aexit__ do `async with`;
                # por isso a bateria roda como tarefa e encerra o processo no fim.
                os.kill(os.getpid(), signal.SIGINT)

        asyncio.create_task(executar_bateria())

    relatorio.update(
        {
            "inicializacao_s": round(inicializacao, 2),
            "duracao_total_s": round(time.perf_counter() - inicio_processo, 2),
            "inventario": inventario,
            "conversas": len(corpus),
            "turnos": len(turnos),
            "turnos_com_erro": sum(1 for t in turnos if t.erro),
            "turnos_com_resposta": sum(1 for t in turnos if t.resposta),
            "categorias": sorted(corpus_mod.categorias_cobertas(corpus)),
            "violacoes": violacoes.as_dict(),
            "problemas": problemas[:50],
            "schemas": REGISTRO.resumo(),
            "chamadas_sinteticas": CONTROLE.chamadas,
            "embeddings_sinteticos": CONTROLE.embeddings,
            "guidelines_ativadas": _contar([g for t in turnos for g in t.guidelines]),
            "tools_chamadas": _contar([c["tool"] for t in turnos for c in t.tools]),
            "journey_estados": _contar([j for t in turnos for j in t.journey]),
        }
    )
    return relatorio


def _contar(itens: Sequence[str]) -> dict[str, int]:
    contagem: dict[str, int] = {}
    for item in itens:
        contagem[item] = contagem.get(item, 0) + 1
    return dict(sorted(contagem.items(), key=lambda par: -par[1]))


def rodar(quantidade: int = CONVERSAS, seed: int = SEED) -> dict[str, Any]:
    """Executa a bateria inteira sob o guarda de rede."""
    with NetworkGuard() as guarda:
        try:
            relatorio = asyncio.run(executar(quantidade, seed))
        except KeyboardInterrupt:
            relatorio = {"erro": "execucao interrompida"}
        relatorio["rede"] = guarda.resumo()
        relatorio["violacoes"] = relatorio.get("violacoes", {})
        relatorio["violacoes"]["chamadas_externas"] = guarda.external_calls
    return relatorio
