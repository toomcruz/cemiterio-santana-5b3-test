"""O 7o caso do V11: o estado e permitido pelo contrato, ou proibido por invariante?

A pergunta e concreta:

    ai_extractable = false
    derived        != true
    authoritative_only != true

"Nao existe hoje no catalogo" nao e prova de nada — e observacao sobre dados,
nao sobre contrato. Estes testes olham para o CONTRATO: a interface `FactDef` em
`engine/catalog.ts` e as invariantes do validador em `engine/validate.ts`.

Conclusao provada abaixo: **o estado e PERMITIDO**. Nenhuma regra o proibe. Por
isso o 7o caso do V11 foi restaurado com fixture isolada, em vez de declarado
inalcancavel.

O ultimo teste e um detector de deriva: se alguem acrescentar uma invariante
sobre esses tres campos, ele quebra e obriga a reexaminar esta conclusao, em vez
de deixar o V11-G apoiado numa leitura que envelheceu em silencio.
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
REPO = RAIZ.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "runner"))

from santana_referencia.dominio import catalog  # noqa: E402

FACTS = REPO / "santana-conversation-domain" / "facts.v1.json"
VALIDATE_TS = REPO / "santana-conversation-domain" / "engine" / "validate.ts"
CATALOG_TS = REPO / "santana-conversation-domain" / "engine" / "catalog.ts"
FIXTURE = REPO / "conformidade" / "vetores" / "fixtures" / "dominio_fato_nao_extraivel.json"

CAMPOS = ("ai_extractable", "derived", "authoritative_only")

# As unicas linhas de `validate.ts` que mencionam os tres campos, na leitura que
# sustenta a conclusao. Normalizadas (espacos colapsados) para nao quebrar por
# reformatacao.
REGRAS_CONHECIDAS = {
    'if (fact.derived && !fact.allowed_sources.includes("DERIVED_RULE")) {',
    "if (fact?.derived) continue;",
    "if (!fact.authoritative_only) continue;",
    "if (fact.ai_extractable) errors.push(`fato autoritativo ${fact.fact_code} "
    "nao pode ser ai_extractable`);",
}


def _linhas_com_campos(caminho: Path) -> set[str]:
    return {
        re.sub(r"\s+", " ", linha).strip()
        for linha in caminho.read_text(encoding="utf-8").splitlines()
        if any(campo in linha for campo in CAMPOS)
    }


class OEstadoEPermitidoPeloContrato(unittest.TestCase):
    def test_a_interface_declara_derived_e_authoritative_only_opcionais(self) -> None:
        """`FactDef` exige `ai_extractable`, mas os outros dois sao opcionais.

        Opcional ausente e o mesmo que false para o carregador. Logo a
        combinacao alvo e expressavel no tipo.
        """
        fonte = CATALOG_TS.read_text(encoding="utf-8")
        self.assertIn("ai_extractable: boolean;", fonte)
        self.assertIn("derived?: boolean;", fonte)
        self.assertIn("authoritative_only?: boolean;", fonte)

    def test_nenhuma_invariante_exige_ai_extractable_em_fato_comum(self) -> None:
        """A unica regra sobre `ai_extractable` condiciona fato AUTORITATIVO.

        `authoritative_only => !ai_extractable`. Nao existe a reciproca, nem
        `!ai_extractable => derived or authoritative_only`.
        """
        regras = _linhas_com_campos(VALIDATE_TS)
        self.assertEqual(regras, REGRAS_CONHECIDAS)
        sobre_ai = [r for r in regras if "ai_extractable" in r]
        self.assertEqual(len(sobre_ai), 1)
        self.assertIn("fato autoritativo", sobre_ai[0])

    def test_a_regra_sobre_derived_so_exige_origem_derived_rule(self) -> None:
        """`derived => allowed_sources contem DERIVED_RULE`.

        E uma exigencia sobre fato derivado, nao sobre fato nao extraivel. Um
        fato nao extraivel e nao derivado nao cai nela.
        """
        derived = [r for r in _linhas_com_campos(VALIDATE_TS) if "fact.derived &&" in r]
        self.assertEqual(len(derived), 1)
        self.assertIn("DERIVED_RULE", derived[0])

    def test_o_estado_nao_ocorre_no_catalogo_autoritativo(self) -> None:
        """Observacao sobre dados — registrada como observacao, nao como prova.

        E exatamente por isto que a fixture existe: o estado e permitido e nao
        ocorre. Fabricar a ocorrencia em `facts.v1.json` seria alterar dado
        autoritativo para fazer teste passar.
        """
        doc = json.loads(FACTS.read_text(encoding="utf-8"))
        alvo = [
            f["fact_code"]
            for f in doc["facts"]
            if not f.get("ai_extractable", False)
            and not f.get("derived", False)
            and not f.get("authoritative_only", False)
        ]
        self.assertEqual(alvo, [])


class AFixtureNaoContaminaODominio(unittest.TestCase):
    def test_a_fixture_so_acrescenta(self) -> None:
        """A fixture nao tem onde declarar alteracao de fato existente."""
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(set(fixture) & {"altera_fatos", "remove_fatos", "facts"}, set())
        self.assertIn("acrescenta_fatos", fixture)

    def test_o_fato_da_fixture_esta_no_estado_alvo(self) -> None:
        fato = json.loads(FIXTURE.read_text(encoding="utf-8"))["acrescenta_fatos"][0]
        self.assertIs(fato["ai_extractable"], False)
        self.assertNotIn("derived", fato)
        self.assertNotIn("authoritative_only", fato)

    def test_o_dominio_montado_preserva_os_fatos_autoritativos(self) -> None:
        import executar_vetores as runner

        raiz = runner.montar_dominio("dominio_fato_nao_extraivel.json")
        montado = json.loads(
            (raiz / runner.DOMINIO / "facts.v1.json").read_text(encoding="utf-8")
        )
        autoritativo = json.loads(FACTS.read_text(encoding="utf-8"))
        acrescimo = json.loads(FIXTURE.read_text(encoding="utf-8"))["acrescenta_fatos"]

        self.assertEqual(montado["facts"][: len(autoritativo["facts"])], autoritativo["facts"])
        self.assertEqual(montado["facts"][len(autoritativo["facts"]) :], acrescimo)
        for chave in autoritativo:
            if chave != "facts":
                self.assertEqual(montado[chave], autoritativo[chave])

    def test_os_outros_quatro_catalogos_sao_copiados_sem_edicao(self) -> None:
        import executar_vetores as runner

        raiz = runner.montar_dominio("dominio_fato_nao_extraivel.json")
        for nome in ("topics.v1.json", "goals.v1.json", "relations.v1.json", "questions.v1.json"):
            original = (REPO / runner.DOMINIO / nome).read_bytes()
            copia = (raiz / runner.DOMINIO / nome).read_bytes()
            self.assertEqual(original, copia, nome)

    def test_o_escopo_de_fixture_e_vazio_por_padrao(self) -> None:
        catalog.definir_escopo_de_fixture(())
        self.assertEqual(catalog.escopo_de_fatos(), catalog.fact_codes_do_perfil())
        self.assertNotIn("fixture_non_extractable_fact", catalog.fact_specs())


class OCatalogoOficialViveForaDaReferencia(unittest.TestCase):
    def test_o_caminho_padrao_e_neutro(self) -> None:
        import os

        from santana_referencia.gateway import catalogo_oficial

        os.environ.pop("SANTANA_CATALOGO_OFICIAL", None)
        os.environ.pop("SANTANA_REPO_ROOT", None)
        catalog.limpar_caches()
        caminho = catalogo_oficial.catalogo_path()
        self.assertEqual(caminho, REPO / "santana-authority" / "catalogo" / "exumacao.v1.json")
        self.assertTrue(caminho.exists())
        # A referencia nao e dona da fonte autoritativa.
        self.assertNotIn(RAIZ, caminho.parents)

    def test_o_release_id_nao_mudou_com_a_mudanca_de_lugar(self) -> None:
        import os

        from santana_referencia.gateway import catalogo_oficial

        os.environ.pop("SANTANA_CATALOGO_OFICIAL", None)
        os.environ.pop("SANTANA_REPO_ROOT", None)
        catalog.limpar_caches()
        catalogo_oficial._carregar.cache_clear()
        catalog.definir_escopo_de_fixture(())
        self.assertEqual(catalogo_oficial.release_id(), "exu-1.0-32cc48f26797")

    def test_uma_unica_copia_operacional_do_catalogo(self) -> None:
        """Uma unica copia OPERACIONAL, identificada por conteudo.

        A versao anterior deste teste casava por NOME de arquivo e reprovou
        quando o perfil de conformidade nasceu tambem como `exumacao.v1.json`.
        O nome era o criterio errado: o que nao pode existir em duplicata e um
        documento com a FORMA de catalogo oficial. O perfil de conformidade nao
        tem essa forma — ele nao declara tipo de informacao nem entrada — e as
        fixtures tem, mas vivem confinadas ao diretorio de fixtures.
        """
        fixtures = REPO / "conformidade" / "vetores" / "fixtures"
        catalogos = []
        for caminho in REPO.rglob("*.json"):
            if ".git" in caminho.parts or fixtures in caminho.parents:
                continue
            try:
                doc = json.loads(caminho.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if not isinstance(doc, dict):
                continue
            if {"schema_version", "tipos_de_informacao", "entradas"} <= set(doc):
                catalogos.append(caminho.relative_to(REPO).as_posix())
        self.assertEqual(sorted(catalogos), ["santana-authority/catalogo/exumacao.v1.json"])

    def test_o_perfil_de_conformidade_nao_e_catalogo(self) -> None:
        """O perfil declara escopo tecnico, nunca conhecimento administrativo."""
        perfil = json.loads(
            (REPO / "conformidade" / "perfis" / "exumacao.v1.json").read_text(encoding="utf-8")
        )
        self.assertEqual(set(perfil) & {"tipos_de_informacao", "entradas", "fontes"}, set())
        self.assertEqual(perfil["topic_code"], "EXUMACAO")
        self.assertEqual(perfil["primary_goal"], "GOAL_EXUMACAO")
        self.assertEqual(tuple(perfil["fact_codes"]), catalog.fact_codes_do_perfil())


if __name__ == "__main__":
    unittest.main()
