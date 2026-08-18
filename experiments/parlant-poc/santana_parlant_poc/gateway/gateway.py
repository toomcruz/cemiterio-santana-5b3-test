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

from ..domain import authority, catalog
from . import catalogo_oficial
from .resposta import (
    APLICABILIDADE_INDETERMINADA,
    CONFLITO,
    DISPONIVEL,
    FONTES_EM_CONFLITO,
    FORA_DE_VIGENCIA,
    NAO_DISPONIVEL,
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

        compativeis = [e for e in vigentes if self._compativel(e.aplicabilidade, contexto)]
        if not compativeis:
            # Existe conhecimento, mas nao para este caso: o contexto nao
            # determina a aplicabilidade. Perguntar antes e melhor que responder
            # o valor de outro caso.
            return RespostaAutoritativa(
                **base,
                status=NAO_DISPONIVEL,
                motivo=APLICABILIDADE_INDETERMINADA,
                aplicabilidade=contexto,
            )

        melhor = max(e.especificidade() for e in compativeis)
        finalistas = [e for e in compativeis if e.especificidade() == melhor]

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

        escolhida = finalistas[0]
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

    @staticmethod
    def _compativel(aplicabilidade: Mapping[str, str], contexto: Mapping[str, str]) -> bool:
        """Entrada casa quando todo criterio dela e satisfeito pelo contexto.

        Criterio ausente do contexto NAO casa: o silencio nunca e tratado como
        confirmacao.
        """
        return all(contexto.get(chave) == valor for chave, valor in aplicabilidade.items())

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
