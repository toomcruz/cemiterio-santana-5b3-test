#!/usr/bin/env python3
"""Validação estática do pacote de laboratório Sana — não executa o agente."""
import json
import pathlib

base = pathlib.Path(__file__).resolve().parent
rules = json.loads((base / 'regras-operacionais.lab.v1.json').read_text(encoding='utf-8'))
cases = json.loads((base / 'casos-multiturn.lab.v1.json').read_text(encoding='utf-8'))
assert rules['status'] == 'RASCUNHO_LAB_NAO_PROMOVIDO'
assert rules['limites']['trafego_whatsapp_real'] is False
assert rules['limites']['altera_banco_producao'] is False
assert rules['limites']['altera_catalogo_oficial'] is False
prices = {p['codigo']: p for p in rules['valores_operacionais_usuario']}
assert len(prices) == len(rules['valores_operacionais_usuario']) == 5
for p in prices.values():
    assert p['estado'] == 'INFORMADO_PELO_RESPONSAVEL_PARA_TESTE'
    assert p['conciliar_tabela_oficial'] is True
    assert isinstance(p['centavos'], int) and p['centavos'] > 0
    real, cent = divmod(p['centavos'], 100)
    display = 'R$ ' + f'{real:,}'.replace(',', '.') + ',' + f'{cent:02d}'
    assert p['exibicao'] == display, (p['codigo'], display)
assert set(prices) == {
    'EXUMACAO_QUADRA_GERAL', 'ALUGUEL_OSSUARIO_CINCO_ANOS',
    'COMPRA_OSSUARIO_PERPETUO', 'URNA_COM_EXUMACAO_JAZIGO_PARTICULAR',
    'CONDICAO_SEMI_INTACTO'
}
assert len(rules['divergencias_a_conciliar_antes_de_producao']) >= 5
assert cases['status'] == 'CASOS_A_EXECUTAR_NAO_SAO_TESTES_APROVADOS'
assert cases['resultados'] == []
scenarios = cases['cenarios']
assert len(scenarios) >= 10
assert len({s['id'] for s in scenarios}) == len(scenarios)
for s in scenarios:
    assert s['modo'] in {'AGENTES_MULTITURN', 'RUNTIME_INTEGRACAO_PENDENTE'}
    assert isinstance(s['turnos'], list) and s['turnos']
    assert isinstance(s['esperado'], list) and s['esperado']
    assert isinstance(s['proibido'], list) and s['proibido']
assert sum(s['modo'] == 'RUNTIME_INTEGRACAO_PENDENTE' for s in scenarios) >= 3
print(f'LAB_STATIC_PASS: {len(prices)} referencias, {len(scenarios)} roteiros; nenhum teste de IA executado')
