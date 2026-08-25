# R7 — Solicitação e assunto real (Fase 4B)

```
NATUREZA      CONTRATO DE DOMINIO (fora da fronteira do release_id)
BASE          docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4B
GAPS          G01, G12, G02 (parcial)
RISCO         R1 — duplicação de autoridade por colapso de categoria
RELEASE       exu-1.0-32cc48f26797 (inalterado)
```

## Objetivo

Dar à solicitação existência estruturada: categoria, assunto composto por regra,
motivo, encaminhamento e estado — **sem** um status único que esconda as
diferenças entre os sete casos.

## Componentes

| Artefato | Papel |
|----------|--------|
| `santana-conversation-domain/engine/solicitacao.ts` | composição G12 + ciclos por categoria + observável |
| `santana-conversation-domain/state.schema.json` | `$defs/solicitacao` aditivo (`solicitacoes?`) |
| `contracts/r7-solicitacao.ts` | contrato R7 (reexporta o motor) |
| `santana-conversation-domain/tests/fase4/fase4b_solicitacao_test.ts` | não-colapso + G12 + schema |

## Ciclos por categoria (sem enum global)

| Categoria | Ciclo |
|-----------|-------|
| `VENDA` | INTERESSE → SOLICITACAO_CONTATO → CONTATO_FEITO |
| `ACOMPANHAMENTO` | ABERTO → EM_ANDAMENTO → RESOLVIDO |
| `RECLAMACAO` | OVERLAY_* (exige `overlay_of_goal_id`) |
| `SOLICITACAO_TAXA` | SOLICITADA → PAGA |
| `SOLICITACAO_AGENDAMENTO` | PEDIDA → CONFIRMADA_POR_HUMANO |
| `CONSULTA` | RESPONDIDA → ENCAMINHADA |
| `ENCAMINHAMENTO_ADMINISTRACAO` | ABERTO → DEVOLVIDO |

## Assunto (G12)

Composto **somente** a partir de fatos confirmados:

1. `commercial_item=LAPIDE` + `commercial_stage=PEDIDO_PAGO` +
   `commercial_delivery_status=PENDENTE` → `Lapide comprada e nao instalada`
2. `other_subject_description` presente → `Duvida sobre <valor>`
3. caso contrário → fail-closed `Solicitacao sem assunto composto`

O LLM **não** redige o assunto.

## Gate PASS

Os sete casos são distinguíveis por leitura do estado observável estruturado
(`category`, `estado`, overlay/case/forwarding, regra do assunto) — sem
inspecionar texto livre.

## Gate FAIL

Dois casos distintos produzem o mesmo estado observável (colapso de categoria =
duplicação de autoridade / R1).

## Fora de escopo (4B)

- Sessão × processo (4C)
- Reclassificação (4D)
- Documentos (4E)
- Catálogo de ações / acompanhamento operacional completo (4F)
- Qualquer arquivo dentro do digest do `release_id`
