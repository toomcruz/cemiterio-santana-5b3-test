"""Invariantes do perfil de sandbox do laboratorio (offline, sem Nono).

A validacao canonica e `nono profile validate` (e, sem Nono instalado,
`nono/validar_perfil.py` contra o schema publicado). Estes testes cobrem outra
coisa: as promessas que o perfil faz para esta POC especificamente — escrita so
no laboratorio, rede negada, nenhuma chave no ambiente — que nenhum schema
generico consegue verificar.

Se alguem alargar o perfil sem perceber, e aqui que a suite reclama.
"""

import json
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PERFIL = RAIZ / "nono" / "santana-parlant-lab.jsonc"

# Mesma remocao de comentarios usada por `nono/validar_perfil.py`.
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "validar_perfil", RAIZ / "nono" / "validar_perfil.py"
)
assert _spec and _spec.loader
_validador = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_validador)

DADOS = json.loads(_validador.sem_comentarios(PERFIL.read_text(encoding="utf-8")))


# ------------------------------------------------------------------ filesystem
def test_a_unica_escrita_e_o_laboratorio():
    escrita = DADOS["filesystem"].get("allow", []) + DADOS["filesystem"].get("write", [])
    assert escrita == ["$WORKDIR/experiments/parlant-poc"], (
        "o perfil so pode conceder escrita ao laboratorio; qualquer outro caminho "
        f"aqui e um alargamento: {escrita}"
    )


def test_leitura_cobre_o_catalogo_autoritativo():
    """`domain/catalog.py` le a raiz do repo + `santana-conversation-domain/`."""
    assert "$WORKDIR/santana-conversation-domain" in DADOS["filesystem"]["read"]


@pytest.mark.parametrize(
    "caminho",
    [
        "$WORKDIR/.git",
        "$WORKDIR/.github",
        "$WORKDIR/database",
        "$WORKDIR/edge-functions",
        "$WORKDIR/contracts",
        "~/.config/gh",
        "~/.claude",
    ],
)
def test_caminhos_de_producao_e_de_credencial_ficam_negados(caminho):
    assert caminho in DADOS["filesystem"]["deny"]


def test_o_cwd_do_lancamento_nao_e_concedido():
    """`workdir.access` diferente de `none` daria o repositorio inteiro."""
    assert DADOS["workdir"]["access"] == "none"


# ---------------------------------------------------------------------- rede
def test_rede_negada_por_padrao():
    assert DADOS["network"]["block"] is True
    # Uma excecao de porta escrita no perfil valeria para toda execucao; o
    # loopback do PluginServer entra por `--open-port` no `lab.sh`, alvo a alvo.
    assert "open_port" not in DADOS["network"]
    assert "allow_domain" not in DADOS["network"]
    assert "network_profile" not in DADOS["network"]
    assert "credentials" not in DADOS["network"]


# ------------------------------------------------------------------- segredos
@pytest.mark.parametrize(
    "variavel",
    ["GEMINI_API_KEY", "PARLANT", "GOOGLE_*", "GH_*", "GITHUB_*",
     "SUPABASE_*", "N8N_*", "W_API_*", "WAPI_*", "VERCEL_*", "AWS_*"],
)
def test_variavel_de_segredo_negada(variavel):
    assert variavel in DADOS["environment"]["deny_vars"]


def test_allow_vars_e_uma_lista_fechada_sem_curinga_geral():
    permitidas = DADOS["environment"]["allow_vars"]
    assert permitidas, "allow_vars vazio significa 'herda tudo'"
    assert "*" not in permitidas
    for nome in permitidas:
        assert not nome.startswith("GEMINI"), nome
        assert not nome.startswith("GOOGLE"), nome


def test_o_perfil_nao_carrega_nenhum_segredo_literal():
    texto = PERFIL.read_text(encoding="utf-8")
    formatos = re.compile(
        r"AIza[0-9A-Za-z_\-]{30,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}"
    )
    assert not formatos.search(texto)
    assert "set_vars" not in texto or "API_KEY" not in json.dumps(
        DADOS["environment"].get("set_vars", {})
    )


def test_parlant_home_nao_e_fixado_no_perfil():
    """Fixar `PARLANT_HOME` reaproveitaria o `evaluation_cache.json` entre runs.

    Foi esse cache velho que congelou a Journey no laboratorio sintetico. Os
    scripts criam o home com `tempfile.mkdtemp()`; o perfil so redireciona o
    `TMPDIR` para dentro do laboratorio, porque `/tmp` nao e concedido.
    """
    set_vars = DADOS["environment"]["set_vars"]
    assert "PARLANT_HOME" not in set_vars
    assert set_vars["TMPDIR"].startswith("$WORKDIR/experiments/parlant-poc")


