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
Name: built-in:consultar_base_autoritativa
Description: Consulta a base fechada do Cemiterio Santana sobre um ponto do atendimento.
Parameters: {
  "assunto": {
    "type": "string",
    "enum": [
      "PRECO",
      "DOCUMENTOS",
      "PRAZO",
      "PROCEDIMENTO_ADMINISTRATIVO",
      "ASSINATURA_EXUMACAO",
      "JAZIGO_DESTINO",
      "OSSUARIO",
      "RESTOS_JA_EXUMADOS"
    ]
  }
}
Required parameters: ['assunto']
Optional parameters: []
'''


def test_extrai_a_tool_avaliada_do_prompt_real():
    assert SMOKE._tool_avaliada(PROMPT_REAL) == "built-in:consultar_base_autoritativa"


def test_extrai_o_bloco_de_parametros_com_o_enum():
    bloco = SMOKE._bloco_de_parametros(PROMPT_REAL)
    assert bloco is not None
    dados = json.loads(bloco)
    assert dados["assunto"]["enum"][0] == "PRECO"
    assert "DOCUMENTOS" in dados["assunto"]["enum"]


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
    assert "PRECO" in limpo and "consultar_base_autoritativa" in limpo


# ----------------------------------------------------- schema efetivo captado
def test_schema_efetivo_traz_o_dominio_das_tools():
    schema = SMOKE._schema_efetivo_das_tools()
    assunto = schema["consultar_base_autoritativa"]["parameters"]["assunto"]
    assert assunto.get("enum"), assunto
    assert schema["registrar_fato"]["parameters"]["fato"].get("enum")
    assert schema["registrar_fato"]["parameters"]["valor"].get("description")


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
