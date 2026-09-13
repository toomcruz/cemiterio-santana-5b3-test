# Matriz final de falhas

## Motor V2

| Severidade | Quantidade | Camadas |
| ---------- | ---------: | ------- |
| P0         |          0 | —       |
| P1         |          0 | —       |
| P2         |          0 | —       |
| P3         |          0 | —       |

## Workflow atual

| Severidade | Quantidade | Efeito                                                                |
| ---------- | ---------: | --------------------------------------------------------------------- |
| P0         |          4 | gates de segurança/ação/receipt não satisfeitos                       |
| P1         |        107 | compreensão, contexto, multi-intenção, handoff ou conclusão impedidos |
| P2         |          0 | —                                                                     |
| P3         |          0 | —                                                                     |

Distribuição por provável camada:

- compreensão: 20;
- taxonomia: 1;
- policy: 42;
- motor: 46;
- tool/action: 2;
- knowledge, painel e regra administrativa ausente: 0 falhas atribuídas pelo scorer neste corpus.

Cada ocorrência, assertion, caso, evidência observada e camada provável está em
`benchmark/primary/failure_matrix.jsonl`.

## Falhas e limitações restantes do V2

Não houve falha contra as fixtures, mas permanecem riscos fora do escopo medido:

1. provider de IA real ainda não foi executado;
2. Action Gateway não foi integrado a tools externas reais;
3. receipts positivos foram exercitados por teste unitário com executor sintético, mas as 20 fixtures oficiais não
   executam efeitos e portanto validam somente os gates negativos de claims/receipts;
4. persistência durável, concorrência e idempotência após reinício do V2 ainda não foram conectadas;
5. custo, latência, variação e falhas de um modelo real são desconhecidos;
6. generalização além das 20 fixtures precisa de shadow e casos adversariais adicionais, sem alterar o Gold oficial.

Esses itens não mudam retroativamente o gate mecânico da Fase 15; delimitam o escopo do próximo gate.
