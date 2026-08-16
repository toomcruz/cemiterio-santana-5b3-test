"""Autoridade deterministica: dominio de valores, fatos autoritativos e derivacoes."""

from santana_parlant_poc.domain import authority, catalog, knowledge


def new_case() -> authority.ExhumationCase:
    return authority.ExhumationCase(case_id="case-teste")


def test_catalogos_vem_do_repositorio_real():
    specs = catalog.fact_specs()
    assert specs["exhumation_authorization"].authoritative_only is True
    assert specs["required_authorization_signatory"].derived is True
    assert catalog.goal_spec()["goal_code"] == "GOAL_EXUMACAO"
    assert "DEFINE_PRICES" in catalog.ai_boundary()["ai_may_not"]


def test_valor_fora_do_dominio_e_recusado():
    case = new_case()
    result = case.submit_fact("exhumation_purpose", "URNA_DE_OURO")
    assert result.outcome == authority.REJECTED
    assert result.reason == "VALUE_OUT_OF_DOMAIN"
    assert "TRANSPORTE" in result.allowed_values


def test_fato_desconhecido_e_recusado():
    case = new_case()
    result = case.submit_fact("preco_da_exumacao", "500")
    assert result.outcome == authority.REJECTED
    assert result.reason == "UNKNOWN_FACT"


def test_declaracao_do_municipe_nao_confirma_fato_autoritativo():
    """Decisoes humanas 1, 2 e 6: so sinal autoritativo confirma."""
    case = new_case()
    result = case.submit_fact("exhumation_authorization", "OBTIDA_RESPONSAVEL_JAZIGO")
    assert result.outcome == authority.RECORDED_AS_CLAIM
    assert result.pending_action == "ACTION_COLLECT_EXHUMATION_AUTHORIZATION"
    assert case.confirmed_value("exhumation_authorization") is None
    assert case.claims["exhumation_authorization"].status == authority.UNCERTAIN


def test_sinal_autoritativo_confirma():
    case = new_case()
    result = case.apply_authoritative_signal(
        "exhumation_authorization", "OBTIDA_RESPONSAVEL_JAZIGO", source="DOCUMENT"
    )
    assert result.outcome == authority.ACCEPTED
    assert case.confirmed_value("exhumation_authorization") == "OBTIDA_RESPONSAVEL_JAZIGO"


def test_assinatura_e_derivada_pela_regra_e_nao_pode_ser_informada():
    """Decisao humana 6."""
    case = new_case()
    recusa = case.submit_fact("required_authorization_signatory", "RESPONSAVEL_JAZIGO")
    assert recusa.outcome == authority.REJECTED
    assert recusa.reason == "DERIVED_FACT"

    case.submit_fact("surviving_spouse_status", "VIVO")
    assert case.confirmed_value("required_authorization_signatory") == "CONJUGE_E_RESPONSAVEL_JAZIGO"

    case.submit_fact("surviving_spouse_status", "FALECIDO", source="USER_CORRECTION")
    assert case.confirmed_value("required_authorization_signatory") == "RESPONSAVEL_JAZIGO"


def test_correcao_supersede_valor_anterior():
    case = new_case()
    case.submit_fact("exhumation_purpose", "TRANSPORTE")
    result = case.submit_fact("exhumation_purpose", "OSSUARIO", source="USER_CORRECTION")
    assert result.outcome == authority.ACCEPTED
    assert result.superseded_value == "TRANSPORTE"
    assert case.confirmed_value("exhumation_purpose") == "OSSUARIO"


def test_jazigo_de_familia_abre_pendencias_administrativas():
    """Decisoes humanas 1 e 2."""
    case = new_case()
    case.submit_fact("exhumation_purpose", "TRANSPORTE")
    case.submit_fact("transport_destination", "JAZIGO_FAMILIA")
    case.submit_fact("destination_grave_reference", "Jazigo 12, quadra B")

    acoes = {a["action_code"] for a in case.pending_actions()}
    assert "ACTION_VERIFY_GRAVE_SITUATION" in acoes
    assert "ACTION_COLLECT_GRAVE_AUTHORIZATION" in acoes


def test_destino_nao_e_exigido_quando_finalidade_nao_e_transporte():
    case = new_case()
    case.submit_fact("exhumation_purpose", "OSSUARIO")
    assert "transport_destination" not in case.required_fact_codes()


def test_proxima_pergunta_segue_ordem_de_prioridade_do_catalogo():
    case = new_case()
    ranks = catalog.priority_rank()
    primeira = case.next_question()
    assert primeira is not None
    assert ranks[primeira["priority_class"]] == min(
        ranks[catalog.fact_specs()[code].priority_class] for code in case.missing_facts()
        if catalog.fact_specs()[code].ai_extractable
    )

    case.submit_fact(primeira["fact_code"], _valor_valido(primeira["fact_code"]))
    segunda = case.next_question()
    assert segunda is None or segunda["fact_code"] != primeira["fact_code"]


def test_status_do_goal_espera_administracao():
    case = new_case()
    for code in ("exhumation_purpose", "remains_status", "surviving_spouse_status"):
        case.submit_fact(code, _valor_valido(code))
    case.submit_fact("transport_destination", "OUTRO_CEMITERIO")
    case.submit_fact("burial_reference", "Joao da Silva, quadra 3")
    case.submit_fact("requester_document", "123.456.789-00")

    assert case.missing_facts() == ()
    assert case.goal_status() == authority.GOAL_WAITING
    assert case.pending_actions()


def test_base_autoritativa_nunca_publica_preco_documento_ou_prazo():
    for topico in ("PRECO", "valor", "documentos", "prazo", "quanto custa"):
        resposta = knowledge.lookup(topico)
        assert resposta.status == knowledge.NOT_AVAILABLE
        assert not any(ch.isdigit() for ch in resposta.text)


def test_base_autoritativa_publica_regra_de_assinatura_do_repositorio():
    resposta = knowledge.lookup("quem assina")
    assert resposta.status == knowledge.AVAILABLE
    assert "conjuge" in resposta.text.lower() or "companheiro" in resposta.text.lower()
    assert "relations.v1.json" in resposta.source


def _valor_valido(fact_code: str) -> str:
    spec = catalog.fact_specs()[fact_code]
    if spec.is_enum:
        return spec.allowed_values[0]
    return "valor de teste"
