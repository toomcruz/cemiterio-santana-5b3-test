"""As cinco provas baratas que precisam rodar DENTRO do sandbox.

Uma politica de sandbox so vale se alguem a exercitar de dentro. Este script e
o "de dentro": ele tenta fazer o que o perfil promete impedir e falha se algo
funcionar. As tres provas caras (suite offline, inspecao do schema real e
bateria sintetica) sao comandos proprios, orquestrados por `nono/lab.sh`.

Regra desta POC vale aqui tambem: nada de valor de variavel de ambiente e
impresso. O relatorio diz "existe uma variavel com cara de chave", nunca a
chave.

Uso:
    python nono/validar_sandbox.py [--json relatorio.json]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parent.parent

# Nomes que nunca podem chegar ao laboratorio.
NOMES_PROIBIDOS = re.compile(
    r"^(GEMINI_API_KEY|PARLANT|GOOGLE_.*|ANTHROPIC_.*|CLAUDE_.*|OPENAI_.*|"
    r"AZURE_.*|AWS_.*|GCP_.*|GH_.*|GITHUB_.*|SUPABASE_.*|N8N_.*|W_?API_.*|"
    r"VERCEL_.*|HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$"
)
# Formatos de segredo, para o caso de a chave chegar com outro nome.
FORMATOS_DE_SEGREDO = re.compile(
    r"AIza[0-9A-Za-z_\-]{30,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}"
)


@dataclass
class Prova:
    numero: int
    titulo: str
    passou: bool = False
    detalhes: list[str] = field(default_factory=list)

    def anota(self, texto: str) -> None:
        self.detalhes.append(texto)


def _erro_de_permissao(exc: BaseException) -> bool:
    """Distingue "o sandbox barrou" de "o arquivo nao existe"."""
    return isinstance(exc, PermissionError) or getattr(exc, "errno", None) in (1, 13)


# ------------------------------------------------------------------ prova 1
def prova_le_o_laboratorio() -> Prova:
    prova = Prova(1, "o agente le o laboratorio")
    obrigatorios = [
        LAB / "santana_parlant_poc" / "agent" / "tools.py",
        LAB / "tests" / "test_tool_schema_integration.py",
        LAB / "scripts" / "inspect_tool_schema.py",
        REPO / "santana-conversation-domain",
    ]
    faltando = []
    for caminho in obrigatorios:
        try:
            if caminho.is_dir():
                next(iter(caminho.iterdir()), None)
            else:
                caminho.read_bytes()
        except OSError as exc:
            faltando.append(f"{caminho}: {type(exc).__name__}")
    # Escrita: o laboratorio e o unico lugar onde ela pode funcionar.
    sonda = LAB / ".nono-tmp" / "sonda-de-escrita.txt"
    try:
        sonda.parent.mkdir(parents=True, exist_ok=True)
        sonda.write_text("ok", encoding="utf-8")
        sonda.unlink()
        prova.anota("escrita no laboratorio: OK")
    except OSError as exc:
        faltando.append(f"escrita em {sonda}: {type(exc).__name__}")

    prova.passou = not faltando
    prova.detalhes += faltando or [f"leitura de {len(obrigatorios)} caminhos do dominio: OK"]
    return prova


# ------------------------------------------------------------------ prova 2
def prova_executa_python() -> Prova:
    prova = Prova(2, "o agente executa Python e importa a POC e o Parlant")
    prova.anota(f"python {sys.version.split()[0]} em {sys.executable}")
    try:
        sys.path.insert(0, str(LAB))
        import parlant.sdk  # noqa: F401
        import pytest  # noqa: F401

        from santana_parlant_poc.agent.tools import ALL_TOOLS

        import importlib.metadata as md

        prova.anota(f"parlant {md.version('parlant')}, pytest {md.version('pytest')}")
        prova.anota(f"tools da POC carregadas: {len(ALL_TOOLS)}")
        prova.passou = len(ALL_TOOLS) == 5
    except Exception as exc:  # noqa: BLE001
        prova.anota(f"falhou: {type(exc).__name__}: {exc}")
    return prova


# ------------------------------------------------------------------ prova 3
def prova_nao_sai_do_escopo() -> Prova:
    prova = Prova(3, "o agente nao alcanca nada fora do laboratorio")
    # Alvos que EXISTEM: se o acesso falhar, foi o sandbox, nao um ENOENT.
    alvos_de_leitura = [
        REPO / "README.md",
        REPO / "database",
        REPO / ".git" / "HEAD",
        REPO / ".github" / "workflows",
        Path.home() / ".ssh",
    ]
    alvos_de_escrita = [
        REPO / "sonda-nono.txt",
        Path.home() / "sonda-nono.txt",
    ]

    vazou: list[str] = []
    for alvo in alvos_de_leitura:
        try:
            if alvo.is_dir():
                next(iter(alvo.iterdir()), None)
            else:
                alvo.read_bytes()
            vazou.append(f"LEU {alvo}")
        except OSError as exc:
            marca = "bloqueado" if _erro_de_permissao(exc) else f"inconclusivo ({type(exc).__name__})"
            prova.anota(f"leitura {alvo}: {marca}")

    for alvo in alvos_de_escrita:
        try:
            alvo.write_text("sonda", encoding="utf-8")
            alvo.unlink(missing_ok=True)
            vazou.append(f"ESCREVEU {alvo}")
        except OSError as exc:
            marca = "bloqueado" if _erro_de_permissao(exc) else f"inconclusivo ({type(exc).__name__})"
            prova.anota(f"escrita {alvo}: {marca}")

    prova.detalhes += vazou
    prova.passou = not vazou
    return prova


# ------------------------------------------------------------------ prova 4
def prova_rede_negada() -> Prova:
    prova = Prova(4, "rede externa negada")
    vazou: list[str] = []

    # 4a. Criar socket IP ja tem de falhar: o filtro seccomp do `block` so
    # deixa passar AF_UNIX.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.close()
        prova.anota("socket(AF_INET) permitido — sem bloqueio no nivel de seccomp")
        criou_socket = True
    except OSError as exc:
        prova.anota(f"socket(AF_INET): bloqueado ({type(exc).__name__})")
        criou_socket = False

    # 4b. Resolucao de nome e conexao real, para os alvos que este laboratorio
    # nunca pode tocar.
    alvos = [
        ("generativelanguage.googleapis.com", 443),
        ("api.github.com", 443),
        ("8.8.8.8", 53),
    ]
    for host, porta in alvos:
        try:
            with socket.create_connection((host, porta), timeout=4):
                vazou.append(f"CONECTOU {host}:{porta}")
        except OSError as exc:
            prova.anota(f"{host}:{porta}: bloqueado ({type(exc).__name__})")

    # 4c. Loopback: e o unico caso legitimo, e mesmo assim so quando o perfil
    # foi lancado com --open-port. Aqui a informacao e diagnostica.
    try:
        ouvinte = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ouvinte.bind(("127.0.0.1", 0))
        ouvinte.close()
        prova.anota("loopback TCP: DISPONIVEL (necessario para o PluginServer do Parlant)")
    except OSError as exc:
        prova.anota(f"loopback TCP: bloqueado ({type(exc).__name__}) — scripts que sobem servidor nao rodam neste perfil")

    prova.detalhes += vazou
    prova.passou = not vazou and not criou_socket
    return prova


# ------------------------------------------------------------------ prova 5
def prova_sem_segredo() -> Prova:
    prova = Prova(5, "nenhuma chave ou segredo disponivel")
    achados: list[str] = []
    for nome, valor in os.environ.items():
        if NOMES_PROIBIDOS.match(nome):
            achados.append(f"variavel proibida presente: {nome}")
        elif FORMATOS_DE_SEGREDO.search(valor):
            achados.append(f"variavel {nome} contem valor com formato de segredo")
    prova.anota(f"{len(os.environ)} variaveis no ambiente, nenhum valor impresso")

    # Arquivos de credencial que o perfil promete negar.
    for arquivo in (
        Path.home() / ".netrc",
        Path.home() / ".config" / "gh" / "hosts.yml",
        Path.home() / ".claude.json",
        Path.home() / ".aws" / "credentials",
    ):
        try:
            arquivo.read_bytes()
            achados.append(f"credencial legivel: {arquivo}")
        except OSError as exc:
            marca = "bloqueado" if _erro_de_permissao(exc) else "ausente"
            prova.anota(f"{arquivo}: {marca}")

    prova.detalhes += achados
    prova.passou = not achados
    return prova


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="grava o relatorio neste caminho")
    args = parser.parse_args()

    inicio = time.monotonic()
    provas = [
        prova_le_o_laboratorio(),
        prova_executa_python(),
        prova_nao_sai_do_escopo(),
        prova_rede_negada(),
        prova_sem_segredo(),
    ]
    duracao = time.monotonic() - inicio

    print("=" * 72)
    print("VALIDACAO DO SANDBOX — santana-parlant-lab")
    print("=" * 72)
    for prova in provas:
        print(f"\n[{ 'PASS' if prova.passou else 'FAIL' }] {prova.numero}. {prova.titulo}")
        for linha in prova.detalhes:
            print(f"      - {linha}")

    reprovadas = [p.numero for p in provas if not p.passou]
    print("\n" + "-" * 72)
    print(f"tempo: {duracao:.2f}s")
    veredito = "PASS" if not reprovadas else f"FAIL (provas {reprovadas})"
    print(f"VEREDITO DAS PROVAS 1-5: {veredito}")

    if args.json:
        args.json.write_text(
            json.dumps(
                {
                    "veredito": "PASS" if not reprovadas else "FAIL",
                    "duracao_s": round(duracao, 3),
                    "provas": [
                        {
                            "numero": p.numero,
                            "titulo": p.titulo,
                            "passou": p.passou,
                            "detalhes": p.detalhes,
                        }
                        for p in provas
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    return 0 if not reprovadas else 1


if __name__ == "__main__":
    raise SystemExit(main())
