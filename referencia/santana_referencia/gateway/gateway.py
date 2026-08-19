"""Santana Authority Gateway V1.

Interface unica entre o Parlant e o conhecimento/estado do Cemiterio Santana.

Duas responsabilidades, e so essas:

1. `consultar` — responder um ponto do atendimento a partir do catalogo oficial
   estruturado, sempre com `release_id`, `source_id`, aplicabilidade, vigencia e
   status. Nao ha caminho que devolva texto gerado por modelo.
2. `registrar_fato` — segunda validacao obrigatoria antes de qualquer escrita no
   caso. O schema da Tool ja e fechado; aqui a regra e conferida de novo, porque
   um schema correto nao prova que a chamada veio dele.

Tudo falha fechado: o que nao pode ser determinado vira NAO_DISPONIVEL com
encaminhamento para a Administracao, nunca uma resposta aproximada.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Mapping

from ..argumentos import ContratoDeTool, canonizar
from ..dominio import authority, catalog
from . import catalogo_oficial
from .resposta import (
    ARGUMENTOS_NAO_CANONICOS,
    CONTEXTO_INCOMPATIVEL,
    CONTEXTO_INSUFICIENTE,
    CONFLITO,
    DISPONIVEL,
    FONTES_EM_CONFLITO,
    FORA_DE_VIGENCIA,
    NAO_DISPONIVEL,
    PRECISA_DE_CONTEXTO,
    SEM_FONTE_OFICIAL,
    TIPO_DESCONHECIDO,
    RespostaAutoritativa,
)

# Motivos de recusa de escrita. Codigos, nunca frases para o municipe.
FATO_DESCONHECIDO = "FATO_DESCONHECIDO_NO_CATALOGO"
FATO_NAO_GRAVAVEL = "FATO_NAO_GRAVAVEL_PELO_ATENDIMENTO"
FATO_AUTORITATIVO = "FATO_AUTORITATIVO_SO_PELA_ADMINISTRACAO"
VALOR_FORA_DO_DOMINIO = "VALOR_FORA_DO_DOMINIO"
VALOR_VAZIO = "VALOR_VAZIO"
ORIGEM_INVALIDA = "ORIGEM_NAO_ACEITA"


class SantanaAuthorityGateway:
    """Porta unica. O Parlant nao conhece nada abaixo desta classe."""

    # ------------------------------------------------------------- identidade
    @property
    def release_id(self) -> str:
        return catalogo_oficial.release_id()

    def descrever_release(self) -> dict[str, Any]:
        oficial = catalogo_oficial.carregar()
        return {
            "release_id": oficial.release_id,
            "topic": oficial.topic,
            "tipos_de_informacao": sorted(oficial.tipos),
            "fontes_aprovadas": sorted(f.source_id for f in oficial.fontes.values() if f.aprovada),
            "entradas_vigentes": len(oficial.entradas),
        }

    # -------------------------------------------------------------- consulta
    def consultar(
        self,
        tipo_informacao: str,
        contexto: Mapping[str, str] | None = None,
        referencia: date | None = None,
    ) -> RespostaAutoritativa:
        """Consulta um ponto do atendimento. Nunca inventa, nunca aproxima."""
        oficial = catalogo_oficial.carregar()
        contexto = dict(contexto or {})
        referencia = referencia or date.today()
        base = {"release_id": oficial.release_id, "tipo_informacao": tipo_informacao}

        spec = oficial.tipos.get(tipo_informacao)
        if spec is None:
            return RespostaAutoritativa(
                **base, status=NAO_DISPONIVEL, motivo=TIPO_DESCONHECIDO, aplicabilidade=contexto
            )

        do_tipo = oficial.entradas_do_tipo(tipo_informacao)
        if not do_tipo:
            # Nada publicado. Se o tipo exige fonte oficial, o motivo e esse; se
            # nao exige, e ausencia de entrada mesmo. Os dois encaminham.
            return RespostaAutoritativa(
                **base,
                status=NAO_DISPONIVEL,
                motivo=SEM_FONTE_OFICIAL if spec.exige_fonte_oficial else FORA_DE_VIGENCIA,
                aplicabilidade=contexto,
            )

        vigentes = [e for e in do_tipo if e.vigente_em(referencia)]
        if not vigentes:
            return RespostaAutoritativa(
                **base, status=NAO_DISPONIVEL, motivo=FORA_DE_VIGENCIA, aplicabilidade=contexto
            )

        # Tres grupos, e a diferenca entre eles e o coracao desta versao:
        #
        # * excluida  — algum criterio esta no contexto com OUTRO valor;
        # * determinada — todos os criterios dela estao no contexto e batem;
        # * candidata — nao foi excluida, mas depende de criterio que o contexto
        #   nao informa.
        #
        # Antes, candidata e excluida caiam no mesmo balde e a resposta era
        # sempre "indeterminado". Com tres tarifas de exumacao na base, esse
        # balde unico esconderia a pergunta que precisa ser feita.
        determinadas, candidatas = [], []
        for entrada in vigentes:
            if self._excluida(entrada.aplicabilidade, contexto):
                continue
            if all(chave in contexto for chave in entrada.aplicabilidade):
                determinadas.append(entrada)
            else:
                candidatas.append(entrada)

        if determinadas:
            melhor = max(e.especificidade() for e in determinadas)
            finalistas = [e for e in determinadas if e.especificidade() == melhor]

            valores = {tuple(sorted(e.valor.items())) for e in finalistas}
            if len(valores) > 1:
                # Fontes oficiais discordam para o mesmo caso: falha segura.
                return RespostaAutoritativa(
                    **base,
                    status=CONFLITO,
                    motivo=FONTES_EM_CONFLITO,
                    aplicabilidade=contexto,
                    entradas_em_conflito=tuple(sorted(e.entry_id for e in finalistas)),
                )

            # Desempate deterministico. Os finalistas ja tem valor identico
            # (valores divergentes viraram CONFLITO acima), mas `entry_id`,
            # `source_id` e vigencia saem da entrada escolhida — e escolher pela
            # ordem do arquivo faria duas implementacoes corretas divergirem em
            # V1 e V6. A ordem e por code point do `entry_id`, nunca colacao de
            # locale.
            escolhida = min(finalistas, key=lambda e: e.entry_id)
            return RespostaAutoritativa(
                **base,
                status=DISPONIVEL,
                valor=dict(escolhida.valor),
                aplicabilidade=dict(escolhida.aplicabilidade),
                source_id=escolhida.source_id,
                entry_id=escolhida.entry_id,
                vigencia_inicio=escolhida.vigencia_inicio,
                vigencia_fim=escolhida.vigencia_fim,
            )

        if not candidatas:
            # O contexto contradiz todas as entradas conhecidas. Responder
            # qualquer uma seria responder o caso de outra pessoa.
            return RespostaAutoritativa(
                **base,
                status=NAO_DISPONIVEL,
                motivo=CONTEXTO_INCOMPATIVEL,
                aplicabilidade=contexto,
            )

        # Ha conhecimento oficial, falta saber de qual caso se trata. Quem
        # pergunta e o atendimento; o valor nunca e escolhido aqui nem pelo
        # modelo.
        faltantes = sorted(
            {chave for e in candidatas for chave in e.aplicabilidade if chave not in contexto}
        )
        # Opcoes POR CAMPO, nunca uma lista plana. Com mais de um campo faltante
        # a lista plana nao dizia a qual campo cada opcao pertencia, e o
        # atendimento pergunta um campo por vez (R6): perguntar "servico" com as
        # opcoes de "modalidade_tarifaria" misturadas seria pedir ao municipe que
        # escolhesse numa lista que nao e a dele.
        opcoes_por_campo = {
            chave: sorted(
                {
                    str(e.aplicabilidade[chave])
                    for e in candidatas
                    if chave in e.aplicabilidade
                }
            )
            for chave in faltantes
        }
        return RespostaAutoritativa(
            **base,
            status=PRECISA_DE_CONTEXTO,
            motivo=CONTEXTO_INSUFICIENTE,
            aplicabilidade=contexto,
            contexto_faltante=tuple(faltantes),
            opcoes_por_campo={k: tuple(v) for k, v in opcoes_por_campo.items()},
        )

    def consultar_via_tool(
        self,
        contrato: ContratoDeTool,
        argumentos_brutos: Any,
        tipo_informacao: str,
        contexto: Mapping[str, str] | None = None,
        referencia: date | None = None,
    ) -> tuple[RespostaAutoritativa, Any]:
        """Fronteira do Gateway: canoniza os argumentos ANTES de consultar.

        Devolve a resposta e o registro de canonizacao — o registro carrega o
        valor bruto do evento, preservado literalmente para auditoria.

        Argumento fora do contrato nao e limpado nem ignorado: a consulta nao
        acontece. Nao se responde uma pergunta cuja chamada chegou fora do
        contrato.
        """
        registro = canonizar(contrato, argumentos_brutos)
        if not registro.aceito:
            return (
                RespostaAutoritativa(
                    release_id=self.release_id,
                    tipo_informacao=tipo_informacao,
                    status=NAO_DISPONIVEL,
                    motivo=ARGUMENTOS_NAO_CANONICOS,
                    aplicabilidade=dict(contexto or {}),
                ),
                registro,
            )
        return self.consultar(tipo_informacao, contexto, referencia), registro

    @staticmethod
    def _excluida(aplicabilidade: Mapping[str, str], contexto: Mapping[str, str]) -> bool:
        """A entrada esta descartada para este caso?

        So quando o contexto AFIRMA outra coisa. Criterio que o contexto nao
        informa nao descarta nem confirma — vira pergunta.
        """
        return any(
            chave in contexto and contexto[chave] != valor
            for chave, valor in aplicabilidade.items()
        )

    # ------------------------------------------------ contexto vindo do caso
    def contexto_do_caso(self, case: authority.ExhumationCase) -> dict[str, str]:
        """Aplicabilidade derivada do estado deterministico — nunca do LLM.

        So entram fatos CONFIRMADOS. Alegacao pendente de verificacao pela
        Administracao nao seleciona resposta oficial.
        """
        contexto: dict[str, str] = {"servico": "EXUMACAO"}

        conjuge = case.confirmed_value("surviving_spouse_status")
        if conjuge == "VIVO":
            contexto["situacao_do_conjuge"] = "VIVO"
        elif conjuge in ("FALECIDO", "INEXISTENTE"):
            contexto["situacao_do_conjuge"] = "SEM_CONJUGE_SOBREVIVENTE"

        destino = case.confirmed_value("transport_destination")
        if destino:
            contexto["tipo_de_destino"] = str(destino)

        assinante = case.confirmed_value("required_authorization_signatory")
        if assinante:
            contexto["assinante_exigido"] = str(assinante)

        return contexto

    def consultar_para_o_caso(
        self, case: authority.ExhumationCase, tipo_informacao: str
    ) -> RespostaAutoritativa:
        return self.consultar(tipo_informacao, self.contexto_do_caso(case))

    # ---------------------------------------------------------- escrita
    def registrar_fato(
        self,
        case: authority.ExhumationCase,
        fact_code: str,
        valor: Any,
        source: str = "USER_EXPLICIT",
    ) -> dict[str, Any]:
        """Segunda validacao antes de escrever. Falha fechada.

        A primeira validacao e o schema fechado da Tool. Esta aqui existe porque
        um schema correto prova o que foi *oferecido* ao modelo, nao o que
        chegou: a chamada pode vir de um caminho novo, de um teste, ou de um
        prompt que convenceu o modelo a montar argumento diferente.
        """
        specs = catalog.fact_specs()
        spec = specs.get(fact_code)

        if spec is None:
            return self._recusa(fact_code, FATO_DESCONHECIDO,
                                "Fato desconhecido no catalogo do assunto Exumacao.")

        if spec.authoritative_only:
            # Nunca exposto em schema gravavel; se chegou aqui, e caminho novo.
            return self._recusa(
                fact_code, FATO_AUTORITATIVO,
                f"'{spec.display_name}' so e confirmado pela Administracao do Cemiterio "
                "(sinal autoritativo ou documento).",
                pending_action=spec.resolution_action,
            )

        if spec.derived or not spec.ai_extractable:
            return self._recusa(
                fact_code, FATO_NAO_GRAVAVEL,
                f"'{spec.display_name}' e derivado por regra deterministica ou nao pode ser "
                "extraido do atendimento.",
            )

        if source not in authority.USER_SOURCES:
            return self._recusa(
                fact_code, ORIGEM_INVALIDA,
                f"Origem '{source}' nao registra fato declarado pelo municipe.",
            )

        texto = "" if valor is None else str(getattr(valor, "value", valor)).strip()
        if not texto:
            return self._recusa(fact_code, VALOR_VAZIO, "Valor vazio nao registra fato.")

        if spec.is_enum:
            normalizado = texto.upper().replace(" ", "_")
            if normalizado not in spec.allowed_values:
                return self._recusa(
                    fact_code, VALOR_FORA_DO_DOMINIO,
                    f"Valor fora do dominio de '{fact_code}'.",
                    allowed_values=list(spec.allowed_values),
                )

        # Terceira barreira: a validacao do proprio caso, que continua no lugar.
        submissao = case.submit_fact(fact_code, texto, source=source)
        dados = submissao.as_dict()
        dados["release_id"] = self.release_id
        dados["gateway"] = "SantanaAuthorityGateway/v1"
        return dados

    def _recusa(
        self,
        fact_code: str,
        motivo: str,
        mensagem: str,
        allowed_values: list[str] | None = None,
        pending_action: str | None = None,
    ) -> dict[str, Any]:
        dados: dict[str, Any] = {
            "fact_code": fact_code,
            "outcome": authority.REJECTED,
            "reason": motivo,
            "message": mensagem,
            "release_id": self.release_id,
            "gateway": "SantanaAuthorityGateway/v1",
        }
        if allowed_values:
            dados["allowed_values"] = allowed_values
        if pending_action:
            dados["pending_action"] = pending_action
        return dados

    # ------------------------------------------------------------- estado
    def estado_do_caso(self, case: authority.ExhumationCase) -> dict[str, Any]:
        snapshot = case.snapshot()
        snapshot["release_id"] = self.release_id
        snapshot["aplicabilidade"] = self.contexto_do_caso(case)
        return snapshot


GATEWAY = SantanaAuthorityGateway()
