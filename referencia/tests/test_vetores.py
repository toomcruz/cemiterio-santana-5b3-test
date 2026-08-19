"""Testes da Fase 2.

Duas coisas precisam ser verdade, e a segunda importa tanto quanto a primeira:

1. os 46 casos de V1-V12 passam contra a implementacao de referencia;
2. os vetores REPROVAM quando a referencia regride.

Sem (2), "46 PASS" nao prova nada: um vetor que nao consegue falhar nao e prova,
e apenas decoracao. Por isso os testes de mutacao abaixo reintroduzem, um por
vez, exatamente os defeitos que a Fase 2 corrigiu, e exigem que o vetor
correspondente vire FAIL.
"""

from __future__ import annotations

import copy
import importlib
import sys
import types
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "runner"))

import executar_vetores as runner  # noqa: E402
from santana_referencia import argumentos as arg  # noqa: E402


def por_id(vector_id: str) -> dict:
    for vetor in runner.carregar_vetores():
        if vetor["vector_id"] == vector_id:
            return copy.deepcopy(vetor)
    raise KeyError(vector_id)


class TodosOsVetores(unittest.TestCase):
    def test_todos_passam_na_referencia(self) -> None:
        falhas = [r for r in map(runner.avaliar, runner.carregar_vetores()) if r["resultado"] != runner.PASS]
        self.assertEqual(falhas, [], f"vetores nao-PASS: {[f['vector_id'] for f in falhas]}")

    def test_os_doze_vetores_estao_cobertos(self) -> None:
        cobertos = {v["vetor"] for v in runner.carregar_vetores()}
        self.assertEqual(cobertos, {f"V{n}" for n in range(1, 13)})


class OExecutorConsegueReprovar(unittest.TestCase):
    """Se o executor nao consegue reprovar, nenhum PASS dele significa algo."""

    def test_saida_diferente_reprova(self) -> None:
        vetor = por_id("V02-A")
        vetor["saida_esperada"]["status"] = "AVAILABLE"
        self.assertEqual(runner.avaliar(vetor)["resultado"], runner.FAIL)

    def test_chave_extra_no_esperado_reprova(self) -> None:
        vetor = por_id("V01-A")
        vetor["saida_esperada"]["campo_que_nao_existe"] = 1
        self.assertEqual(runner.avaliar(vetor)["resultado"], runner.FAIL)

    def test_release_id_divergente_e_invalido_e_nao_pass(self) -> None:
        vetor = por_id("V01-A")
        vetor["release_id_esperado"] = "exu-1.0-000000000000"
        resultado = runner.avaliar(vetor)
        self.assertEqual(resultado["resultado"], runner.INVALIDO)
        self.assertNotEqual(resultado["resultado"], runner.PASS)

    def test_escrita_inesperada_reprova(self) -> None:
        vetor = por_id("V11-A")
        vetor["escritas_esperadas"] = [{"code": "x", "destino": "facts", "status": "CONFIRMED"}]
        self.assertEqual(runner.avaliar(vetor)["resultado"], runner.FAIL)


class MutacaoLeitorDeArgumentos(unittest.TestCase):
    """Reintroduz o `or` falsy de `turnos.py` (POC) e exige reprovacao."""

    def test_or_falsy_reprova_v12a(self) -> None:
        original = arg.ler_argumentos_do_evento

        def leitor_defeituoso(chamada):
            return chamada.get("arguments") or chamada.get("args")

        arg.ler_argumentos_do_evento = leitor_defeituoso
        runner.arg.ler_argumentos_do_evento = leitor_defeituoso
        try:
            resultado = runner.avaliar(por_id("V12-A"))
        finally:
            arg.ler_argumentos_do_evento = original
            runner.arg.ler_argumentos_do_evento = original

        self.assertEqual(resultado["resultado"], runner.FAIL)
        # O defeito e exatamente este: `{}` no fio vira `null` no registro.
        self.assertIsNone(resultado["real"]["bruto"])
        self.assertEqual(resultado["esperado"]["bruto"], {})

    def test_o_leitor_corrigido_distingue_vazio_de_ausente(self) -> None:
        self.assertEqual(arg.ler_argumentos_do_evento({"arguments": {}}), {})
        self.assertIsNone(arg.ler_argumentos_do_evento({"tool_id": "x"}))
        self.assertIsNone(arg.ler_argumentos_do_evento({"arguments": None}))