# ------------------------------------------------------------------ expansao
def test_o_perfil_so_usa_variaveis_que_o_nono_expande():
    """`${REPO}` e `$QUALQUER_COISA` viram caminho literal e concedem nada."""
    assert _validador.variaveis_desconhecidas(DADOS) == []


def test_o_wrapper_recusa_rodar_fora_da_raiz_do_repositorio():
    """`$WORKDIR` e o cwd do lancamento: rodar de outro lugar concede errado."""
    script = (RAIZ / "nono" / "lab.sh").read_text(encoding="utf-8")
    assert "rode a partir da raiz do repositorio" in script
    assert "exit 2" in script


# ------------------------------------------- o filtro de ambiente, aplicado
_spec_amb = importlib.util.spec_from_file_location(
    "ambiente_do_perfil", RAIZ / "nono" / "ambiente_do_perfil.py"
)
assert _spec_amb and _spec_amb.loader
_ambiente = importlib.util.module_from_spec(_spec_amb)
_spec_amb.loader.exec_module(_ambiente)

# Um ambiente de CI realista: tudo que nao pode passar, mais o que precisa.
AMBIENTE_SUJO = {
    "PATH": "/usr/bin",
    "HOME": "/home/lab",
    "LANG": "pt_BR.UTF-8",
    "GEMINI_API_KEY": "AIzaSyD-nao-e-uma-chave-real-so-formato",
    "PARLANT": "AIzaSyD-nao-e-uma-chave-real-so-formato",
    "GOOGLE_APPLICATION_CREDENTIALS": "/x/y.json",
    "GH_TOKEN": "ghp_naoEUmTokenRealSoFormato0000",
    "GITHUB_TOKEN": "ghp_naoEUmTokenRealSoFormato0000",
    "ANTHROPIC_API_KEY": "sk-nao-e-uma-chave-real-so-formato",
    "AWS_SECRET_ACCESS_KEY": "x",
    "SUPABASE_SERVICE_ROLE_KEY": "x",
    "N8N_ENCRYPTION_KEY": "x",
    "W_API_TOKEN": "x",
    "VERCEL_TOKEN": "x",
    "HTTPS_PROXY": "http://proxy:8080",
    "https_proxy": "http://proxy:8080",
    "SYNTHETIC_CONVERSATIONS": "20",
}


def test_o_filtro_de_ambiente_derruba_todo_segredo():
    limpo = _ambiente.ambiente_filtrado(AMBIENTE_SUJO)
    vazou = [n for n in limpo if n in AMBIENTE_SUJO and n not in ("PATH", "HOME", "LANG", "SYNTHETIC_CONVERSATIONS")]
    assert vazou == [], f"variaveis que nao podiam passar: {vazou}"


def test_o_filtro_preserva_o_que_o_laboratorio_precisa():
    limpo = _ambiente.ambiente_filtrado(AMBIENTE_SUJO)
    assert limpo["PATH"] == "/usr/bin"
    assert limpo["SYNTHETIC_CONVERSATIONS"] == "20"
    assert limpo["TMPDIR"].endswith("experiments/parlant-poc/.nono-tmp")


def test_deny_vence_allow_mesmo_com_prefixo_permitido():
    """`POC_*` esta em allow_vars; um `POC_GEMINI_API_KEY` ainda assim nao passa
    se alguem o adicionar ao deny — o teste trava a ordem de precedencia."""
    limpo = _ambiente.ambiente_filtrado({"POC_GEMINI_MODEL": "x", "GEMINI_API_KEY": "y"})
    assert limpo.get("POC_GEMINI_MODEL") == "x"
    assert "GEMINI_API_KEY" not in limpo


def test_as_portas_do_wrapper_batem_com_os_defaults_dos_scripts():
    """`--open-port` de porta errada = servidor sobe e ninguem conecta.

    O sintoma seria um timeout de turno, que parece problema do Parlant e nao
    do sandbox. Por isso a lista do wrapper e conferida contra o default de
    cada script.
    """
    script = (RAIZ / "nono" / "lab.sh").read_text(encoding="utf-8")
    declaradas = {int(p) for p in re.search(r"PORTAS=\(([^)]*)\)", script).group(1).split()}

    def _default(caminho: str, variavel: str) -> int:
        fonte = (RAIZ / caminho).read_text(encoding="utf-8")
        return int(re.search(rf'{variavel}", "(\d+)"', fonte).group(1))

    sintetica = _default("santana_parlant_poc/synthetic/runner.py", "SYNTHETIC_PORT")
    determinismo = _default("scripts/check_determinism.py", "SYNTHETIC_PORT")
    inspecao = _default("scripts/inspect_tool_schema.py", "INSPECT_PORT")

    # `check_determinism` roda duas vezes: `porta` e `porta + 1`.
    necessarias = {sintetica, determinismo, determinismo + 1, inspecao}
    assert necessarias <= declaradas, f"faltam portas no lab.sh: {necessarias - declaradas}"
