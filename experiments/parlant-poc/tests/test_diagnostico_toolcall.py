"""Testes da captura de diagnostico do tool calling (offline, sem Gemini).

A instrumentacao so observa: registra prompt, tool avaliada, schema efetivo e a
saida bruta do modelo. Estes testes cobrem o que pode dar errado nela — a
extracao sobre um prompt real do ToolCaller e a redacao de segredo — e travam a
regra de que nada aqui altera argumento ou validacao.
"""

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

RAIZ = Path(__file__).resolve().parent.parent


def _carregar_smoke() -> Any:
    """Importa o script de smoke sem executa-lo."""
    caminho = RAIZ / "scripts" / "full_poc_smoke.py"
    spec = importlib.util.spec_from_file_location("full_poc_smoke_para_teste", caminho)
    assert spec and spec.loader
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


SMOKE = _carregar_smoke()

# Trecho fiel de um prompt real do ToolCaller (capturado de uma execucao do
# Parlant 3.3.2 com a POC completa), usado para exercitar a extracao.
PROMPT_REAL = '''
TOOL TO EVALUATE:
-----------------
Name: built-in:registrar_finalidade_exumacao
Description: Registra no caso: Finalidade da exumacao.
Parameters: {
  "finalidade": {
    "type": "string",
    "enum": [
      "TRANSPORTE",
      "OSSUARIO",
      "CREMACAO",
      "OUTRA"
    ]
  }
}
Required parameters: ['finalidade']
Optional parameters: []
'''


def test_extrai_a_tool_avaliada_do_prompt_real():
    assert SMOKE._tool_avaliada(PROMPT_REAL) == "built-in:registrar_finalidade_exumacao"


def test_extrai_o_bloco_de_parametros_com_o_enum():
    bloco = SMOKE._bloco_de_parametros(PROMPT_REAL)
    assert bloco is not None
    dados = json.loads(bloco)
    assert dados["finalidade"]["enum"][0] == "TRANSPORTE"
    assert "CREMACAO" in dados["finalidade"]["enum"]


def test_extracao_nao_quebra_em_prompt_sem_a_secao():
    assert SMOKE._tool_avaliada("prompt qualquer") is None
    assert SMOKE._bloco_de_parametros("prompt qualquer") is None


# ------------------------------------------------------------------- segredo
def test_redacao_remove_a_chave_do_ambiente(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "chave-secreta-do-laboratorio")
    texto = "authorization: chave-secreta-do-laboratorio no meio do prompt"
    limpo = SMOKE._sem_segredo(texto)
    assert "chave-secreta-do-laboratorio" not in limpo
    assert "***REDIGIDO***" in limpo