def _gateway_mutado(de: str, para: str):
    """Compila uma copia de gateway.py com uma substituicao de origem.

    O modulo mutado entra com `__package__` de `santana_referencia.gateway`, de
    modo que os imports relativos dele continuam resolvendo.
    """
    origem = (RAIZ / "santana_referencia" / "gateway" / "gateway.py").read_text(encoding="utf-8")
    if de not in origem:
        raise AssertionError(f"trecho a mutar nao encontrado: {de!r}")
    modulo = types.ModuleType("santana_referencia.gateway.gateway_mutado")
    modulo.__package__ = "santana_referencia.gateway"
    importlib.import_module("santana_referencia.gateway")
    exec(compile(origem.replace(de, para), "<gateway_mutado>", "exec"), modulo.__dict__)
    return modulo


class MutacaoDesempate(unittest.TestCase):
    """Reintroduz `finalistas[0]` e exige que V01-C e V01-D divirjam."""

    def test_ordem_do_arquivo_faz_as_duas_ordens_divergirem(self) -> None:
        mutado = _gateway_mutado(
            "escolhida = min(finalistas, key=lambda e: e.entry_id)",
            "escolhida = finalistas[0]",
        )
        gateway_mutado = mutado.SantanaAuthorityGateway()
        original = runner.GATEWAY
        runner.GATEWAY = gateway_mutado
        try:
            c = runner.executar(por_id("V01-C"))["saida"]
            d = runner.executar(por_id("V01-D"))["saida"]
            reprovou = runner.avaliar(por_id("V01-C"))["resultado"]
        finally:
            runner.GATEWAY = original

        # A mesma consulta, o mesmo valor, entradas identicas: so a ordem do
        # arquivo mudou, e a proveniencia devolvida mudou junto. E isso que
        # reprovaria o porte TS/Deno sem que nenhuma das duas implementacoes
        # estivesse errada.
        self.assertEqual(c["entry_id"], "FIX_PRAZO_ZZZ")
        self.assertEqual(d["entry_id"], "FIX_PRAZO_AAA")
        self.assertNotEqual(c["source_id"], d["source_id"])
        self.assertEqual(reprovou, runner.FAIL)

    def test_com_a_correcao_as_duas_ordens_concordam(self) -> None:
        for vector_id in ("V01-C", "V01-D"):
            self.assertEqual(runner.avaliar(por_id(vector_id))["resultado"], runner.PASS)


class MutacaoCanonizacao(unittest.TestCase):
    """Desliga a recusa de argumento na fronteira e exige reprovacao."""

    def test_fronteira_permissiva_reprova_v12l(self) -> None:
        def canonizar_permissivo(contrato, bruto):
            return arg.ArgumentosCanonizados(contrato=contrato.nome, bruto=bruto, canonico={})

        mutado = _gateway_mutado(
            "registro = canonizar(contrato, argumentos_brutos)",
            "registro = _canonizar_permissivo(contrato, argumentos_brutos)",
        )
        mutado._canonizar_permissivo = canonizar_permissivo
        original = runner.GATEWAY
        runner.GATEWAY = mutado.SantanaAuthorityGateway()
        try:
            resultado = runner.avaliar(por_id("V12-L"))
        finally:
            runner.GATEWAY = original

        self.assertEqual(resultado["resultado"], runner.FAIL)
        # Sem a recusa, a consulta acontece: o status deixa de ser a recusa e
        # passa a ser resposta de dominio. Nenhuma tarifa vaza neste caso
        # especifico, mas a barreira que impede a injecao deixou de existir.
        self.assertEqual(resultado["real"]["resposta"]["status"], "NEEDS_CONTEXT")
        self.assertEqual(resultado["esperado"]["resposta"]["motivo"], "ARGUMENTOS_NAO_CANONICOS")


class NenhumaTarifaSemModalidade(unittest.TestCase):
    """V10 explicito: as tres tarifas nao podem aparecer em saida nenhuma."""

    TARIFAS = ("106,57", "351,67", "586,04")

    def test_nenhuma_tarifa_em_v10(self) -> None:
        import json

        for vetor in runner.carregar_vetores():
            if vetor["vetor"] != "V10":
                continue
            real = runner.executar(vetor)
            texto = json.dumps(real["saida"], ensure_ascii=False)
            for tarifa in self.TARIFAS:
                self.assertNotIn(tarifa, texto, f"{vetor['vector_id']} vazou {tarifa}")


if __name__ == "__main__":
    unittest.main()
