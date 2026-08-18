"""Cache de indexacao por release (offline, sem Gemini, sem rede).

O run 32146735829 gastou 991,8s subindo o agente e refaria esse trabalho
identico na execucao seguinte. O `PARLANT_HOME` era limpo de proposito, porque
o `evaluation_cache.json` ja congelou a Journey uma vez.

Release imutavel muda onde fica a defesa: o cache vive em `<raiz>/<release_id>`,
e o id deriva do conteudo. Mudou algo material, muda o id, e o cache antigo nao
e nem consultado. Cache velho deixa de ser risco porque deixa de ser alcancavel.
"""

import json
from pathlib import Path

import pytest

from santana_parlant_poc import release


@pytest.fixture(autouse=True)
def _raiz_isolada(tmp_path, monkeypatch):
    monkeypatch.setenv("POC_RELEASE_ROOT", str(tmp_path / "releases"))
    yield


# ------------------------------------------------------------------ identidade
def test_release_id_deriva_do_conhecimento_e_da_configuracao():
    identificador = release.release_id()
    assert identificador.startswith("exu-1.0-")
    assert "+cfg-" in identificador
    assert release.release_id() == identificador, "o id tem de ser estavel"


def test_mudanca_material_na_configuracao_gera_release_nova(monkeypatch):
    """Uma canned response nova muda o indice — e precisa mudar o id."""
    from santana_parlant_poc.agent import spec

    antes = release.release_id()
    nova = (*spec.CANNED_RESPONSES, {"key": "X", "template": "texto novo", "signals": []})
    monkeypatch.setattr(spec, "CANNED_RESPONSES", nova)
    assert release.release_id() != antes


def test_mudanca_no_catalogo_oficial_gera_release_nova(tmp_path, monkeypatch):
    from santana_parlant_poc.gateway import catalogo_oficial

    antes = release.release_id()
    bruto = json.loads(catalogo_oficial.catalogo_path().read_text(encoding="utf-8"))
    bruto["entradas"] = bruto["entradas"][:-1]
    caminho = tmp_path / "exumacao.v1.json"
    caminho.write_text(json.dumps(bruto, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("SANTANA_CATALOGO_OFICIAL", str(caminho))
    catalogo_oficial.carregar.cache_clear()
    try:
        assert release.release_id() != antes
    finally:
        monkeypatch.delenv("SANTANA_CATALOGO_OFICIAL", raising=False)
        catalogo_oficial.carregar.cache_clear()


# ------------------------------------------------------- reuso e isolamento
def test_mesma_release_reaproveita_o_estado():
    primeira = release.preparar("rel-a")
    assert primeira.reaproveitada is False
    (primeira.home / "evaluation_cache.json").write_text("{}", encoding="utf-8")
    primeira.marcar_pronta()

    segunda = release.preparar("rel-a")
    assert segunda.reaproveitada is True
    assert segunda.home == primeira.home
    assert (segunda.home / "evaluation_cache.json").exists()


def test_release_diferente_nao_reaproveita_cache_anterior():
    primeira = release.preparar("rel-a")
    (primeira.home / "evaluation_cache.json").write_text("{}", encoding="utf-8")
    primeira.marcar_pronta()

    outra = release.preparar("rel-b")
    assert outra.reaproveitada is False
    assert outra.home != primeira.home
    assert not (outra.home / "evaluation_cache.json").exists()


def test_limpo_reconstroi_do_zero():
    primeira = release.preparar("rel-a")
    (primeira.home / "evaluation_cache.json").write_text("{}", encoding="utf-8")
    primeira.marcar_pronta()

    fria = release.preparar("rel-a", limpo=True)
    assert fria.reaproveitada is False
    assert not (fria.home / "evaluation_cache.json").exists()


# --------------------------------------------------------------- fail-safe
def test_cache_sem_marcador_falha_fechado():
    home = release.raiz_das_releases() / "rel-orfa"
    home.mkdir(parents=True)
    (home / "evaluation_cache.json").write_text("{}", encoding="utf-8")
    with pytest.raises(release.CacheDeReleaseInvalido, match="origem desconhecida"):
        release.preparar("rel-orfa")


def test_marcador_corrompido_falha_fechado():
    primeira = release.preparar("rel-a")
    primeira.marcar_pronta()
    (primeira.home / release.MARCADOR).write_text("{isso nao e json", encoding="utf-8")
    with pytest.raises(release.CacheDeReleaseInvalido, match="ilegivel"):
        release.preparar("rel-a")


def test_cache_de_outra_release_falha_fechado():
    primeira = release.preparar("rel-a")
    primeira.marcar_pronta()
    marcador = json.loads((primeira.home / release.MARCADOR).read_text(encoding="utf-8"))
    marcador["release_id"] = "rel-outra"
    (primeira.home / release.MARCADOR).write_text(json.dumps(marcador), encoding="utf-8")
    with pytest.raises(release.CacheDeReleaseInvalido, match="pertence a release"):
        release.preparar("rel-a")


def test_construcao_interrompida_falha_fechado():
    """Release que nunca foi publicada tem indice incompleto."""
    primeira = release.preparar("rel-a")
    (primeira.home / "evaluation_cache.json").write_text("{}", encoding="utf-8")
    # sem `marcar_pronta()`: a construcao anterior morreu no meio
    with pytest.raises(release.CacheDeReleaseInvalido, match="nao terminou"):
        release.preparar("rel-a")


# ------------------------------------------------------------------ rollback
def test_releases_publicadas_ficam_listadas_para_rollback():
    for identificador in ("rel-1", "rel-2"):
        release.preparar(identificador).marcar_pronta()
    inacabada = release.preparar("rel-3")
    assert inacabada.estado == release.ESTADO_CONSTRUINDO

    disponiveis = release.releases_disponiveis()
    assert disponiveis == ["rel-1", "rel-2"], "so release publicada serve de rollback"


# ---------------------------------------------- o cache nao e autoridade
def test_o_cache_nao_responde_nada_de_autoridade():
    """Nenhuma resposta oficial pode sair daqui: isso e trabalho do Gateway."""
    fonte = Path(release.__file__).read_text(encoding="utf-8")
    for proibido in ("PRECO", "DOCUMENTOS", "valor", "tarifa"):
        assert proibido not in fonte.split('"""', 2)[2], proibido