def test_redacao_pega_chave_google_mesmo_sem_env(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    limpo = SMOKE._sem_segredo("x-goog-api-key: AIzaSyD-exemplo_De_Chave_123456")
    assert "AIzaSy" not in limpo
    assert "***REDIGIDO***" in limpo


def test_redacao_preserva_o_conteudo_util():
    limpo = SMOKE._sem_segredo(PROMPT_REAL)
    assert "TRANSPORTE" in limpo and "registrar_finalidade_exumacao" in limpo


# ----------------------------------------------------- schema efetivo captado
def test_schema_efetivo_traz_o_dominio_das_tools():
    schema = SMOKE._schema_efetivo_das_tools()
    finalidade = schema["registrar_finalidade_exumacao"]["parameters"]["finalidade"]
    assert finalidade.get("enum"), finalidade
    assert schema["registrar_jazigo_de_destino"]["parameters"]["jazigo"].get("description")


def test_schema_efetivo_mostra_a_consulta_sem_parametro():
    """A consulta de preco nao tem argumento: nao ha o que faltar."""
    schema = SMOKE._schema_efetivo_das_tools()
    assert schema["consultar_preco_exumacao"]["parameters"] == {}
    assert schema["consultar_preco_exumacao"]["required"] == []


# --------------------------------------------------- a instrumentacao so observa
def test_apenas_os_schemas_de_tool_sao_capturados():
    assert SMOKE.SCHEMAS_DE_TOOL == {
        "SingleToolBatchSchema",
        "NonConsequentialToolBatchSchema",
    }


def test_selecao_de_conversas_por_ambiente(monkeypatch):
    """`FULL_POC_CONVERSAS=C1-preco` roda uma so — sem mudar a lista de casos."""
    monkeypatch.setenv("FULL_POC_CONVERSAS", "C1-preco")
    modulo = _carregar_smoke()
    assert modulo.SELECIONADAS == ["C1-preco"]
    previstas = [c for c in modulo.CONVERSAS if c["id"] in modulo.SELECIONADAS]
    assert [c["id"] for c in previstas] == ["C1-preco"]
    # A definicao das 5 conversas continua intacta.
    assert len(modulo.CONVERSAS) == 5


def test_a_captura_nao_toca_na_regra_do_marcador_de_ausencia():
    """`<<__missing__>>` continua sendo decidido pelo Parlant, nao pela POC."""
    fonte = (RAIZ / "scripts" / "full_poc_smoke.py").read_text(encoding="utf-8")
    assert "__missing__" not in fonte, (
        "o smoke nao pode interpretar nem completar o marcador de ausencia: "
        "essa decisao e do Parlant"
    )


@pytest.mark.parametrize("proibido", ["arguments[", "args[", "setdefault("])
def test_a_instrumentacao_nao_escreve_argumento(proibido):
    """Nada na captura pode preencher argumento de tool."""
    fonte = (RAIZ / "scripts" / "full_poc_smoke.py").read_text(encoding="utf-8")
    trecho = fonte[fonte.index("class GeradorObservado") : fonte.index("class ServicoObservado")]
    assert proibido not in trecho


# ------------------------------- captura da avaliacao real (passiva, sem efeito)
def _avaliar_pelo_parlant(nome_tool: str, args: dict):
    """Roda o avaliador real do Parlant com a instrumentacao instalada."""
    from parlant.core.engines.alpha.tool_calling.single_tool_batch import (
        NonConsequentialToolCallEvaluation,
        SingleToolBatch,
    )
    from parlant.core.tools import ToolId

    from santana_parlant_poc.agent.tools import ALL_TOOLS

    tool = next(t.tool for t in ALL_TOOLS if t.tool.name == nome_tool)
    tool_id = ToolId(service_name="built-in", tool_name=nome_tool)

    class _Lote:
        _evaluate_non_consequential_tool_calls = (
            SingleToolBatch._evaluate_non_consequential_tool_calls
        )
        _is_tool_call_already_staged = SingleToolBatch._is_tool_call_already_staged

        class _context:  # noqa: N801
            staged_events: list = []

        class _logger:  # noqa: N801
            @staticmethod
            def debug(*_a, **_k) -> None: ...

            @staticmethod
            def warning(*_a, **_k) -> None: ...

    return _Lote()._evaluate_non_consequential_tool_calls(
        output=[NonConsequentialToolCallEvaluation(args=args)],
        candidate_descriptor=(tool_id, tool, []),
    )


def test_a_instrumentacao_devolve_o_resultado_original_intacto():
    """O wrapper observa; quem decide continua sendo o metodo do Parlant."""
    from parlant.core.engines.alpha.tool_calling import single_tool_batch as lote

    original = lote.SingleToolBatch._evaluate_non_consequential_tool_calls
    antes = _avaliar_pelo_parlant("registrar_finalidade_exumacao", {"finalidade": "TRANSPORTE"})
    SMOKE.instrumentar_avaliacao_de_tool_call()
    try:
        SMOKE.AVALIACOES_DE_TOOL.clear()
        depois = _avaliar_pelo_parlant(
            "registrar_finalidade_exumacao", {"finalidade": "TRANSPORTE"}
        )
        chamadas_antes, _, faltando_antes, _ = antes
        chamadas_depois, _, faltando_depois, _ = depois
        assert [c.arguments for c in chamadas_antes] == [c.arguments for c in chamadas_depois]
        assert len(faltando_antes) == len(faltando_depois)

        captura = SMOKE.AVALIACOES_DE_TOOL[-1]
        assert captura["tool"] == "registrar_finalidade_exumacao"
        assert captura["argumentos_apos_parsing"] == [{"finalidade": "TRANSPORTE"}]
        assert captura["tool_calls_produzidas"][0]["arguments"] == {"finalidade": "TRANSPORTE"}
        assert captura["validacao"]["faltando"] == []
    finally:
        lote.SingleToolBatch._evaluate_non_consequential_tool_calls = original


def test_a_instrumentacao_nao_completa_argumento_ausente():
    """Com o marcador, a recusa do Parlant continua sendo recusa."""
    from parlant.core.engines.alpha.tool_calling import single_tool_batch as lote

    original = lote.SingleToolBatch._evaluate_non_consequential_tool_calls
    SMOKE.instrumentar_avaliacao_de_tool_call()
    try:
        SMOKE.AVALIACOES_DE_TOOL.clear()
        chamadas, _, faltando, _ = _avaliar_pelo_parlant(
            "registrar_finalidade_exumacao", {"finalidade": "<<__missing__>>"}
        )
        assert not chamadas
        assert any(d.parameter == "finalidade" for d in faltando)

        captura = SMOKE.AVALIACOES_DE_TOOL[-1]
        assert captura["tool_calls_produzidas"] == []
        assert captura["validacao"]["faltando"][0]["parametro"] == "finalidade"
        # A captura registra o marcador como o modelo o mandou, sem traduzir.
        assert captura["argumentos_apos_parsing"] == [{"finalidade": "<<__missing__>>"}]
    finally:
        lote.SingleToolBatch._evaluate_non_consequential_tool_calls = original


def test_a_consulta_sem_argumento_aparece_como_chamada_completa():
    """C1 hoje: a tool de preco nao tem argumento, entao `{}` e a chamada inteira."""
    from parlant.core.engines.alpha.tool_calling import single_tool_batch as lote

    original = lote.SingleToolBatch._evaluate_non_consequential_tool_calls
    SMOKE.instrumentar_avaliacao_de_tool_call()
    try:
        SMOKE.AVALIACOES_DE_TOOL.clear()
        chamadas, _, faltando, _ = _avaliar_pelo_parlant("consultar_preco_exumacao", {})
        assert len(chamadas) == 1 and not faltando
        captura = SMOKE.AVALIACOES_DE_TOOL[-1]
        assert captura["tool_calls_produzidas"][0]["arguments"] == {}
        assert captura["validacao"]["faltando"] == []
    finally:
        lote.SingleToolBatch._evaluate_non_consequential_tool_calls = original


def test_o_diagnostico_continua_sem_mencionar_o_marcador_no_codigo():
    """A regra nao mudou: quem interpreta `<<__missing__>>` e o Parlant."""
    fonte = (RAIZ / "scripts" / "full_poc_smoke.py").read_text(encoding="utf-8")
    assert "__missing__" not in fonte


@pytest.mark.parametrize("proibido", ["arguments[", "args[", "setdefault(", "= chamadas", "= faltando"])
def test_a_captura_da_avaliacao_nao_escreve_no_resultado(proibido):
    fonte = (RAIZ / "scripts" / "full_poc_smoke.py").read_text(encoding="utf-8")
    trecho = fonte[
        fonte.index("def _registrar_avaliacao") : fonte.index("class GeradorObservado")
    ]
    assert proibido not in trecho
