"""Release imutavel do agente e cache de indexacao por `release_id`.

O run 32146735829 gastou 991,8s so para subir o agente — `Evaluating entities`
sozinho levou 15m17s — e refaria esse trabalho identico na execucao seguinte. O
`PARLANT_HOME` era limpo a cada run de proposito: o `evaluation_cache.json` ja
tinha congelado a Journey uma vez, e limpar era a unica defesa disponivel.

Com release imutavel a defesa muda de lugar. O cache passa a viver em
`<raiz>/<release_id>`, e o `release_id` deriva do **conteudo** — catalogo
oficial, catalogos de dominio e a configuracao do agente. Mudou qualquer coisa
material, muda o id, e o cache antigo nao e nem consultado. Cache velho deixa de
ser risco porque deixa de ser alcancavel.

O cache e otimizacao de indexacao do Parlant. **Nao e fonte de autoridade**:
nada aqui responde preco, documento, prazo ou regra.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ESTADO_CONSTRUINDO = "construindo"
ESTADO_PRONTA = "pronta"

MARCADOR = "release.json"


class CacheDeReleaseInvalido(RuntimeError):
    """Cache ausente do esperado, corrompido ou de outra release.

    Falha fechada de proposito: rodar sobre um indice que nao se sabe de onde
    veio e pior que reindexar.
    """


def _fingerprint_da_configuracao() -> str:
    """Hash do que, mudando, exige reindexacao.

    Guidelines, relationships, journey, canned responses, glossario e o schema
    de cada tool. Uma canned response nova muda o indice; uma linha de comentario
    no codigo, nao.
    """
    from .agent import spec
    from .agent import tools as agent_tools

    material = {
        "agent": spec.AGENT_NAME,
        "description": spec.AGENT_DESCRIPTION,
        "guidelines": [
            {k: g.get(k) for k in ("key", "condition", "action", "tools", "canned_responses", "criticality")}
            for g in spec.GUIDELINES
        ],
        "relationships": list(spec.RELATIONSHIPS),
        "journey": {
            "title": spec.JOURNEY["title"],
            "description": spec.JOURNEY["description"],
            "conditions": list(spec.JOURNEY["conditions"]),
            "states": [dict(e) for e in spec.JOURNEY["states"]],
        },
        "canned_responses": [dict(c) for c in spec.CANNED_RESPONSES],
        "glossary": [dict(t) for t in spec.GLOSSARY],
        "tools": {
            entrada.tool.name: {
                "required": list(entrada.tool.required),
                "parameters": {
                    nome: dict(descritor)
                    for nome, (descritor, _) in entrada.tool.parameters.items()
                },
            }
            for entrada in agent_tools.ALL_TOOLS
        },
    }
    bruto = json.dumps(material, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(bruto.encode("utf-8")).hexdigest()[:12]


def release_id() -> str:
    """Identidade da release: conhecimento oficial + configuracao do agente."""
    from .gateway import catalogo_oficial

    return f"{catalogo_oficial.release_id()}+cfg-{_fingerprint_da_configuracao()}"


def raiz_das_releases() -> Path:
    override = os.environ.get("POC_RELEASE_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return Path(tempfile.gettempdir()) / "santana-parlant-releases"


@dataclass(frozen=True)
class Release:
    release_id: str
    home: Path
    estado: str
    reaproveitada: bool

    @property
    def pronta(self) -> bool:
        return self.estado == ESTADO_PRONTA

    def marcar_pronta(self) -> None:
        """Publica a release. Depois disto o conteudo nao deve mudar."""
        _gravar_marcador(self.home, self.release_id, ESTADO_PRONTA)

    def as_dict(self) -> dict[str, Any]:
        return {
            "release_id": self.release_id,
            "home": str(self.home),
            "estado": self.estado,
            "reaproveitada": self.reaproveitada,
        }


def _gravar_marcador(home: Path, identificador: str, estado: str) -> None:
    (home / MARCADOR).write_text(
        json.dumps(
            {
                "release_id": identificador,
                "estado": estado,
                "atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _ler_marcador(home: Path) -> dict[str, Any]:
    caminho = home / MARCADOR
    if not caminho.exists():
        raise CacheDeReleaseInvalido(
            f"{home} tem conteudo mas nao tem {MARCADOR}: origem desconhecida."
        )
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as erro:
        raise CacheDeReleaseInvalido(f"{MARCADOR} ilegivel em {home}: {erro}") from erro
    if not isinstance(dados, dict) or "release_id" not in dados or "estado" not in dados:
        raise CacheDeReleaseInvalido(f"{MARCADOR} incompleto em {home}.")
    return dados


def preparar(identificador: str | None = None, *, limpo: bool = False) -> Release:
    """Devolve o `PARLANT_HOME` desta release, reaproveitando o indice quando ha.

    `limpo=True` reconstroi do zero — e o que os testes usam quando querem medir
    cold start ou garantir isolamento.
    """
    identificador = identificador or release_id()
    home = raiz_das_releases() / identificador

    if limpo and home.exists():
        shutil.rmtree(home)

    if home.exists() and any(home.iterdir()):
        marcador = _ler_marcador(home)
        if marcador["release_id"] != identificador:
            # Nunca compartilhar cache entre releases diferentes.
            raise CacheDeReleaseInvalido(
                f"{home} pertence a release {marcador['release_id']!r}, nao a {identificador!r}."
            )
        if marcador["estado"] != ESTADO_PRONTA:
            raise CacheDeReleaseInvalido(
                f"release {identificador} ficou em estado {marcador['estado']!r}: "
                "a construcao anterior nao terminou. Reconstrua com limpo=True."
            )
        return Release(identificador, home, ESTADO_PRONTA, reaproveitada=True)

    home.mkdir(parents=True, exist_ok=True)
    _gravar_marcador(home, identificador, ESTADO_CONSTRUINDO)
    return Release(identificador, home, ESTADO_CONSTRUINDO, reaproveitada=False)


def releases_disponiveis() -> list[str]:
    """Releases ja publicadas, para rollback apontar para a anterior."""
    raiz = raiz_das_releases()
    if not raiz.exists():
        return []
    prontas = []
    for caminho in sorted(raiz.iterdir()):
        if not caminho.is_dir():
            continue
        try:
            if _ler_marcador(caminho)["estado"] == ESTADO_PRONTA:
                prontas.append(caminho.name)
        except CacheDeReleaseInvalido:
            continue
    return prontas


def id_isolado() -> str:
    """Calcula o `release_id` num subprocesso.

    `release_id()` importa a configuracao do agente, e essa importacao arrasta o
    Parlant — que congela `PARLANT_HOME` num modulo-constante no momento do
    import (`parlant/bin/server.py`). Quem precisa do id **antes** de escolher o
    home, como o smoke real, nao pode pagar esse import no proprio processo.

    E tambem o formato que um build de verdade tem: calcular a identidade da
    release e so entao apontar o runtime para o diretorio dela.
    """
    import subprocess
    import sys

    raiz = Path(__file__).resolve().parent.parent
    processo = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; sys.path.insert(0, %r);"
            "from santana_parlant_poc import release; print(release.release_id())" % str(raiz),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    identificador = processo.stdout.strip().splitlines()[-1] if processo.stdout.strip() else ""
    if processo.returncode != 0 or not identificador:
        raise RuntimeError(
            f"nao foi possivel calcular o release_id (codigo {processo.returncode}): "
            f"{processo.stderr[-500:]}"
        )
    return identificador
