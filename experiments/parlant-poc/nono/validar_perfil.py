"""Valida o perfil do laboratorio contra o JSON Schema real do Nono.

O `nono profile validate` e a forma canonica. Este script existe porque o
container onde a POC foi montada nao consegue instalar o Nono (rede filtrada);
ele usa o mesmo `nono-profile.schema.json` publicado pelo projeto, entao a
resposta e a mesma. Na maquina do usuario, prefira `nono profile validate`.

Alem do schema, confere os nomes de grupo e de perfil-base contra o
`policy.json` do Nono: `system_read_linux` (que nao existe; o nome real e
`system_read_linux_core`) passaria no schema e so falharia na hora de rodar.

O schema sai do proprio nono: `nono profile schema > schema.json`. O
`policy.json` (lista de grupos) e opcional; sem ele a checagem de nome de
grupo e pulada.

Uso:
    python nono/validar_perfil.py <schema.json> [policy.json] [perfil.jsonc ...]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import jsonschema

AQUI = Path(__file__).resolve().parent

# Variaveis de caminho que o Nono expande (profile/mod.rs::expand_vars).
VARIAVEIS_DE_CAMINHO = {
    "$WORKDIR", "$HOME", "$TMPDIR", "$UID",
    "$XDG_CONFIG_HOME", "$XDG_DATA_HOME", "$XDG_STATE_HOME",
    "$XDG_CACHE_HOME", "$XDG_RUNTIME_DIR",
    "$NONO_CONFIG", "$NONO_PACKAGES",
}


def sem_comentarios(texto: str) -> str:
    """Remove comentarios de linha do JSONC preservando o que esta em string."""
    saida = []
    for linha in texto.splitlines():
        fora_de_string = True
        escapando = False
        corte = None
        for i, ch in enumerate(linha):
            if escapando:
                escapando = False
                continue
            if ch == "\\":
                escapando = True
            elif ch == '"':
                fora_de_string = not fora_de_string
            elif ch == "/" and fora_de_string and linha[i + 1 : i + 2] == "/":
                corte = i
                break
        saida.append(linha if corte is None else linha[:corte])
    return "\n".join(saida)


def variaveis_desconhecidas(dados: object, caminho: str = "") -> list[str]:
    """Acha `$VAR` que o Nono nao expande (o valor viraria caminho literal)."""
    problemas: list[str] = []
    if isinstance(dados, dict):
        for chave, valor in dados.items():
            problemas += variaveis_desconhecidas(valor, f"{caminho}.{chave}")
    elif isinstance(dados, list):
        for i, valor in enumerate(dados):
            problemas += variaveis_desconhecidas(valor, f"{caminho}[{i}]")
    elif isinstance(dados, str):
        for var in re.findall(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?", dados):
            if var.startswith("${"):
                problemas.append(f"{caminho}: `{var}` — o Nono nao aceita chaves, use $VAR")
            elif var not in VARIAVEIS_DE_CAMINHO:
                problemas.append(f"{caminho}: `{var}` nao e expandida pelo Nono")
    return problemas


def nomes_invalidos(dados: dict, politica: dict) -> list[str]:
    """Grupos e perfil-base precisam existir no `policy.json` do Nono."""
    problemas: list[str] = []
    if not politica:
        return problemas
    grupos = set(politica.get("groups", {}))
    perfis = set(politica.get("profiles", {}))

    bases = dados.get("extends") or []
    for base in [bases] if isinstance(bases, str) else bases:
        if base not in perfis:
            problemas.append(f"extends: perfil-base `{base}` nao existe no policy.json")

    for secao in ("include", "exclude"):
        for item in dados.get("groups", {}).get(secao, []):
            nome = item["name"] if isinstance(item, dict) else item
            if nome not in grupos:
                problemas.append(f"groups.{secao}: grupo `{nome}` nao existe no policy.json")
    return problemas


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    resto = [Path(a) for a in sys.argv[2:]]
    politica: dict = {}
    if resto and resto[0].suffix == ".json":
        politica = json.loads(resto.pop(0).read_text(encoding="utf-8"))
    else:
        print("aviso: sem policy.json — nomes de grupo nao serao conferidos")
    perfis = resto or sorted(AQUI.glob("*.jsonc"))

    validador = jsonschema.Draft202012Validator(schema)
    falhou = False
    for perfil in perfis:
        dados = json.loads(sem_comentarios(perfil.read_text(encoding="utf-8")))
        erros = sorted(validador.iter_errors(dados), key=lambda e: list(e.absolute_path))
        avisos = variaveis_desconhecidas(dados) + nomes_invalidos(dados, politica)
        if erros or avisos:
            falhou = True
            print(f"FAIL {perfil.name}")
            for e in erros:
                print(f"  schema: {'/'.join(str(p) for p in e.absolute_path) or '<raiz>'}: {e.message}")
            for a in avisos:
                print(f"  nome/variavel: {a}")
        else:
            print(f"PASS {perfil.name}")
    return 1 if falhou else 0


if __name__ == "__main__":
    raise SystemExit(main())
