#!/usr/bin/env python3
"""Executor dos vetores de conformidade V1-V12.

Os vetores vivem fora das implementacoes, num formato neutro. Este executor
apenas os aplica a implementacao de REFERENCIA (Python). O Gateway TS/Deno tera
o seu proprio executor, lendo os mesmos arquivos e comparando do mesmo jeito.

Criterio unico, aplicado antes de qualquer criterio especifico do vetor:

    PASS     saida real == saida esperada, documento inteiro, apos canonizacao
             E escritas observadas == escritas_esperadas
    FAIL     qualquer diferenca
    INVALIDO release_id divergente: o vetor nao roda e NAO conta como PASS

Nao se ajusta vetor para fazer implementacao passar. Se a referencia divergir do
vetor, corrige-se a referencia.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from santana_referencia import argumentos as arg  # noqa: E402
from santana_referencia.dominio import authority  # noqa: E402
from santana_referencia.gateway import catalogo_oficial  # noqa: E402
from santana_referencia.gateway.gateway import GATEWAY  # noqa: E402

VETORES = RAIZ / "vetores"
FIXTURES = VETORES / "fixtures"
CATALOGO_OFICIAL = RAIZ / "catalogo" / "exumacao.v1.json"

PASS = "PASS"
FAIL = "FAIL"
INVALIDO = "INVALIDO"


def canonizar_json(valor: Any) -> str:
    """Forma canonica de comparacao.

    Chaves ordenadas por code point (`sort_keys` do Python e por code point, nao
    por colacao de locale), sem espacos variaveis, UTF-8 preservado.
    """
    return json.dumps(valor, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def caminho_do_catalogo(ref: str) -> Path:
    if ref == "oficial":
        return CATALOGO_OFICIAL
    caminho = FIXTURES / ref
    if not caminho.exists():
        raise FileNotFoundError(f"fixture inexistente: {ref}")
    return caminho


def _caso(estado: dict[str, Any] | None) -> authority.ExhumationCase:
    caso = authority.ExhumationCase(case_id="vetor")
    for code, value in (estado or {}).get("fatos_confirmados", {}).items():
        caso.facts[code] = authority.FactRecord(
            code=code, value=value, source="SYSTEM", status=authority.CONFIRMED
        )
    return caso


def _escritas(caso: authority.ExhumationCase) -> list[dict[str, Any]]:
    registros = [
        {"code": r.code, "status": r.status, "destino": destino}
        for destino, tabela in (("facts", caso.facts), ("claims", caso.claims))
        for r in tabela.values()
    ]
    return sorted(registros, key=lambda r: (r["destino"], r["code"]))


def executar(vetor: dict[str, Any]) -> dict[str, Any]:
    """Roda um vetor e devolve saida real, escritas observadas e release_id."""
    catalogo_oficial._carregar.cache_clear()
    os.environ["SANTANA_CATALOGO_OFICIAL"] = str(caminho_do_catalogo(vetor["catalogo_ref"]))

    operacao = vetor["operacao"]
    entrada = vetor.get("entrada") or {}
    referencia = date.fromisoformat(vetor["referencia"]) if vetor.get("referencia") else None

    release_id: str | None = None
    escritas: list[dict[str, Any]] = []

    if operacao == "carregar":
        try:
            descricao = GATEWAY.descrever_release()
            release_id = descricao["release_id"]
            saida: Any = descricao
        except catalogo_oficial.ErroDeCatalogo as erro:
            saida = {"erro_codigo": erro.codigo}

    elif operacao == "consultar":
        resposta = GATEWAY.consultar(entrada["tipo_informacao"], entrada.get("contexto"), referencia)
        release_id = resposta.release_id
        saida = resposta.as_dict()

    elif operacao == "consultar_com_canned":
        # V6: alem da resposta, expoe o que uma canned response poderia
        # interpolar. Fora de AVAILABLE o mapa tem de ser vazio.
        resposta = GATEWAY.consultar(entrada["tipo_informacao"], entrada.get("contexto"), referencia)
        release_id = resposta.release_id
        saida = {
            "resposta": resposta.as_dict(),
            "campos_para_canned": resposta.campos_para_canned(),
        }

    elif operacao == "consultar_via_tool":
        contrato = arg.ContratoDeTool(
            nome=entrada["contrato"]["nome"],
            parametros=tuple(entrada["contrato"].get("parametros", ())),
            obrigatorios=tuple(entrada["contrato"].get("obrigatorios", ())),
        )
        resposta, registro = GATEWAY.consultar_via_tool(
            contrato,
            arg.ler_argumentos_do_evento(entrada["evento"]),
            entrada["tipo_informacao"],
            entrada.get("contexto"),
            referencia,
        )
        release_id = resposta.release_id
        saida = {"resposta": resposta.as_dict(), "argumentos": registro.as_dict()}

    elif operacao == "canonizar_argumentos":
        contrato = arg.ContratoDeTool(
            nome=entrada["contrato"]["nome"],
            parametros=tuple(entrada["contrato"].get("parametros", ())),
            obrigatorios=tuple(entrada["contrato"].get("obrigatorios", ())),
        )
        bruto = arg.ler_argumentos_do_evento(entrada["evento"])
        saida = arg.canonizar(contrato, bruto).as_dict()

    elif operacao == "registrar_fato":
        caso = _caso(vetor.get("estado_do_caso_inicial"))
        resultado = GATEWAY.registrar_fato(
            caso, entrada["fact_code"], entrada.get("valor"), entrada.get("source", "USER_EXPLICIT")
        )
        release_id = resultado.get("release_id")
        saida = resultado
        escritas = _escritas(caso)

    else:
        raise ValueError(f"operacao desconhecida: {operacao}")

    return {"saida": saida, "escritas": escritas, "release_id": release_id}


def avaliar(vetor: dict[str, Any]) -> dict[str, Any]:
    real = executar(vetor)
    esperado_release = vetor.get("release_id_esperado")

    if esperado_release and real["release_id"] and real["release_id"] != esperado_release:
        return {
            "vector_id": vetor["vector_id"],
            "vetor": vetor["vetor"],
            "resultado": INVALIDO,
            "detalhe": (
                f"release_id {real['release_id']!r} != esperado {esperado_release!r}; "
                "o vetor nao roda e nao conta como PASS"
            ),
        }

    diferencas: list[str] = []
    if canonizar_json(real["saida"]) != canonizar_json(vetor["saida_esperada"]):
        diferencas.append("saida")
    if canonizar_json(real["escritas"]) != canonizar_json(vetor.get("escritas_esperadas", [])):
        diferencas.append("escritas")

    resultado = {
        "vector_id": vetor["vector_id"],
        "vetor": vetor["vetor"],
        "titulo": vetor["titulo"],
        "resultado": PASS if not diferencas else FAIL,
    }
    if diferencas:
        resultado["diferencas"] = diferencas
        resultado["esperado"] = vetor["saida_esperada"]
        resultado["real"] = real["saida"]
        if "escritas" in diferencas:
            resultado["escritas_esperadas"] = vetor.get("escritas_esperadas", [])
            resultado["escritas_reais"] = real["escritas"]
    return resultado


def carregar_vetores() -> list[dict[str, Any]]:
    vetores = []
    for caminho in sorted(VETORES.glob("v*.json")):
        vetores.extend(json.loads(caminho.read_text(encoding="utf-8"))["casos"])
    return vetores


def main() -> int:
    vetores = carregar_vetores()
    resultados = [avaliar(v) for v in vetores]

    por_vetor: dict[str, list[str]] = {}
    for r in resultados:
        por_vetor.setdefault(r["vetor"], []).append(r["resultado"])

    relatorio = {
        "implementacao": "referencia-python",
        "total_de_casos": len(resultados),
        "pass": sum(1 for r in resultados if r["resultado"] == PASS),
        "fail": sum(1 for r in resultados if r["resultado"] == FAIL),
        "invalido": sum(1 for r in resultados if r["resultado"] == INVALIDO),
        "por_vetor": {
            v: (PASS if all(x == PASS for x in rs) else FAIL) for v, rs in sorted(por_vetor.items())
        },
        "casos": resultados,
    }

    destino = os.environ.get("VETORES_RELATORIO")
    if destino:
        Path(destino).write_text(
            json.dumps(relatorio, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    for r in resultados:
        print(f"{r['resultado']:8} {r['vector_id']:10} {r.get('titulo','')}")
        if r["resultado"] != PASS:
            print(json.dumps(r, ensure_ascii=False, indent=2))
    print(
        f"\nCASOS: {relatorio['total_de_casos']}  "
        f"PASS: {relatorio['pass']}  FAIL: {relatorio['fail']}  "
        f"INVALIDO: {relatorio['invalido']}"
    )
    return 0 if relatorio["fail"] == 0 and relatorio["invalido"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
