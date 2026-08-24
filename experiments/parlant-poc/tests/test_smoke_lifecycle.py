"""Regressões do ciclo de vida do smoke C1 (sem Gemini e sem servidor real)."""

from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SCRIPTS = RAIZ / "scripts"


def test_scripts_do_smoke_compilam_sem_consumir_cota() -> None:
    for nome in ("smoke_parlant.py", "serve_c1_price.py"):
        caminho = SCRIPTS / nome
        compile(caminho.read_text(encoding="utf-8"), str(caminho), "exec")


def test_smoke_separa_cliente_do_servidor_do_parlant() -> None:
    """Evita voltar ao deadlock do SDK 3.3.2.

    O servidor Parlant só começa a servir HTTP ao sair do bloco de configuração.
    Assim, o cliente do smoke deve ser um processo separado e não pode aguardar
    `server.ready` no mesmo processo de configuração.
    """
    smoke = (SCRIPTS / "smoke_parlant.py").read_text(encoding="utf-8")
    servidor = (SCRIPTS / "serve_c1_price.py").read_text(encoding="utf-8")

    assert "asyncio.create_subprocess_exec" in smoke
    assert "server.ready.wait()" not in smoke
    assert "process.terminate()" in smoke
    assert "async with p.Server(" in servidor


def test_c1_evitar_avaliacao_de_bootstrap_antes_do_http() -> None:
    """O C1 é um probe de turno real, não de classificação semântica.

    Sem um matcher explícito, o SDK 3.3.2 registra uma avaliação com Gemini ao
    sair do bloco de configuração e a API nunca chega a abrir sob quota baixa.
    """
    build = (RAIZ / "santana_parlant_poc" / "agent" / "build.py").read_text(encoding="utf-8")
    inicio = build.index("async def build_c1_price_agent")
    fim = build.index("\ndef _build_journey_states", inicio)
    c1 = build[inicio:fim]

    assert "matcher=p.Guideline.MATCH_ALWAYS" in c1


def test_teardown_por_sigterm_solicitado_nao_mascara_sucesso_do_probe() -> None:
    smoke = (SCRIPTS / "smoke_parlant.py").read_text(encoding="utf-8")

    assert "returncode == -signal.SIGTERM" in smoke
